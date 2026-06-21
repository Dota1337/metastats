'use client';
import type { TftAssetsBundle } from '../../lib/tft-cdragon';
import { tftIconUrl, tftChampionTileUrl, findChampion, findItem } from '../../lib/tft-cdragon';
import { costColor as costColorOf } from '../../lib/tft-ui';
import { useI18n } from '../../lib/i18n';
import {
  type CompGuide as CompGuideData,
  augmentTierBorderColor,
  groupAugmentsByTier,
} from '../../lib/tft-comp-guides';

// CompGuide — renders the curated tftacademy.com build data as a stack of
// sub-sections (per architect verdict 2026-06-18): augments grouped by
// slot label (Econ/Items/Combat/Emblem/Hero) with tier-border-color, an
// early-game 4-champ board with items+stars, a round-1 carousel hint, and
// stage-by-stage tips. Difficulty badge inlined in the parent's header.

interface AugmentMeta {
  name?: string;
  desc?: string;
  icon?: string;
  tier?: number;
}

function AugmentTile({ apiName, assets }: { apiName: string; assets: TftAssetsBundle | null }) {
  const meta = assets?.items?.[apiName] as AugmentMeta | undefined;
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

// Mid-Game-Pivot-Tile: kleiner Champion-Tile mit Lvl-Badge oben rechts.
// Dezenter als Opener-Tiles (kein Star-Overlay, kein Items-Strip) — diese
// Units werden erst nach dem Lvl-4-Opener gepickt, kein Stage-2-Start.
function PivotChampionTile({
  apiName, level, assets, t,
}: {
  apiName: string;
  level: number;
  assets: TftAssetsBundle | null;
  t: (k: any) => string;
}) {
  const ch = findChampion(assets, apiName);
  const url = tftChampionTileUrl(assets, ch);
  const cost = ch?.cost ?? 1;
  return (
    <div className="flex flex-col items-center gap-1 w-14">
      <a
        href={`/tft/units/${encodeURIComponent(apiName)}`}
        className="relative block w-12 h-12 rounded border-2 overflow-hidden hover:scale-105 transition opacity-80 hover:opacity-100"
        style={{ borderColor: costColorOf(cost) }}
        title={`${ch?.name || apiName} — ${t('tft.comp.earlyGame.pivot')} Lvl ${level}`}
      >
        {url && <img src={url} alt={ch?.name || apiName} className="w-full h-full object-cover" />}
        <div
          className="absolute top-0 right-0 px-1 bg-[#0a0e1a]/85 text-[#7a8aa0] text-[8px] font-bold leading-tight rounded-bl"
        >
          L{level}
        </div>
      </a>
    </div>
  );
}

function EarlyChampionTile({
  apiName, items, stars, assets,
}: {
  apiName: string;
  items: string[];
  stars: number;
  assets: TftAssetsBundle | null;
}) {
  const ch = findChampion(assets, apiName);
  const url = tftChampionTileUrl(assets, ch);
  const cost = ch?.cost ?? 1;
  return (
    <div className="flex flex-col items-center gap-1 w-14">
      <a
        href={`/tft/units/${encodeURIComponent(apiName)}`}
        className="relative block w-12 h-12 rounded border-2 overflow-hidden hover:scale-105 transition"
        style={{ borderColor: costColorOf(cost) }}
        title={ch?.name || apiName}
      >
        {url && <img src={url} alt={ch?.name || apiName} className="w-full h-full object-cover" />}
        {stars >= 2 && (
          <div
            className="absolute top-0 left-0 right-0 text-center text-[10px] font-bold leading-3 px-0.5"
            style={{
              color: stars === 3 ? '#e0c75a' : '#c0c0c0',
              textShadow: '0 0 2px #000, 0 0 2px #000',
            }}
          >
            {'★'.repeat(Math.min(3, stars))}
          </div>
        )}
      </a>
      {items.length > 0 && (
        <div className="flex items-center gap-[1px]">
          {items.slice(0, 3).map((it, idx) => {
            const meta = findItem(assets, it);
            const iconUrl = tftIconUrl(assets, meta?.icon);
            return (
              <a
                key={`${it}-${idx}`}
                href={`/tft/items/${encodeURIComponent(it)}`}
                className="w-3 h-3 rounded-sm bg-[#0a0e1a] border border-[#1e2a3a] overflow-hidden block"
                title={meta?.name || it}
              >
                {iconUrl && <img src={iconUrl} alt={meta?.name || it} className="w-full h-full object-cover" />}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function CompGuide({
  guide,
  assets,
  typicalUnits,
}: {
  guide: CompGuideData;
  assets: TftAssetsBundle | null;
  // Optional — wenn vorhanden, werden 3 Mid-Game-Pivot-Tiles nach den 4
  // curated Lvl-4-Champs gerendert. Damit matched die Sektion das Label
  // „Lvl 4-7" (4 Opener + 3 Pivots = 7 Champions). Pivots = typicalUnits
  // die NICHT in earlyComp sind, sortiert nach count desc.
  typicalUnits?: Array<{ characterId: string; count?: number | unknown }>;
}) {
  const { t, lang } = useI18n();
  // Tier-Gruppierung statt Slot-Gruppierung (User-Override 2026-06-21):
  // tftacademy's augmentTypes-Slot-Labels (ECON/ITEMS/COMBAT) hatten viele
  // Klassifikations-Fehler. Bundle.items[apiName].tier ist Ground-Truth via
  // tactics.tools-Override (reference_tft_augment_tier_source.md).
  const tierGroups = groupAugmentsByTier(guide, assets);
  // Localised augmentsTip — falls back to EN when current lang isn't a key
  // in the paraphrase. Renders nothing when the LLM-paraphrase failed
  // validation (the scraper writes null in that case).
  const localisedTip = guide.augmentsTip
    ? guide.augmentsTip[lang as keyof typeof guide.augmentsTip] || guide.augmentsTip.en
    : null;

  return (
    <>
      {/* 1) Augments — gruppiert nach Tier (Silver/Gold/Prismatic), absteigend
          aufsteigend nach Stärke. Fallback auf flache Liste wenn kein Augment
          einen bekannten Tier hat (sollte selten passieren, weil tactics.tools-
          Override 99%+ Coverage hat). */}
      {guide.augments.length > 0 && (
        <section className="mt-5 bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
          <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">{t('tft.comp.augments')}</h2>
          {tierGroups.length > 0 ? (
            <div className="flex flex-col gap-3">
              {tierGroups.map((group) => {
                const tierColor = augmentTierBorderColor(group.tier);
                return (
                  <div key={group.label} className="flex flex-col gap-1.5">
                    <div
                      className="text-[10px] uppercase tracking-wider font-semibold"
                      style={{ color: tierColor }}
                    >
                      {t(`tft.comp.augments.tier.${group.label}` as any) || group.label}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {group.augments.map(a => <AugmentTile key={a} apiName={a} assets={assets} />)}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {guide.augments.map(a => <AugmentTile key={a} apiName={a} assets={assets} />)}
            </div>
          )}
          {localisedTip && (
            <p className="text-[#a0b0c5] text-xs mt-3 leading-snug">{localisedTip}</p>
          )}
        </section>
      )}

      {/* 2) Early Game Board: 4 curated Opener-Champs (Lvl 4) + bis zu 3
          Mid-Game-Pivot-Tiles aus typicalUnits (Lvl 5-7). Damit zeigt die
          Sektion 7 Champions = matched „Lvl 4-7"-Label. Pivots sind die
          häufigsten Units die NICHT im Opener sind. */}
      {guide.earlyComp.length > 0 && (() => {
        const openerSet = new Set(guide.earlyComp.map(e => e.apiName));
        const pivots = (typicalUnits || [])
          .filter(u => !openerSet.has(u.characterId))
          .map(u => ({ characterId: u.characterId, count: typeof u.count === 'number' ? u.count : 0 }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 3);
        return (
          <section className="mt-5 bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
            <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">{t('tft.comp.earlyGame')}</h2>
            <div className="flex flex-wrap items-start gap-3">
              {/* Curated Opener (Lvl 4) */}
              {guide.earlyComp.map((e, i) => (
                <EarlyChampionTile
                  key={`opener-${e.apiName}-${i}`}
                  apiName={e.apiName}
                  items={e.items}
                  stars={e.stars}
                  assets={assets}
                />
              ))}
              {/* Mid-Game-Pivots (Lvl 5-7) — dezenter dargestellt mit
                  Pivot-Badge damit User sieht "kommt erst später". */}
              {pivots.length > 0 && (
                <div className="self-stretch border-l border-[#1e2a3a] mx-1" aria-hidden="true" />
              )}
              {pivots.map((p, idx) => (
                <PivotChampionTile
                  key={`pivot-${p.characterId}-${idx}`}
                  apiName={p.characterId}
                  level={5 + idx}
                  assets={assets}
                  t={t}
                />
              ))}
            </div>
          </section>
        );
      })()}

      {/* Stage-by-Stage tips */}
      {guide.tips.length > 0 && (
        <section className="mt-5 bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
          <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">{t('tft.comp.stageTips')}</h2>
          <div className="flex flex-col gap-2">
            {guide.tips.map((tip, i) => {
              // Localise the stage prefix ("Stage 2" → user's language). The
              // tip body itself stays in English — tftacademy is the source
              // of truth, machine-translation would degrade quality
              // (`feedback_no_fake_values` analogue: don't invent content).
              const stageNumMatch = /Stage\s+(\d+)/.exec(tip.stage);
              const stageNum = stageNumMatch?.[1];
              const stageLabel = stageNum
                ? (t(`tft.comp.stage.${stageNum}` as any) || tip.stage)
                : tip.stage;
              return (
                <div key={`${tip.stage}-${i}`} className="flex gap-3">
                  <div className="text-[#c39bff] text-xs font-medium min-w-[4.5rem]">{stageLabel}</div>
                  <div className="text-[#a0b0c5] text-xs leading-snug flex-1">{tip.tip}</div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
