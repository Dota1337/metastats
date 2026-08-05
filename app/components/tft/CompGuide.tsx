'use client';
import type { TftAssetsBundle } from '../../lib/tft-cdragon';
import { tftIconUrl, tftChampionTileUrl, findChampion, findItem } from '../../lib/tft-cdragon';
import { costColor as costColorOf } from '../../lib/tft-ui';
import { useI18n } from '../../lib/i18n';
import {
  type CompGuide as CompGuideData,
  type EarlyOption,
  augmentTierBorderColor,
  augmentGradeColor,
  groupAugmentsByGrade,
  parseLevelling,
  significantLevelSteps,
} from '../../lib/tft-comp-guides';

// CompGuide — rendert die aus MetaTFT-Clustern abgeleiteten Build-Daten als
// Stapel von Sub-Sektionen: Levelplan, Augments nach Tier, die meistgespielten
// Early-Game-Boards mit Placement, und die Round-1-Carousel-Picks.
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

// Rand = Rarity aus dem Asset-Bundle, Gruppenzuordnung = Performance-Grade.
// Rendert nichts, wenn das Augment nicht im Bundle steht: MetaTFT rankt über
// Sets hinweg, gemessen 28 von 1791 Referenzen (1,6 %) sind nicht in Set 17.
function AugmentTile({ apiName, assets }: { apiName: string; assets: TftAssetsBundle | null }) {
  // assets.augments, nicht assets.items — Augments stehen im Bundle in einer
  // eigenen Map. Die Vorgängerfassung las hier items[] und traf nie.
  const meta = assets?.augments?.[apiName] as AugmentMeta | undefined;
  if (assets && !meta) return null;
  const iconUrl = meta?.icon ? tftIconUrl(assets, meta.icon) : null;
  const tier = typeof meta?.tier === 'number' ? meta.tier : null;
  return (
    <a
      href={`/tft/augments/${encodeURIComponent(apiName)}`}
      className="flex flex-col items-center w-16 hover:scale-105 transition"
      title={meta?.desc?.replace(/<[^>]+>/g, '') || meta?.name || apiName}
    >
      <div
        className="w-14 h-14 rounded overflow-hidden border-2"
        style={{ borderColor: augmentTierBorderColor(tier) }}
      >
        {iconUrl ? (
          <img src={iconUrl} alt={meta?.name || apiName} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-[#1e2a3a]" />
        )}
      </div>
      <div className="text-white text-[10px] mt-0.5 text-center truncate w-full">
        {meta?.name || apiName.replace(/^TFT\d*_Augment_/, '')}
      </div>
    </a>
  );
}

function EarlyChampionTile({ apiName, assets }: { apiName: string; assets: TftAssetsBundle | null }) {
  const ch = findChampion(assets, apiName);
  const url = tftChampionTileUrl(assets, ch);
  const cost = ch?.cost ?? 1;
  return (
    <a
      href={`/tft/units/${encodeURIComponent(apiName)}`}
      className="relative block w-10 h-10 rounded border-2 overflow-hidden hover:scale-105 transition"
      style={{ borderColor: costColorOf(cost) }}
      title={ch?.name || apiName}
    >
      {url && <img src={url} alt={ch?.name || apiName} className="w-full h-full object-cover" />}
    </a>
  );
}

// Eine Early-Game-Variante: Board links, Kennzahlen rechts. Mehrere Varianten
// untereinander statt einer „richtigen" — MetaTFT liefert die tatsächlich
// gespielten Opener, und die unterscheiden sich real.
function EarlyOptionRow({
  option, assets, t,
}: {
  option: EarlyOption;
  assets: TftAssetsBundle | null;
  t: (k: any) => string;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex flex-wrap gap-1">
        {option.units.map((u, i) => (
          <EarlyChampionTile key={`${u}-${i}`} apiName={u} assets={assets} />
        ))}
      </div>
      <div className="flex items-center gap-3 text-[10px] text-[#7a8aa0]">
        {typeof option.avg === 'number' && (
          <span>
            {t('tft.comp.avgPlacement')}{' '}
            <span className="text-white font-semibold">{option.avg.toFixed(2)}</span>
          </span>
        )}
        {typeof option.count === 'number' && (
          <span>
            {option.count.toLocaleString()} {t('tft.comp.games')}
          </span>
        )}
      </div>
    </div>
  );
}

export default function CompGuide({
  guide,
  assets,
}: {
  guide: CompGuideData;
  assets: TftAssetsBundle | null;
}) {
  const { t } = useI18n();
  // Gruppierung nach Performance-Grade in dieser Comp (S..D), nicht nach
  // Rarity — die sieht der Spieler im Angebot ohnehin. Der Tile-Rand trägt
  // die Rarity weiterhin, so bleiben beide Größen sichtbar.
  const gradeGroups = groupAugmentsByGrade(guide);
  const plan = parseLevelling(guide.levelling);
  const steps = significantLevelSteps(guide.levels);
  // Ein einzelner Schritt ist kein Plan — dann bleibt nur die Strategie-Zeile.
  const planSteps = steps.length >= 2 ? steps : [];

  const planLabel = plan
    ? plan.kind === 'standard'
      ? (t('tft.comp.levelling.standard') as string)
      : (t(`tft.comp.levelling.${plan.kind}`) as string).replace('{level}', String(plan.level))
    : null;

  return (
    <>
      {/* 0) Levelplan — die erste Frage in einer laufenden Runde ist „bleibe
          ich auf diesem Level oder pushe ich?". Steht deshalb vor den
          Augments. Beide Hälften sind unabhängig optional: unbekanntes
          Levelling-Kürzel und zu dünne Schritte fallen je einzeln weg, statt
          die ganze Sektion zu kippen oder einen Wert zu erfinden. */}
      {(planLabel || planSteps.length > 0) && (
        <section className="mt-5 bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
          <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">{t('tft.comp.levelling')}</h2>
          {planLabel && (
            <div className="text-white text-sm font-semibold mb-3">{planLabel}</div>
          )}
          {planSteps.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {planSteps.map(step => (
                <div
                  key={step.level}
                  className="flex flex-col items-center bg-[#111c2e] border border-[#1e2a3a] rounded px-2.5 py-1.5 min-w-[3.5rem]"
                >
                  <div className="text-white text-xs font-semibold">
                    {(t('tft.comp.levelling.step') as string).replace('{level}', String(step.level))}
                  </div>
                  <div className="text-[#7a8aa0] text-[11px] tabular-nums">
                    {step.stage}-{step.round}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 1) Augments — gruppiert nach Grade. Fallback auf flache Liste, wenn
          kein Augment einen Grade trägt. */}
      {guide.augments.length > 0 && (
        <section className="mt-5 bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
          <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">{t('tft.comp.augments')}</h2>
          {gradeGroups.length > 0 ? (
            <div className="flex flex-col gap-3">
              {gradeGroups.map((group) => (
                <div key={group.grade} className="flex flex-col gap-1.5">
                  <div
                    className="text-[10px] uppercase tracking-wider font-semibold"
                    style={{ color: augmentGradeColor(group.grade) }}
                  >
                    {group.grade}-{t('tft.comp.augments.grade')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {group.augments.map(a => <AugmentTile key={a} apiName={a} assets={assets} />)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {guide.augments.map(a => <AugmentTile key={a} apiName={a} assets={assets} />)}
            </div>
          )}
        </section>
      )}

      {/* 2) Early Game — die meistgespielten Opener-Boards dieser Comp mit
          ihrem Durchschnittsplatz, damit der Spieler zwischen ihnen wählen
          kann statt einen vorgesetzt zu bekommen. */}
      {guide.early.length > 0 && (
        <section className="mt-5 bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
          <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">{t('tft.comp.earlyGame')}</h2>
          <div className="flex flex-col gap-3">
            {guide.early.map((opt, i) => (
              <EarlyOptionRow key={`early-${i}`} option={opt} assets={assets} t={t} />
            ))}
          </div>
        </section>
      )}

      {/* 3) Carousel — welche Komponenten aus dem ersten Carousel zu dieser
          Comp führen. Erste echte Entscheidung der Runde. */}
      {guide.carousel.length > 0 && (
        <section className="mt-5 bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
          <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">{t('tft.comp.carousel')}</h2>
          <div className="flex flex-wrap gap-3">
            {guide.carousel.map((pick, i) => {
              const meta = findItem(assets, pick.item);
              const iconUrl = tftIconUrl(assets, meta?.icon);
              return (
                <a
                  key={`${pick.item}-${i}`}
                  href={`/tft/items/${encodeURIComponent(pick.item)}`}
                  className="flex flex-col items-center w-12 hover:scale-105 transition"
                  title={meta?.name || pick.item}
                >
                  <div className="w-10 h-10 rounded bg-[#0a0e1a] border border-[#1e2a3a] overflow-hidden">
                    {iconUrl && <img src={iconUrl} alt={meta?.name || pick.item} className="w-full h-full object-cover" />}
                  </div>
                  {typeof pick.avg === 'number' && (
                    <div className="text-[#7a8aa0] text-[10px] mt-0.5">{pick.avg.toFixed(2)}</div>
                  )}
                </a>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
