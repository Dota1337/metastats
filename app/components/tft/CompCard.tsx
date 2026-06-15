'use client';
import { useRouter } from 'next/navigation';
import type { TftAssetsBundle } from '../../lib/tft-cdragon';
import { tftIconUrl, tftChampionTileUrl, findChampion, findItem, tftTraitDisplayName, tftTraitDescription } from '../../lib/tft-cdragon';
import { costColor as costColorOf } from '../../lib/tft-ui';
import { useI18n } from '../../lib/i18n';
import PlanAheadButton from './PlanAheadButton';

interface CompVelocity {
  deltaAvgPlace: number | null;
  avgPlaceNow: number | null;
  avgPlacePrev: number | null;
  isNew: boolean;
  gamesNow: number;
  gamesPrev: number;
}

interface Comp {
  source?: 'data' | 'editorial';
  slug: string;
  clusterKey: string;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  top1Rate: number | null;
  pickRate?: number | null;
  typicalUnits: {
    characterId: string;
    count: number | unknown;
    carryItemGames?: number | unknown;
    topItems?: { apiName: string; count: number | unknown }[];
  }[];
  typicalAugments: { apiName: string; count: number | unknown; sumPlacement?: number | unknown }[];
  carryItems: { items: string[]; count: number | unknown }[];
  authorName?: string;
  velocity?: CompVelocity | null;
}

const safeCount = (v: unknown): number => (typeof v === 'number' ? v : 1);

function tierBadge(avgPlacement: number | null): { label: string; color: string; bg: string } {
  if (avgPlacement == null) return { label: '?', color: '#5a6a80', bg: '#1e2a3a' };
  if (avgPlacement < 3.8) return { label: 'S',  color: '#e0c75a', bg: 'rgba(224,199,90,0.15)' };
  if (avgPlacement < 4.2) return { label: 'A',  color: '#7B61FF', bg: 'rgba(123,97,255,0.15)' };
  if (avgPlacement < 4.5) return { label: 'B',  color: '#3a8ddc', bg: 'rgba(58,141,220,0.15)' };
  return                         { label: 'C',  color: '#5a6a80', bg: 'rgba(90,106,128,0.15)' };
}

