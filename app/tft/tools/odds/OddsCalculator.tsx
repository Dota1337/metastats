'use client';
import { useMemo, useState } from 'react';
import { withAlpha } from '../../../lib/color';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import { useI18n } from '../../../lib/i18n';
import type { CostTier, UniqueChampsPerCost } from '../../../lib/tft-shop-pool';
import { SHOP_ODDS, BAG_SIZE, clampInt as clamp, computeRollOdds as compute } from '../../../lib/tft-roll-odds';

// Roll-Rechner: Trefferchance pro Shop, erwartetes Gold bis zum naechsten
// Exemplar und bis 2-/3-Stern.
//
// Die Rechnung selbst liegt in app/lib/tft-roll-odds.ts — dort ohne React und
// ohne Dateizugriff, damit sie in app/lib/tft-roll-odds.test.mjs geprueft
// werden kann. Hier steht nur die Oberflaeche.
//
// Die Zahl der verschiedenen Einheiten je Kostenstufe kommt als Eigenschaft
// von der Server-Huelle (page.tsx) und wird dort aus dem Asset-Bundle
// abgeleitet — siehe app/lib/tft-shop-pool.ts. Hier steht sie bewusst NICHT
// mehr als Konstante.

const COST_COLORS: Record<number, string> = {
  1: 'var(--fg-secondary)', 2: '#3ecf8e', 3: '#3a8ddc', 4: '#c39bff', 5: '#e0c75a',
};

export default function OddsCalculator({ uniqueChamps }: { uniqueChamps: UniqueChampsPerCost }) {
  const { t } = useI18n();
  const [cost, setCost] = useState<CostTier>(4);
  const [level, setLevel] = useState(8);
  const [copiesOwned, setCopiesOwned] = useState(0);
  const [copiesContested, setCopiesContested] = useState(0);
  const [othersOut, setOthersOut] = useState(0);

  // Geklemmt wird an EINER Stelle, und die Regler zeigen exakt die Werte, mit
  // denen gerechnet wird. Vorher zeigte der Regler fuer fremde Kopien einen
  // geklemmten Wert an, waehrend die Rechnung den ungeklemmten bekam.
  const bagPerChamp = BAG_SIZE[cost];
  const totalPool = bagPerChamp * (uniqueChamps[cost] || 0);
  const othersMax = Math.max(0, totalPool - bagPerChamp);
  const owned = clamp(copiesOwned, 0, bagPerChamp);
  const contested = clamp(copiesContested, 0, bagPerChamp - owned);
  const others = clamp(othersOut, 0, othersMax);

  const out = useMemo(
    () => compute({ cost, level, copiesOwned: owned, copiesContested: contested, othersOut: others, uniqueChamps }),
    [cost, level, owned, contested, others, uniqueChamps],
  );

  // Kostenwechsel aendert Tuetengroesse und Pool. Ohne Nachklemmen bleibt ein
  // Wert stehen, der fuer die neue Stufe zu gross ist.
  function selectCost(c: CostTier) {
    const bag = BAG_SIZE[c];
    const pool = bag * (uniqueChamps[c] || 0);
    const nextOwned = clamp(copiesOwned, 0, bag);
    setCost(c);
    setCopiesOwned(nextOwned);
    setCopiesContested(clamp(copiesContested, 0, bag - nextOwned));
    setOthersOut(clamp(othersOut, 0, Math.max(0, pool - bag)));
  }

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
                    onClick={() => selectCost(c)}
                    className={`flex-1 py-2 text-sm rounded border transition-colors tabular-nums ${
                      cost === c
                        ? 'border-current text-white'
                        : 'border-border-subtle bg-surface-raised text-fg-secondary hover:border-border-subtle'
                    }`}
                    style={{ color: cost === c ? COST_COLORS[c] : undefined, backgroundColor: cost === c ? `${withAlpha(COST_COLORS[c], 0x22)}` : undefined }}
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
                <span className="text-white text-sm tabular-nums">{owned}</span>
              </div>
              <input
                type="range" min={0} max={bagPerChamp} value={owned}
                onChange={e => setCopiesOwned(Number(e.target.value))}
                className="w-full accent-accent"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-fg-muted text-[11px] uppercase tracking-widest">{t('tft.tools.odds.copiesContested')}</span>
                <span className="text-white text-sm tabular-nums">{contested}</span>
              </div>
              <input
                type="range" min={0} max={bagPerChamp - owned} value={contested}
                onChange={e => setCopiesContested(Number(e.target.value))}
                className="w-full accent-accent"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-fg-muted text-[11px] uppercase tracking-widest">{t('tft.tools.odds.othersOut')}</span>
                <span className="text-white text-sm tabular-nums">{others}</span>
              </div>
              <input
                type="range" min={0} max={othersMax} value={others}
                onChange={e => setOthersOut(Number(e.target.value))}
                className="w-full accent-accent"
              />
            </div>

            <div className="pt-2 border-t border-border-subtle grid grid-cols-2 gap-2 text-[11px]">
              <Stat label={t('tft.tools.odds.totalPool')} value={`${out.poolLeft.toLocaleString('de-DE')} / ${out.totalPoolForCost.toLocaleString('de-DE')}`} />
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
      <div className="text-sm font-medium tabular-nums" style={{ color: accent || 'var(--fg-primary)' }}>{value}</div>
    </div>
  );
}

function BigStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-surface-raised border border-border-subtle rounded p-2.5">
      <div className="text-fg-muted text-[10px] uppercase tracking-widest">{label}</div>
      <div className="text-lg font-medium tabular-nums" style={{ color: accent || 'var(--fg-primary)' }}>{value}</div>
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
