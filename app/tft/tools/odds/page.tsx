'use client';
import { useMemo, useState } from 'react';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import { useI18n } from '../../../lib/i18n';

// Roll-odds calculator: champion-hit probability per shop, expected gold
// to next hit, expected gold to reach 2-/3-star. Pure client-side math
// against verified Set 17 (Space Gods) shop odds + bag sizes.
// Source: esportstales.com champion-pool-size-and-draw-chances (Set 17).

const SHOP_ODDS: Record<number, [number, number, number, number, number]> = {
  // [tier1, tier2, tier3, tier4, tier5] in % per shop slot
  2:  [100,  0,  0,  0,  0],
  3:  [ 75, 25,  0,  0,  0],
  4:  [ 55, 30, 15,  0,  0],
  5:  [ 45, 33, 20,  2,  0],
  6:  [ 30, 40, 25,  5,  0],
  7:  [ 19, 30, 40, 10,  1],
  8:  [ 17, 24, 32, 24,  3],
  9:  [ 15, 18, 25, 30, 12],
  10: [  5, 10, 20, 40, 25],
  11: [  1,  2, 12, 50, 35],
};

// Bag size per champion at this cost (Set 17, verified 2026-06-07).
const BAG_SIZE: Record<number, number> = { 1: 30, 2: 25, 3: 18, 4: 10, 5: 9 };

// Unique champions per cost in Set 17 (counted from public/tft-assets.json
// 2026-06-07; excludes summoned/treasure units that aren't rolled in shops).
const UNIQUE_CHAMPS: Record<number, number> = { 1: 18, 2: 13, 3: 13, 4: 14, 5: 10 };

const SHOP_SLOTS = 5;
const ROLL_COST_GOLD = 2;

interface Inputs {
  cost: 1 | 2 | 3 | 4 | 5;
  level: number;
  copiesOwned: number;
  copiesContested: number; // copies bought by other lobby players
}

interface Outputs {
  totalPoolForCost: number;
  copiesLeft: number;
  pCostPerSlot: number;          // % chance any cost-N unit in one slot
  pSpecificPerSlot: number;      // % chance the specific champion in one slot
  pSpecificPerShop: number;      // % chance ≥1 of the specific champ in a 5-slot shop
  expectedRollsToNextHit: number;
  expectedGoldToNextHit: number;
  copiesTo2Star: number;
  copiesTo3Star: number;
  expectedRollsTo2Star: number | null;
  expectedRollsTo3Star: number | null;
  expectedGoldTo2Star: number | null;
  expectedGoldTo3Star: number | null;
}

function compute({ cost, level, copiesOwned, copiesContested }: Inputs): Outputs {
  const odds = SHOP_ODDS[level] || SHOP_ODDS[8];
  const pCostPerSlot = (odds[cost - 1] || 0) / 100;
  const bagPerChamp = BAG_SIZE[cost];
  const uniqueAtCost = UNIQUE_CHAMPS[cost];
  const totalPoolForCost = bagPerChamp * uniqueAtCost;
  const copiesLeft = Math.max(0, bagPerChamp - copiesOwned - copiesContested);
  const pChampGivenCost = totalPoolForCost > 0 ? copiesLeft / totalPoolForCost : 0;
  const pSpecificPerSlot = pCostPerSlot * pChampGivenCost;
  const pSpecificPerShop = 1 - Math.pow(1 - pSpecificPerSlot, SHOP_SLOTS);
  const expectedRollsToNextHit = pSpecificPerShop > 0 ? 1 / pSpecificPerShop : Infinity;
  const expectedGoldToNextHit = expectedRollsToNextHit * ROLL_COST_GOLD;

  const copiesTo2Star = Math.max(0, 3 - copiesOwned);
  const copiesTo3Star = Math.max(0, 9 - copiesOwned);
  // Each hit reduces copiesLeft by 1 in the shared pool; approximate
  // milestone-roll expectation as sum of geometric expectations under
  // shrinking pool. Stops if we run out of pool.
  function expectedRollsToHit(needed: number): number | null {
    if (needed === 0) return 0;
    let rolls = 0;
    let left = copiesLeft;
    for (let k = 0; k < needed; k++) {
      if (left <= 0) return null;
      const pSlot = pCostPerSlot * (left / totalPoolForCost);
      const pShop = 1 - Math.pow(1 - pSlot, SHOP_SLOTS);
      if (pShop <= 0) return null;
      rolls += 1 / pShop;
      left -= 1;
    }
    return rolls;
  }
  const r2 = expectedRollsToHit(copiesTo2Star);
  const r3 = expectedRollsToHit(copiesTo3Star);

  return {
    totalPoolForCost,
    copiesLeft,
    pCostPerSlot,
    pSpecificPerSlot,
    pSpecificPerShop,
    expectedRollsToNextHit,
    expectedGoldToNextHit,
    copiesTo2Star,
    copiesTo3Star,
    expectedRollsTo2Star: r2,
    expectedRollsTo3Star: r3,
    expectedGoldTo2Star: r2 == null ? null : r2 * ROLL_COST_GOLD,
    expectedGoldTo3Star: r3 == null ? null : r3 * ROLL_COST_GOLD,
  };
}