export default function CompCard({
  comp, rank, assets, href, showVelocity = false, velocityShift = 0,
  hideCarryTile = false,
}: {
  comp: Comp;
  rank?: number;
  assets: TftAssetsBundle | null;
  href?: string;
  // When true the card renders an additional Δ pill at the end of the stats
  // strip. Drives the landing-page Δ-comparison feature so the StatsFilterBar's
  // velocity dropdown actually has a visible effect.
  showVelocity?: boolean;
  velocityShift?: number;
  // Detail-page nutzt das — der große Carry-Tile links ist auf der
  // Detail-Seite reine Wiederholung der typicalUnits-Row (in der der Carry
  // mit einem lila Border bereits markiert ist + seine Items zeigt).
  hideCarryTile?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const parts = parseClusterKey(comp.clusterKey);
  const traitMeta = parts && assets ? assets.traits[parts.trait] : null;
  // Stargazer (and similar themed traits) ships seven constellation variants
  // — Mountain, Serpent, Huntress, Medallion, Fountain, Wolf, Shield — all of
  // which share the same `name`. The constellation suffix lives in the
  // apiName, so we surface it explicitly: "Stargazer · Mountain 6" instead
  // of the ambiguous "Stargazer 6".
  const traitName = traitMeta?.name || (parts ? prettyTrait(parts.trait) : 'Unknown');
  const traitVariant = parts ? extractTraitVariant(parts.trait, traitName) : null;
  // Authoritativer Trait-Display + Tooltip-Text aus desc (matched In-Game-
  // Display für Stargazer-Constellations: Wolf→Boar, Shield→Altar).
  const traitDisplay = parts ? tftTraitDisplayName(assets, parts.trait) : traitName;
  const traitTooltip = parts ? tftTraitDescription(assets, parts.trait) : '';
  const tier = tierBadge(comp.avgPlacement);

  const typicalUnits = (() => {
    const all = [...(comp.typicalUnits || [])].map(u => ({
      ...u,
      _c: safeCount(u.count),
      // carryItemGames is a real number-or-missing field — DON'T fall back to
      // 1 via safeCount, because that would put every unit into the carry
      // selection pool on old aggregator rows and pick the unit with the
      // lowest count as the carry.
      _carry: typeof (u as any).carryItemGames === 'number' ? (u as any).carryItemGames : 0,
    }));
    // Sort: primary carry first, secondary carry second, rest by count desc.
    // Damit matched die Reihenfolge der Units das Comp-Naming
    // ("Meeple Corki (mit Gnar)" → Corki zuerst, dann Gnar).
    const primary = parts?.carry || null;
    const secondary = parts?.secondary || null;
    return all
      .sort((a, b) => {
        const pa = a.characterId === primary ? 0 : a.characterId === secondary ? 1 : 2;
        const pb = b.characterId === primary ? 0 : b.characterId === secondary ? 1 : 2;
        if (pa !== pb) return pa - pb;
        return b._c - a._c;
      })
      .slice(0, 9);
  })();

  // Real DMG-carry: unit with the highest share of games holding a
  // damage-carry item. Falls back to the cluster_key carry (lead champion)
  // when no typical unit has carryItemGames data yet (old aggregator rows).
  const carryByItems = typicalUnits
    .filter(u => u._c >= 5 && u._carry > 0)
    .map(u => ({ cid: u.characterId, rate: u._carry / u._c, _carry: u._carry }))
    .sort((a, b) => (b.rate - a.rate) || (b._carry - a._carry))[0];
  const carryCid = carryByItems?.cid || parts?.carry;
  const carry = carryCid && assets ? assets.champions[carryCid] : null;
  const carryTileUrl = tftChampionTileUrl(assets, carry);
  // Sub-Cluster: zweiter damage-carry aus dem clusterKey-Suffix (#<unitId>).
  // Wird im Comp-Header als „(mit <Name>)" hinter dem primary-Carry angezeigt.
  const secondaryCid = parts?.secondary || null;
  const secondaryChamp = secondaryCid && assets ? assets.champions[secondaryCid] : null;
  const secondaryName = secondaryChamp?.name || (secondaryCid ? prettyChar(secondaryCid) : null);

  // Wrapper used to be an <a href> which nested ~40 inner <a> tags (carry,
  // trait, name, 9 unit tiles, up to 27 item tiles) — invalid HTML. When href
  // is provided we render a div with link semantics + router.push, preserving
  // Cmd/Ctrl/Mid-click → new tab and Enter/Space keyboard activation.
  const linkProps = href
    ? {
        role: 'link' as const,
        tabIndex: 0,
        onClick: (e: React.MouseEvent) => {
          if (e.defaultPrevented) return;
          if (e.metaKey || e.ctrlKey) {
            window.open(href, '_blank', 'noopener');
            return;
          }
          router.push(href);
        },
        onAuxClick: (e: React.MouseEvent) => {
          if (e.button === 1) {
            e.preventDefault();
            window.open(href, '_blank', 'noopener');
          }
        },
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            router.push(href);
          }
        },
      }
    : {};
  const interactiveClass = href
    ? 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7B61FF]/60'
    : '';
  return (
    <div
      {...linkProps}
      className={`block bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-3 hover:border-[#7B61FF]/40 transition-colors ${interactiveClass}`}
    >
      {/* Mobile: stack the carry header → units row → stats column vertically.
          Desktop: original 3-column grid keeps it dense. */}
      <div className="flex flex-col sm:grid sm:grid-cols-[auto_1fr_auto] gap-3 sm:gap-4 sm:items-center">
        <div className="flex items-center gap-3">
          {rank != null && <div className="text-[#7a8aa0] text-sm font-medium w-6 text-center">{rank}</div>}
          <div className="flex items-center justify-center w-10 h-10 rounded-lg font-bold text-base"
               style={{ color: tier.color, backgroundColor: tier.bg, border: `1px solid ${tier.color}40` }}>
            {tier.label}
          </div>
          {!hideCarryTile && (
            carryTileUrl ? (
              <a
                href={`/tft/units/${encodeURIComponent(carryCid!)}`}
                onClick={e => e.stopPropagation()}
                title={carry!.name}
                className="block hover:scale-105 transition-transform"
              >
                <img src={carryTileUrl} alt={carry!.name} className="w-12 h-12 rounded border-2 border-[#c39bff] object-cover" />
              </a>
            ) : (
              <div className="w-12 h-12 rounded bg-[#1e2a3a]" />
            )
          )}
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-white text-sm font-medium truncate" title={traitTooltip || undefined}>
              {parts ? (
                <a
                  href={`/tft/traits/${encodeURIComponent(parts.trait)}`}
                  onClick={e => e.stopPropagation()}
                  className="hover:text-[#7B61FF] transition-colors"
                >
                  {traitDisplay}
                </a>
              ) : traitDisplay}
              {' · '}{carryCid ? (
                <a
                  href={`/tft/units/${encodeURIComponent(carryCid)}`}
                  onClick={e => e.stopPropagation()}
                  className="hover:text-[#7B61FF] transition-colors"
                >
                  {carry?.name || prettyChar(carryCid)}
                </a>
              ) : (carry?.name || '')}
              {parts?.carryStar === 3 && (
                <span
                  className="ml-1 inline-flex items-center px-1 py-[1px] rounded text-[10px] font-semibold tabular-nums"
                  style={{ color: '#e0c75a', backgroundColor: 'rgba(224,199,90,0.15)', border: '1px solid rgba(224,199,90,0.4)' }}
                  title="3-Star Reroll-Variante"
                >
                  3★
                </span>
              )}
              {parts?.buildStyle === 'tank' && (
                <span
                  className="ml-1 inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-medium"
                  style={{ color: '#7ab9ec', backgroundColor: 'rgba(58,141,220,0.12)', border: '1px solid rgba(58,141,220,0.4)' }}
                >
                  {t('tft.comp.build.tank')}
                </span>
              )}
              {parts?.buildStyle === 'bruiser' && (
                <span
                  className="ml-1 inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-medium"
                  style={{ color: '#c39bff', backgroundColor: 'rgba(123,97,255,0.12)', border: '1px solid rgba(123,97,255,0.4)' }}
                >
                  {t('tft.comp.build.bruiser')}
                </span>
              )}
              {secondaryName && (
                <span className="text-[#a0b0c5] text-xs ml-1.5">
                  {(t('tft.comp.withSecondary') as string).replace(
                    '{name}',
                    secondaryName,
                  )}
                </span>
              )}
            </span>
          </div>

          <div className="flex flex-wrap items-start gap-1.5 mb-1.5">
            {typicalUnits.map(u => {
              const ch = findChampion(assets, u.characterId);
              const isCarry = u.characterId === carryCid;
              const url = tftChampionTileUrl(assets, ch);
              const items = Array.isArray(u.topItems) ? u.topItems.slice(0, 3) : [];
              return (
                <a
                  key={u.characterId}
                  href={`/tft/units/${encodeURIComponent(u.characterId)}`}
                  onClick={e => e.stopPropagation()}
                  className="flex flex-col items-center gap-0.5 hover:scale-105 transition"
                  title={ch?.name || u.characterId}
                >
                  <div
                    className="w-11 h-11 rounded border-2 overflow-hidden"
                    style={{ borderColor: isCarry ? '#c39bff' : (ch ? costColorOf(ch.cost) : '#1e2a3a') }}
                  >
                    {url && <img src={url} alt={ch?.name || u.characterId} className="w-full h-full object-cover rounded-sm" />}
                  </div>
                  {items.length > 0 && (
                    <div className="flex items-center gap-[1px]">
                      {items.map(it => {
                        const meta = findItem(assets, it.apiName);
                        const iconUrl = tftIconUrl(assets, meta?.icon);
                        return (
                          <a
                            key={it.apiName}
                            href={`/tft/items/${encodeURIComponent(it.apiName)}`}
                            onClick={e => e.stopPropagation()}
                            className="w-[14px] h-[14px] rounded-sm bg-[#0a0e1a] border border-[#1e2a3a] overflow-hidden block hover:border-[#c39bff]/60"
                            title={meta?.name || it.apiName}
                          >
                            {iconUrl && <img src={iconUrl} alt={meta?.name || it.apiName} className="w-full h-full object-cover" />}
                          </a>
                        );
                      })}
                    </div>
                  )}
                </a>
              );
            })}
          </div>

          {/* typicalAugments-Block entfernt — Riot hat Augment-Stats untersagt.
              Daten kommen weiter in der API an (RPC unverändert), werden aber
              nicht mehr UI-seitig dargestellt. */}
        </div>

        {/* Stats: horizontal pills on mobile (wraps if needed),
            right-aligned column on desktop. */}
        <div className="flex items-stretch gap-2 sm:text-right flex-wrap sm:flex-nowrap">
          <Stat label="Avg" value={comp.avgPlacement?.toFixed(2) ?? '—'} accent={tier.color} />
          <Stat label="Top 4" value={comp.top4Rate != null ? `${(comp.top4Rate * 100).toFixed(0)}%` : '—'} />
          <Stat label={t('tft.win')} value={comp.top1Rate != null ? `${(comp.top1Rate * 100).toFixed(0)}%` : '—'} />
          <Stat label="Pick" value={comp.pickRate != null ? `${(comp.pickRate * 100).toFixed(2)}%` : '—'} />
          <div className="flex flex-col items-end justify-center pl-2 border-l border-[#1e2a3a]">
            <div className="text-[#7a8aa0] text-[9px] uppercase tracking-widest">{t('tft.games')}</div>
            <div className="text-[#a0b0c5] text-sm">{comp.games}</div>
          </div>
          {showVelocity && <VelocityStat velocity={comp.velocity} shift={velocityShift} t={t} />}
          <div className="flex items-center pl-2 border-l border-[#1e2a3a]">
            <PlanAheadButton
              characterIds={typicalUnits.slice(0, 10).map(u => u.characterId)}
              setNumber={assets?.set ?? 17}
              assets={assets}
              size="md"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col items-end justify-center min-w-[3.5rem]">
      <div className="text-[#7a8aa0] text-[9px] uppercase tracking-widest">{label}</div>
      <div className="text-base font-medium" style={{ color: accent || '#ffffff' }}>{value}</div>
    </div>
  );
}

