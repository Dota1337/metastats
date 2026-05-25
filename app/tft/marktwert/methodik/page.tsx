'use client';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import TftHero from '../../../components/tft/TftHero';
import { useI18n } from '../../../lib/i18n';

// Order + weights mirror the skill-score model (see scripts/lib/tft-marketvalue.mjs).
// The `key` doubles as the anchor id so SignalRow deep-links (…/methodik#performance)
// land on the matching card.
const SIGNALS: { key: string; labelKey: string; weight: number }[] = [
  { key: 'performance',   labelKey: 'tft.marketValue.agent.performance',   weight: 30 },
  { key: 'metaRelative',  labelKey: 'tft.marketValue.agent.metaRelative',  weight: 25 },
  { key: 'consistency',   labelKey: 'tft.marketValue.agent.consistency',   weight: 15 },
  { key: 'gameSense',     labelKey: 'tft.marketValue.agent.gameSense',     weight: 10 },
  { key: 'flexMastery',   labelKey: 'tft.marketValue.agent.flexMastery',   weight: 10 },
  { key: 'boardStrength', labelKey: 'tft.marketValue.agent.boardStrength', weight: 10 },
];

export default function MarktwertMethodikPage() {
  const { t } = useI18n();
  // Plain Q&A blocks rendered top-to-bottom; each `id` is a deep-link anchor.
  const qa = [
    { id: 'what',   q: t('tft.mv.method.q.what'), a: t('tft.mv.method.a.what') },
    { id: 'base',   q: t('tft.mv.method.q.base'), a: t('tft.mv.method.a.base') },
    { id: 'zscore', q: t('tft.mv.method.q.z'),    a: t('tft.mv.method.a.z') },
  ];

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="marktwert" />
      <TftHero pageTitle={t('tft.mv.method.title')} />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-2 pb-10">
        <p className="text-[#a0b0c5] text-sm mb-6">{t('tft.mv.method.intro')}</p>

        {qa.map(item => (
          <section key={item.id} id={item.id} className="scroll-mt-24 mb-6">
            <h2 className="text-white font-semibold text-base mb-1.5">{item.q}</h2>
            <p className="text-[#a0b0c5] text-sm leading-relaxed">{item.a}</p>
          </section>
        ))}

        {/* The six signals — each card is its own anchor for the deep-links. */}
        <section id="signals" className="scroll-mt-24 mb-6">
          <h2 className="text-white font-semibold text-base mb-1.5">{t('tft.mv.method.q.signals')}</h2>
          <p className="text-[#a0b0c5] text-sm leading-relaxed mb-3">{t('tft.mv.method.a.signals')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {SIGNALS.map(s => (
              <div
                key={s.key}
                id={s.key}
                className="scroll-mt-24 bg-[#0d1526] border border-[#1e2a3a] rounded p-3"
              >
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span className="text-white font-medium text-sm">{t(s.labelKey as any)}</span>
                  <span className="text-[#7a8aa0] text-xs tabular-nums flex-shrink-0">{s.weight}%</span>
                </div>
                <p className="text-[#a0b0c5] text-xs leading-relaxed">{t(`tft.mv.method.sig.${s.key}` as any)}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="multiplier" className="scroll-mt-24 mb-6">
          <h2 className="text-white font-semibold text-base mb-1.5">{t('tft.mv.method.q.mult')}</h2>
          <p className="text-[#a0b0c5] text-sm leading-relaxed">{t('tft.mv.method.a.mult')}</p>
        </section>

        <section className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
          <h2 className="text-white font-semibold text-sm mb-1.5">{t('tft.mv.method.q.example')}</h2>
          <p className="text-[#a0b0c5] text-sm leading-relaxed">{t('tft.mv.method.a.example')}</p>
        </section>
      </div>
      <Footer />
    </main>
  );
}
