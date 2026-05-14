'use client';
import { useEffect, useState } from 'react';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import TftHero from '../../components/tft/TftHero';
import { useI18n } from '../../lib/i18n';

// Patch-list page. One row per (patch, set) tuple with sample size and
// date range. Each row links to /tft/patch/[version] for the full
// winners/losers breakdown.

interface PatchInfo {
  patch: string;
  set_number: number;
  first_day: string;
  last_day: string;
  total_matches: number;
}

export default function TftPatchListPage() {
  const { t, lang } = useI18n();
  const [patches, setPatches] = useState<PatchInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/tft/available-patches?days=180')
      .then(r => r.json())
      .then(d => { setPatches(d.patches || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="comps" />
      <TftHero pageTitle={t('tft.patchNotes.title')} />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-2 pb-6">
        <p className="text-[#a0b0c5] text-sm mb-4">{t('tft.patchNotes.subtitle')}</p>

        {loading && <div className="text-[#7a8aa0] text-center py-8">{t('tft.loading')}</div>}

        {!loading && patches.length === 0 && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 text-center text-[#a0b0c5] text-sm">
            {t('tft.patchNotes.empty')}
          </div>
        )}

        {!loading && patches.length > 0 && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded overflow-hidden">
            {patches.map((p, i) => (
              <a
                key={`${p.patch}-${p.set_number}`}
                href={`/tft/patch/${encodeURIComponent(p.patch)}`}
                className={`block px-4 py-3 hover:bg-white/5 ${i === 0 ? '' : 'border-t border-[#1e2a3a]'}`}
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-white text-base font-medium">
                      Patch {p.patch}
                      {i === 0 && (
                        <span className="ml-2 text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-[#7B61FF]/20 text-[#7B61FF]">
                          {t('tft.patchNotes.current')}
                        </span>
                      )}
                    </div>
                    <div className="text-[#a0b0c5] text-xs mt-0.5">
                      Set {p.set_number} · {new Date(p.first_day).toLocaleDateString()} – {new Date(p.last_day).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[#7B61FF] text-sm font-medium tabular-nums">
                      {p.total_matches.toLocaleString()}
                    </div>
                    <div className="text-[#7a8aa0] text-[10px] uppercase tracking-widest">
                      {t('tft.patchNotes.matches')}
                    </div>
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}