// Δ-Vergleich-Pille — sitzt am Ende der Stats-Strip, links abgesetzt durch eine
// lila Trennlinie (passt zum Filter-Akzent in der Bar). Zeigt ▲/▼ + Wert in
// grün/rot, NEU für frisch erschienene Comps und "—" wenn unter Sample-Größe.
function VelocityStat({
  velocity, shift, t,
}: {
  velocity?: CompVelocity | null;
  shift: number;
  t: (key: any) => string;
}) {
  const label = shift > 0
    ? (t('tft.velocity.deltaVs') as string).replace('{n}', String(shift))
    : (t('tft.velocity.delta') as string);
  if (!velocity) {
    return (
      <div className="flex flex-col items-end justify-center min-w-[3.5rem] pl-2 border-l border-[#c39bff]/30" title={t('tft.velocity.notEnough') as string}>
        <div className="text-[#c39bff] text-[9px] uppercase tracking-widest">{label}</div>
        <div className="text-[#5a6a80] text-base">—</div>
      </div>
    );
  }
  if (velocity.isNew) {
    return (
      <div className="flex flex-col items-end justify-center min-w-[3.5rem] pl-2 border-l border-[#c39bff]/30">
        <div className="text-[#c39bff] text-[9px] uppercase tracking-widest">{label}</div>
        <div className="text-[#c39bff] text-base font-semibold">{t('tft.velocity.newComp')}</div>
      </div>
    );
  }
  if (velocity.deltaAvgPlace == null) {
    return (
      <div className="flex flex-col items-end justify-center min-w-[3.5rem] pl-2 border-l border-[#c39bff]/30" title={t('tft.velocity.notEnough') as string}>
        <div className="text-[#c39bff] text-[9px] uppercase tracking-widest">{label}</div>
        <div className="text-[#5a6a80] text-base">—</div>
      </div>
    );
  }
  const better = velocity.deltaAvgPlace < 0;
  const color = better ? '#3ecf8e' : '#e44040';
  const arrow = better ? '▲' : '▼';
  const directionLabel = better ? (t('tft.velocity.better') as string) : (t('tft.velocity.worse') as string);
  const nowStr = velocity.avgPlaceNow != null ? velocity.avgPlaceNow.toFixed(2) : '—';
  const prevStr = velocity.avgPlacePrev != null ? velocity.avgPlacePrev.toFixed(2) : '—';
  const detail = (t('tft.velocity.tooltipDetail') as string)
    .replace('{now}', nowStr).replace('{prev}', prevStr);
  return (
    <div
      className="flex flex-col items-end justify-center min-w-[3.5rem] pl-2 border-l border-[#c39bff]/30"
      title={`${directionLabel} — ${detail}`}
    >
      <div className="text-[#c39bff] text-[9px] uppercase tracking-widest">{label}</div>
      <div className="text-base font-medium tabular-nums" style={{ color }}>
        {arrow} {Math.abs(velocity.deltaAvgPlace).toFixed(2)}
      </div>
    </div>
  );
}

