'use client';
import type { TftAssetsBundle } from '../../lib/tft-cdragon';
import { tftIconUrl, tftChampionTileUrl, findChampion, findItem } from '../../lib/tft-cdragon';
import { costColor as costColorOf } from '../../lib/tft-ui';
import { useI18n } from '../../lib/i18n';
import {
  type CompGuide as CompGuideData,
  augmentTierBorderColor,
  groupAugmentsBySlot,
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
}: {
  guide: CompGuideData;
  assets: TftAssetsBundle | null;
}) {
  const { t, lang } = useI18n();
  const groups = groupAugmentsBySlot(guide);
  const hasGroupedAugments = guide.augmentTypes.length === guide.augments.length;
  // Localised augmentsTip — falls back to EN when current lang isn't a key
  // in the paraphrase. Renders nothing when the LLM-paraphrase failed
  // validation (the scraper writes null in that case).
  const localisedTip = guide.augmentsTip
    ? guide.augmentsTip[lang as keyof typeof guide.augmentsTip] || guide.augmentsTip.en
    : null;

  return (
    <>
      {/* 1) Augments — grouped if augmentTypes present, otherwise flat. */}
      {guide.augments.length > 0 && (
        <section className="mt-5 bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
          <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">{t('tft.comp.augments')}</h2>
          {hasGroupedAugments ? (
            <div className="flex flex-col gap-3">
              {groups.map((group, idx) => (
                <div key={`${group.label}-${idx}`} className="flex flex-col gap-1.5">
                  <div className="text-[#7a8aa0] text-[10px] uppercase tracking-wider">
                    {t(`tft.comp.augments.group.${group.label}` as any) || group.label}
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
          {localisedTip && (
            <p className="text-[#a0b0c5] text-xs mt-3 leading-snug">{localisedTip}</p>
          )}
        </section>
      )}

      {/* 2) Early Game Board (4 champions with items + stars) */}
      {guide.earlyComp.length > 0 && (
        <section className="mt-5 bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
          <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">{t('tft.comp.earlyGame')}</h2>
          <div className="flex flex-wrap gap-3">
            {guide.earlyComp.map((e, i) => (
              <EarlyChampionTile
                key={`${e.apiName}-${i}`}
                apiName={e.apiName}
                items={e.items}
                stars={e.stars}
                assets={assets}
              />
            ))}
          </div>
        </section>
      )}

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
