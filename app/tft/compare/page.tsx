'use client';
import { useState } from 'react';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import { useI18n } from '../../lib/i18n';
import TftHero from '../../components/tft/TftHero';

interface PlayerSummary {
  name: string;
  tier: string | null;
  rank: string | null;
  lp: number | null;
  marketValue: number | null;
  rated: boolean;
  avgPlacement: number | null;
  top4Rate: number | null;
  matches: number;
}

export default function TftComparePage() {
  const { t } = useI18n();
  const [inputs, setInputs] = useState<string[]>(['', '']);
  const [region, setRegion] = useState('euw1');
  const [results, setResults] = useState<(PlayerSummary | { error: string } | null)[]>([null, null]);
  const [loading, setLoading] = useState(false);

  const compare = async () => {
    setLoading(true);
    const next: (PlayerSummary | { error: string } | null)[] = inputs.map(() => null);
    setResults(next);
    await Promise.all(inputs.map(async (raw, i) => {
      const name = raw.trim();
      if (!name) { next[i] = null; setResults([...next]); return; }
      try {
        const r = await fetch(`/api/tft/marktwert?name=${encodeURIComponent(name)}&region=${region}`);
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          next[i] = { error: j.error || `HTTP ${r.status}` };
        } else {
          const d = await r.json();
          // Pull avg placement from the marketvalue agents' performance score
          const perf = d.marketValue?.agents?.find((a: any) => a.agent === 'performance');
          const avgNote = perf?.notes?.find((n: any) => n.label === 'avg-placement');
          const top4Note = perf?.notes?.find((n: any) => n.label === 'top-4 rate');
          next[i] = {
            name: d.summoner?.name || name,
            tier: d.summoner?.tier || null,
            rank: d.summoner?.rank || null,
            lp: d.summoner?.lp ?? null,
            marketValue: d.marketValue?.finalValue ?? null,
            rated: !!d.marketValue?.rated,
            avgPlacement: avgNote?.detail ? Number(avgNote.detail) : null,
            top4Rate: top4Note?.detail ? Number(String(top4Note.detail).replace('%', '')) / 100 : null,
            matches: d.marketValue?.sampleSize ?? 0,
          };
        }
      } catch (e: any) {
        next[i] = { error: e.message };
      }
      setResults([...next]);
    }));
    setLoading(false);
  };

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="analyse" />
      <TftHero pageTitle={t('nav.analyse')} />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-2 pb-6">


        <div className="flex flex-wrap gap-2 mb-3">
          {['euw1', 'kr', 'na1'].map(r => (
            <button key={r}
                    onClick={() => setRegion(r)}
                    className={`px-3 py-1.5 rounded text-xs font-medium ${region === r ? 'bg-[#7B61FF] text-white' : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white'}`}>
              {r === 'euw1' ? 'EUW' : r === 'kr' ? 'KR' : 'NA'}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          {inputs.map((v, i) => (
            <input
              key={i}
              type="text"
              value={v}
              onChange={e => setInputs(prev => prev.map((p, idx) => idx === i ? e.target.value : p))}
              placeholder={`Spieler ${i + 1} (Name#Tag)`}
              className="bg-[#141c2e] border border-[#1e2a3a] rounded px-3 py-2 text-white text-sm outline-none focus:border-[#7B61FF]/60"
            />
          ))}
        </div>
        <button
          onClick={compare}
          disabled={loading}
          className="bg-[#7B61FF] hover:bg-[#7B61FF]/80 text-white text-sm px-4 py-2 rounded mb-5 disabled:opacity-50"
        >
          {loading ? 'Vergleiche ...' : 'Vergleichen'}
        </button>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {results.map((r, i) => {
            if (!r) return <div key={i} className="bg-[#0d1526] border border-[#1e2a3a] rounded p-5 text-[#4a5a70] text-sm text-center">Spieler {i + 1}</div>;
            if ('error' in r) return <div key={i} className="bg-red-500/10 border border-red-500/30 rounded p-4 text-red-400 text-sm">{r.error}</div>;
            return (
              <div key={i} className="bg-[#0d1526] border border-[#1e2a3a] rounded p-5">
                <div className="text-white text-base font-medium mb-1">{r.name}</div>
                <div className="text-[#8a9bb0] text-xs mb-3">{r.tier || 'Unranked'} {r.rank || ''} {r.lp != null ? `· ${r.lp} LP` : ''}</div>
                <div className="space-y-1 text-xs">
                  <Row label={t('tft.avgPlacement')} value={r.avgPlacement?.toFixed(2) ?? '—'} />
                  <Row label={t('tft.top4')} value={r.top4Rate != null ? `${(r.top4Rate * 100).toFixed(0)}%` : '—'} />
                  <Row label={t('tft.gamesShort')} value={String(r.matches)} />
                  <Row label="Marktwert" value={r.rated && r.marketValue != null ? `${r.marketValue.toLocaleString('de-DE')} €` : '—'} highlight />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <Footer />
    </main>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-[#4a5a70]">{label}</span>
      <span className={highlight ? 'text-[#7B61FF] font-medium' : 'text-white'}>{value}</span>
    </div>
  );
}