function parseClusterKey(
  key: string,
): { trait: string; level: number; carry: string; carryStar: number; buildStyle: 'damage'|'bruiser'|'tank'; secondary: string | null } | null {
  // Cluster-Key Format (alle Suffixe optional, in dieser Reihenfolge):
  //   <trait>@<level>_<carryUnit>[*N][+t|+b][#<unitId>]
  //     *N  = Carry-Star (z.B. *3 = 3-Star-Reroll-Variante)
  //     +t  = Tank-Build (Tank-Items auf Carry, z.B. Two-Tanky-Augment-Build)
  //     +b  = Bruiser-Build (mix Tank + Damage)
  //     #ID = Secondary-Damage-Carry-Variante
  const m = /^(.+)@(\d+)_([^#*+]+)(?:\*(\d))?(?:\+([tb]))?(?:#(.+))?$/.exec(key);
  if (!m) return null;
  return {
    trait: m[1],
    level: Number(m[2]),
    carry: m[3],
    carryStar: m[4] ? Number(m[4]) : 2,
    buildStyle: m[5] === 't' ? 'tank' : m[5] === 'b' ? 'bruiser' : 'damage',
    secondary: m[6] || null,
  };
}

// Pull a constellation/variant suffix out of trait apiNames that ship multiple
// flavours of the same name. Set 17 Stargazer has seven: Mountain, Serpent,
// Huntress, Medallion, Fountain, Wolf, Shield — all of which load with the
// display name "Stargazer". We extract the suffix after the canonical
// traitName so the UI can disambiguate them. Returns null when the apiName
// doesn't follow the variant pattern.
function extractTraitVariant(traitApiName: string, traitDisplayName: string): string | null {
  const stripped = traitApiName.replace(/^TFT\d+_/, '');
  if (!stripped.includes('_')) return null;
  const variant = stripped.split('_').slice(1).join(' ');
  if (!variant) return null;
  // Skip the case where the suffix already matches the display name (e.g. a
  // trait whose apiName encodes the same word the asset bundle already shows).
  if (variant.toLowerCase() === traitDisplayName.toLowerCase()) return null;
  return variant;
}
function prettyTrait(s: string) { return s.replace(/^TFT\d+_/, ''); }
function prettyChar(s: string) { return s.replace(/^TFT\d+_/, ''); }
