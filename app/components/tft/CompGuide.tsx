'use client';
import { useEffect, useState } from 'react';
import type { TftAssetsBundle } from '../../lib/tft-cdragon';
import { tftIconUrl, findItem, formatTftDesc } from '../../lib/tft-cdragon';
import { useI18n } from '../../lib/i18n';
import {
  type CompGuide as CompGuideData,
  augmentTierBorderColor,
  augmentRowsByRarity,
  parseLevelling,
  significantLevelSteps,
} from '../../lib/tft-comp-guides';
import {
  type AugmentStage,
  type AugmentStagesOverride,
  augmentStagesFor,
  loadAugmentStages,
  stageColor,
} from '../../lib/tft-augment-stages';

// CompGuide — rendert die aus MetaTFT-Clustern abgeleiteten Build-Daten:
// Levelplan, Augments nach Tier und die Round-1-Carousel-Picks (je ein
// eigener Teil, s. unten). Die Early-Game-Boards stehen seit 2026-10-10 als
// Reiter „Aufbau“ in der Positionierungs-Box (CompBoardPanel).
// Difficulty-Badge sitzt im Header der Elternseite.
//
// Die Stage-Tipps der tftacademy-Fassung sind ersatzlos entfallen — MetaTFT
// clustert aus Match-Daten und hat keinen redaktionellen Fließtext. Ein
// generierter Ersatz wäre erfundener Inhalt.

interface AugmentMeta {
  name?: string;
  desc?: string;
  icon?: string;
  tier?: number;
}

const STAGE_ORDER: AugmentStage[] = ['2-1', '3-2', '4-2'];

// Stages, in denen das Augment angeboten wird — nur wenn es NICHT in allen
// drei kommt (User 2026-10-15, F3). Quelle tft-augment-stages-<set>.json
// (tactics.tools), Spielmechanik, keine Statistik. Ohne Eintrag nichts.
function StageBadge({ stages }: { stages: AugmentStage[] }) {
  const { t } = useI18n();
  const sorted = STAGE_ORDER.filter(s => stages.includes(s));
  return (
    <span
      className="absolute -top-1 -right-1 inline-flex gap-[3px] px-1 rounded bg-surface-base border border-border-subtle text-[9px] leading-[13px] font-bold tabular-nums whitespace-nowrap"
      title={`${t('tft.augment.stage.appearsIn')}: ${sorted.join(', ')}`}
    >
      {sorted.map(s => (
        <span key={s} style={{ color: stageColor(s) }}>{s}</span>
      ))}
    </span>
  );
}

// Rand = Rarity aus dem Asset-Bundle, oben rechts die Stages (StageBadge).
// Rendert nichts, wenn das Augment nicht im Bundle steht: MetaTFT rankt über
// Sets hinweg, gemessen 28 von 1791 Referenzen (1,6 %) sind nicht in Set 17.
function AugmentTile({
  apiName, assets, stages,
}: { apiName: string; assets: TftAssetsBundle | null; stages: AugmentStage[] | null }) {
  const { withLang } = useI18n();
  // assets.augments, nicht assets.items — Augments stehen im Bundle in einer
  // eigenen Map. Die Vorgängerfassung las hier items[] und traf nie.
  const meta = assets?.augments?.[apiName] as AugmentMeta | undefined;
  if (assets && !meta) return null;
  const iconUrl = meta?.icon ? tftIconUrl(assets, meta.icon) : null;
  const tier = typeof meta?.tier === 'number' ? meta.tier : null;
  return (
    <a
      href={withLang(`/tft/augments/${encodeURIComponent(apiName)}`)}
      className="flex flex-col items-center w-14 hover:scale-105 transition"
      title={formatTftDesc(meta?.desc) || meta?.name || apiName}
    >
      <div className="relative">
        <div
          className="w-10 h-10 rounded overflow-hidden border-2"
          style={{ borderColor: augmentTierBorderColor(tier) }}
        >
          {iconUrl ? (
            <img src={iconUrl} alt={meta?.name || apiName} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-surface-overlay" />
          )}
        </div>
        {stages && stages.length > 0 && stages.length < STAGE_ORDER.length && <StageBadge stages={stages} />}
      </div>
      <div className="text-white text-[10px] mt-0.5 text-center truncate w-full">
        {meta?.name || apiName.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?(?:Augment_)?/, '')}
      </div>
    </a>
  );
}

// Die Guide-Teile stehen seit dem Umbau der Detailseite (User 2026-10-10,
// Variante D) an verschiedenen Orten: Augments und Carousel-Picks in der
// Bauteil-Box, der Levelplan in der Leveln-Box. Deshalb einzelne Teile statt
// eines Stapels.

