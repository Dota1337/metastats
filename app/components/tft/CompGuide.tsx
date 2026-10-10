'use client';
import type { TftAssetsBundle } from '../../lib/tft-cdragon';
import { tftIconUrl, findItem, formatTftDesc } from '../../lib/tft-cdragon';
import { useI18n } from '../../lib/i18n';
import {
  type CompGuide as CompGuideData,
  augmentTierBorderColor,
  augmentGradeColor,
  augmentRowsByRarity,
  type AugmentGrade,
  parseLevelling,
  significantLevelSteps,
} from '../../lib/tft-comp-guides';

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

// Rand = Rarity aus dem Asset-Bundle, Buchstabe oben rechts = Performance-Grade.
// Rendert nichts, wenn das Augment nicht im Bundle steht: MetaTFT rankt über
// Sets hinweg, gemessen 28 von 1791 Referenzen (1,6 %) sind nicht in Set 17.
function AugmentTile({
  apiName, assets, grade,
}: { apiName: string; assets: TftAssetsBundle | null; grade?: AugmentGrade }) {
  // assets.augments, nicht assets.items — Augments stehen im Bundle in einer
  // eigenen Map. Die Vorgängerfassung las hier items[] und traf nie.
  const meta = assets?.augments?.[apiName] as AugmentMeta | undefined;
  if (assets && !meta) return null;
  const iconUrl = meta?.icon ? tftIconUrl(assets, meta.icon) : null;
  const tier = typeof meta?.tier === 'number' ? meta.tier : null;
  return (
    <a
      href={`/tft/augments/${encodeURIComponent(apiName)}`}
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
        {grade && (
          <span
            className="absolute -top-1 -right-1 min-w-[16px] px-1 rounded bg-surface-base border border-border-subtle text-[10px] leading-[14px] font-bold text-center"
            style={{ color: augmentGradeColor(grade) }}
          >
            {grade}
          </span>
        )}
      </div>
      <div className="text-white text-[10px] mt-0.5 text-center truncate w-full">
        {meta?.name || apiName.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?(?:Augment_)?/, '')}
      </div>
    </a>
  );
}

// Die Guide-Teile stehen seit dem Umbau der Detailseite (User 2026-10-10,
// Variante D) an verschiedenen Orten: Augments links „In der Runde", der
// Levelplan in der Leveln-Box rechts, die Carousel-Picks in der
// Bauteil-Box. Deshalb einzelne Teile statt eines Stapels.

/** Levelplan ohne eigene Box — Strategie-Zeile plus Level-Schritte. Beide
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
    <div>
      <div className="text-fg-muted text-[10px] uppercase tracking-widest mb-2">{t('tft.comp.levelling')}</div>
      {planLabel && (
        <div className="text-white text-sm font-semibold mb-2">{planLabel}</div>
      )}
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
    im Spiel hat immer eine Rarity, der Spieler sucht in genau einer Reihe. Der
    Grade dieser Comp steht als Buchstabe auf der Kachel. Ohne Asset-Bundle
    keine Sektion: die Rarity wird nicht geraten. */
export function GuideAugments({ guide, assets }: { guide: CompGuideData; assets: TftAssetsBundle | null }) {
  const { t } = useI18n();
  const rarityRows = augmentRowsByRarity(guide, assets);
  if (rarityRows.length === 0) return null;
  return (
    <section className="mt-5 bg-surface-base border border-border-subtle rounded p-4">
      <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-3">{t('tft.comp.augments')}</h2>
      <div className="flex flex-col gap-3">
        {rarityRows.map(row => (
          <div key={row.rarity} className="flex flex-col gap-1.5">
            <div
              className="text-[10px] uppercase tracking-wider font-semibold"
              style={{ color: augmentTierBorderColor(row.rarity) }}
            >
              {t(`tft.comp.augments.rarity.${row.rarity}`)}
            </div>
            <div className="flex flex-wrap gap-2">
              {row.augments.map(a => (
                <AugmentTile key={a} apiName={a} assets={assets} grade={guide.augmentGrades[a]} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Carousel-Picks der ersten Runde ohne eigene Box — welche Komponenten zu
    dieser Comp fuehren. Steht in der Bauteil-Box der Detailseite. */
export function GuideCarouselPicks({ guide, assets }: { guide: CompGuideData; assets: TftAssetsBundle | null }) {
  if (guide.carousel.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {guide.carousel.map((pick, i) => {
        const meta = findItem(assets, pick.item);
        const iconUrl = tftIconUrl(assets, meta?.icon);
        return (
          <a
            key={`${pick.item}-${i}`}
            href={`/tft/items/${encodeURIComponent(pick.item)}`}
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
