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

// Riot-Patch-Notes-URL je Locale. KORRIGIERT 2026-06-21 nach classification-
// reviewer Spot-Check: richtige Subdomain ist `teamfighttactics.leagueof
// legends.com` (NICHT www.leagueoflegends.com), und das `-notes`-Suffix
// gehört NICHT mehr in den URL-Pfad (Set 17 hat `patch-X-Y/`, nicht
// `patch-X-Y-notes/`). Konsistent mit dem existing tftPatchUrl()-Helper
// in app/api/tft/patch-notes/route.ts.
export function riotPatchNotesUrl(patch: string, lang: string): string {
  const localeMap: Record<string, string> = {
    de: 'de-de', en: 'en-us', ko: 'ko-kr', zh: 'zh-cn', es: 'es-es', fr: 'fr-fr',
  };
  const locale = localeMap[lang] || 'en-us';
  const slug = patch.replace(/\./g, '-');
  return `https://teamfighttactics.leagueoflegends.com/${locale}/news/game-updates/teamfight-tactics-patch-${slug}/`;
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
    <main className="min-h-screen bg-surface-page">
      <Nav active="comps" />
      <TftHero pageTitle={t('tft.patchNotes.title')} />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-2 pb-6">
        <p className="text-fg-secondary text-sm mb-4">{t('tft.patchNotes.subtitle')}</p>

        {loading && <div className="text-fg-muted text-center py-8">{t('tft.loading')}</div>}

        {!loading && patches.length === 0 && (
          <div className="bg-surface-base border border-border-subtle rounded p-6 text-center text-fg-secondary text-sm">
            {t('tft.patchNotes.empty')}
          </div>
        )}

        {!loading && patches.length > 0 && (
          <div className="bg-surface-base border border-border-subtle rounded overflow-hidden">
            {patches.map((p, i) => (
              <div
                key={`${p.patch}-${p.set_number}`}
                className={`px-4 py-3 hover:bg-white/5 ${i === 0 ? '' : 'border-t border-border-subtle'}`}
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <a
                    href={`/tft/patch/${encodeURIComponent(p.patch)}`}
                    className="flex-1 min-w-0"
                  >
                    <div className="text-white text-base font-medium">
                      Patch {p.patch}
                      {i === 0 && (
                        <span className="ml-2 text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-accent-a20 text-accent">
                          {t('tft.patchNotes.current')}
                        </span>
                      )}
                    </div>
                    <div className="text-fg-secondary text-xs mt-0.5">
                      Set {p.set_number} · {new Date(p.first_day).toLocaleDateString()} – {new Date(p.last_day).toLocaleDateString()}
                    </div>
                  </a>
                  <div className="flex items-center gap-4">
                    <a
                      href={riotPatchNotesUrl(p.patch, lang)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-[10px] uppercase tracking-widest text-fg-secondary hover:text-accent flex items-center gap-1 transition-colors"
                      title={t('tft.patchNotes.officialLinkHint')}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                      <span className="hidden sm:inline">{t('tft.patchNotes.officialLink')}</span>
                    </a>
                    <div className="text-right">
                      <div className="text-accent text-sm font-medium tabular-nums">
                        {p.total_matches.toLocaleString()}
                      </div>
                      <div className="text-fg-muted text-[10px] uppercase tracking-widest">
                        {t('tft.patchNotes.matches')}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}