const COST_COLORS: Record<number, string> = {
  1: '#a0b0c5', 2: '#3ecf8e', 3: '#3a8ddc', 4: '#c39bff', 5: '#e0c75a',
};

export default function TftRollOddsPage() {
  const { t } = useI18n();
  const [cost, setCost] = useState<1 | 2 | 3 | 4 | 5>(4);
  const [level, setLevel] = useState(8);
  const [copiesOwned, setCopiesOwned] = useState(0);
  const [copiesContested, setCopiesContested] = useState(0);

  const out = useMemo(() => compute({ cost, level, copiesOwned, copiesContested }), [cost, level, copiesOwned, copiesContested]);

  const fmtPct = (p: number) => p < 0.001 ? '< 0.1%' : `${(p * 100).toFixed(p < 0.01 ? 2 : 1)}%`;
  const fmtNum = (n: number | null) => n == null ? '—' : !Number.isFinite(n) ? '∞' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n >= 100 ? Math.round(n).toLocaleString('de-DE') : n.toFixed(1);

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="tools" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <div className="bg-surface-base border border-border-subtle rounded-lg p-5 mb-5">
          <h1 className="text-white text-xl font-medium">{t('tft.tools.odds.title')}</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.5fr] gap-4">
          {/* Inputs */}
          <div className="bg-surface-base border border-border-subtle rounded-lg p-4 space-y-4">
            <div>
              <div className="text-fg-muted text-[11px] uppercase tracking-widest mb-1.5">{t('tft.tools.odds.cost')}</div>
              <div className="flex gap-1">
                {([1, 2, 3, 4, 5] as const).map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCost(c)}
                    className={`flex-1 py-2 text-sm rounded border transition-colors tabular-nums ${
                      cost === c
                        ? 'border-current text-white'
                        : 'border-border-subtle bg-surface-raised text-fg-secondary hover:border-border-subtle'
                    }`}
                    style={{ color: cost === c ? COST_COLORS[c] : undefined, backgroundColor: cost === c ? `${COST_COLORS[c]}22` : undefined }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-fg-muted text-[11px] uppercase tracking-widest">{t('tft.tools.odds.level')}</span>
                <span className="text-white text-sm tabular-nums">{level}</span>
              </div>
              <input
                type="range" min={2} max={11} value={level}
                onChange={e => setLevel(Number(e.target.value))}
                className="w-full accent-accent"
              />
              <div className="flex justify-between text-fg-faint text-[10px] mt-1 tabular-nums">
                <span>2</span><span>4</span><span>6</span><span>8</span><span>10</span>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-fg-muted text-[11px] uppercase tracking-widest">{t('tft.tools.odds.copiesOwned')}</span>
                <span className="text-white text-sm tabular-nums">{copiesOwned}</span>
              </div>
              <input
                type="range" min={0} max={BAG_SIZE[cost]} value={copiesOwned}
                onChange={e => setCopiesOwned(Number(e.target.value))}
                className="w-full accent-accent"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-fg-muted text-[11px] uppercase tracking-widest">{t('tft.tools.odds.copiesContested')}</span>
                <span className="text-white text-sm tabular-nums">{copiesContested}</span>
              </div>
              <input
                type="range" min={0} max={BAG_SIZE[cost] - copiesOwned} value={Math.min(copiesContested, BAG_SIZE[cost] - copiesOwned)}
                onChange={e => setCopiesContested(Number(e.target.value))}
                className="w-full accent-accent"
              />
            </div>

            <div className="pt-2 border-t border-border-subtle grid grid-cols-2 gap-2 text-[11px]">
              <Stat label={t('tft.tools.odds.totalPool')} value={out.totalPoolForCost.toLocaleString('de-DE')} />
              <Stat label={t('tft.tools.odds.copiesLeft')} value={out.copiesLeft.toString()} accent={COST_COLORS[cost]} />
            </div>
          </div>

          {/* Outputs */}
          <div className="space-y-4">
            <Section title={t('tft.tools.odds.hitChance')}>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <BigStat label={t('tft.tools.odds.perSlot')} value={fmtPct(out.pSpecificPerSlot)} />
                <BigStat label={t('tft.tools.odds.perShop')} value={fmtPct(out.pSpecificPerShop)} accent={COST_COLORS[cost]} />
                <BigStat label={t('tft.tools.odds.costAtLevel')} value={fmtPct(out.pCostPerSlot)} />
              </div>
            </Section>

            <Section title={t('tft.tools.odds.expected')}>
              <div className="space-y-2">
                <Row label={t('tft.tools.odds.toNextHit')} rolls={fmtNum(out.expectedRollsToNextHit)} gold={fmtNum(out.expectedGoldToNextHit)} />
                <Row
                  label={t('tft.tools.odds.toTwoStar')}
                  rolls={out.copiesTo2Star === 0 ? '✓' : fmtNum(out.expectedRollsTo2Star)}
                  gold={out.copiesTo2Star === 0 ? '✓' : fmtNum(out.expectedGoldTo2Star)}
                  highlight={out.copiesTo2Star === 0}
                />
                <Row
                  label={t('tft.tools.odds.toThreeStar')}
                  rolls={out.copiesTo3Star === 0 ? '✓' : fmtNum(out.expectedRollsTo3Star)}
                  gold={out.copiesTo3Star === 0 ? '✓' : fmtNum(out.expectedGoldTo3Star)}
                  highlight={out.copiesTo3Star === 0}
                />
              </div>
            </Section>

            <Section title={t('tft.tools.odds.shopOddsTable')}>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] tabular-nums">
                  <thead>
                    <tr className="text-fg-muted border-b border-border-subtle">
                      <th className="text-left px-2 py-1.5 font-normal">{t('tft.tools.odds.level')}</th>
                      {([1, 2, 3, 4, 5] as const).map(c => (
                        <th key={c} className="text-right px-2 py-1.5 font-normal" style={{ color: COST_COLORS[c] }}>{c}-{t('tft.tools.odds.costShort')}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(SHOP_ODDS).map(([lvl, odds]) => {
                      const isActive = Number(lvl) === level;
                      return (
                        <tr
                          key={lvl}
                          className={`border-b border-border-subtle/50 last:border-0 cursor-pointer transition-colors ${isActive ? 'bg-accent-a10' : 'hover:bg-surface-raised'}`}
                          onClick={() => setLevel(Number(lvl))}
                        >
                          <td className={`px-2 py-1.5 ${isActive ? 'text-[#c39bff] font-medium' : 'text-white'}`}>{lvl}</td>
                          {odds.map((p, i) => (
                            <td
                              key={i}
                              className={`text-right px-2 py-1.5 ${cost === i + 1 && isActive ? 'font-medium' : 'text-fg-secondary'}`}
                              style={cost === i + 1 && isActive ? { color: COST_COLORS[i + 1] } : undefined}
                            >
                              {p}%
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
          </div>
        </div>
      </div>
      <Footer />
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface-base border border-border-subtle rounded-lg p-4">
      <h2 className="text-fg-muted text-[11px] uppercase tracking-widest mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div className="text-fg-muted text-[10px] uppercase tracking-widest">{label}</div>
      <div className="text-sm font-medium tabular-nums" style={{ color: accent || '#ffffff' }}>{value}</div>
    </div>
  );
}

function BigStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-surface-raised border border-border-subtle rounded p-2.5">
      <div className="text-fg-muted text-[10px] uppercase tracking-widest">{label}</div>
      <div className="text-lg font-medium tabular-nums" style={{ color: accent || '#ffffff' }}>{value}</div>
    </div>
  );
}

function Row({ label, rolls, gold, highlight }: { label: string; rolls: string; gold: string; highlight?: boolean }) {
  return (
    <div className={`flex items-center gap-3 bg-surface-raised border border-border-subtle rounded p-2.5 ${highlight ? 'opacity-60' : ''}`}>
      <div className="flex-1 text-fg-secondary text-sm">{label}</div>
      <div className="text-right">
        <div className="text-white text-sm font-medium tabular-nums">{rolls}</div>
        <div className="text-fg-muted text-[10px] uppercase tracking-widest">Rolls</div>
      </div>
      <div className="text-right border-l border-border-subtle pl-3">
        <div className="text-[#e0c75a] text-sm font-medium tabular-nums">{gold}</div>
        <div className="text-fg-muted text-[10px] uppercase tracking-widest">Gold</div>
      </div>
    </div>
  );
}