/** Levelplan ohne eigene Box — Strategie-Zeile, rechts daneben die Level-
    Schritte (User 2026-10-10; bei zu wenig Platz rutschen sie darunter). Beide
    Haelften sind unabhaengig optional: unbekanntes Levelling-Kuerzel und zu
    duenne Schritte fallen je einzeln weg, statt einen Wert zu erfinden. */
export function GuideLevelPlan({ guide }: { guide: CompGuideData }) {
  const { t } = useI18n();
  const plan = parseLevelling(guide.levelling);
  const steps = significantLevelSteps(guide.levels);
  // Ein einzelner Schritt ist kein Plan — dann bleibt nur die Strategie-Zeile.
  const planSteps = steps.length >= 2 ? steps : [];
  const planLabel = plan
    ? plan.kind === 'standard'
      ? (t('tft.comp.levelling.standard') as string)
      : (t(`tft.comp.levelling.${plan.kind}`) as string).replace('{level}', String(plan.level))
    : null;
  if (!planLabel && planSteps.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div>
        <div className="text-fg-muted text-[10px] uppercase tracking-widest mb-2">{t('tft.comp.levelling')}</div>
        {planLabel && (
          <div className="text-white text-sm font-semibold">{planLabel}</div>
        )}
      </div>
      {planSteps.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {planSteps.map(step => (
            <div
              key={step.level}
              className="flex flex-col items-center bg-surface-level-chip border border-border-subtle rounded px-2.5 py-1.5 min-w-[3.5rem]"
            >
              <div className="text-white text-xs font-semibold">
                {(t('tft.comp.levelling.step') as string).replace('{level}', String(step.level))}
              </div>
              <div className="text-fg-muted text-[11px] tabular-nums">
                {step.stage}-{step.round}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Augments — drei Reihen nach Rarity (Prismatic → Gold → Silver): ein Angebot
    im Spiel hat immer eine Rarity, der Spieler sucht in genau einer Reihe.
    Seit 2026-10-15 ohne Buchstaben (das war eine Profi-Einschaetzung, keine
    Messung); oben rechts stehen stattdessen die Stages, wenn das Augment nicht
    in allen drei kommt. Ohne Asset-Bundle keine Sektion: die Rarity wird nicht
    geraten.
    Ohne eigene Box, die Rarity steht links vor der Reihe — Teil der Bauteil-
    Box der Detailseite (User 2026-10-10, etwa 120 px kuerzer als vorher). */
export function GuideAugments({ guide, assets }: { guide: CompGuideData; assets: TftAssetsBundle | null }) {
  const { t } = useI18n();
  const [stagesOverride, setStagesOverride] = useState<AugmentStagesOverride | null>(null);
  useEffect(() => { loadAugmentStages().then(setStagesOverride); }, []);
  const rarityRows = augmentRowsByRarity(guide, assets);
  if (rarityRows.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {rarityRows.map(row => (
        <div key={row.rarity} className="flex items-start gap-2">
          <div
            className="w-[5.5rem] shrink-0 pt-3 text-[10px] uppercase tracking-wide font-semibold truncate"
            style={{ color: augmentTierBorderColor(row.rarity) }}
          >
            {t(`tft.comp.augments.rarity.${row.rarity}`)}
          </div>
          <div className="flex flex-wrap gap-2 min-w-0">
            {row.augments.map(a => (
              <AugmentTile key={a} apiName={a} assets={assets} stages={augmentStagesFor(stagesOverride, a)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Carousel-Picks der ersten Runde ohne eigene Box — welche Komponenten zu
    dieser Comp fuehren. Steht in der Bauteil-Box der Detailseite. */
export function GuideCarouselPicks({ guide, assets }: { guide: CompGuideData; assets: TftAssetsBundle | null }) {
  const { withLang } = useI18n();
  if (guide.carousel.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {guide.carousel.map((pick, i) => {
        const meta = findItem(assets, pick.item);
        const iconUrl = tftIconUrl(assets, meta?.icon);
        return (
          <a
            key={`${pick.item}-${i}`}
            href={withLang(`/tft/items/${encodeURIComponent(pick.item)}`)}
            className="flex flex-col items-center w-10 hover:scale-105 transition"
            title={meta?.name || pick.item}
          >
            <div className="w-8 h-8 rounded bg-surface-sunken border border-border-subtle overflow-hidden">
              {iconUrl && <img src={iconUrl} alt={meta?.name || pick.item} className="w-full h-full object-cover" />}
            </div>
            {typeof pick.avg === 'number' && (
              <div className="text-fg-muted text-[10px] mt-0.5">{pick.avg.toFixed(2)}</div>
            )}
          </a>
        );
      })}
    </div>
  );
}
