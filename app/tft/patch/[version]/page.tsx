'use client';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import { useI18n } from '../../../lib/i18n';
import { loadTftAssets, tftIconUrl, tftChampionTileUrl, type TftAssetsBundle } from '../../../lib/tft-cdragon';
import { riotPatchNotesUrl } from '../page';
import { loadPatchNotes, patchNotesFor, patchEntityHref, type PatchNoteOverride } from '../../../lib/tft-patch-notes';
import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis,
  ReferenceLine, Tooltip as RechartsTooltip,
} from 'recharts';

// Per-patch winners/losers page. Diffs the current patch against the
// previous one using /api/tft/patch-diff. Three entity tabs (units / items
// / traits) — augments would be a fourth but Set 17 doesn't ship augments
// so we hide it until the data lands.

type Entity = 'unit' | 'item' | 'trait' | 'comp';
const ENTITIES: Entity[] = ['unit', 'item', 'trait', 'comp'];

interface DiffEntry {
  key: string;
  currentGames: number;
  previousGames: number;
  currentAvgPlacement: number;
  previousAvgPlacement: number;
  deltaAvgPlacement: number;
  currentPickRate: number;
  previousPickRate: number;
  deltaPickRate: number;
  currentTop4Rate: number;
  previousTop4Rate: number;
  deltaTop4Rate: number;
}

interface DiffResponse {
  hasData: boolean;
  currentPatch?: string;
  previousPatch?: string | null;
  entity?: Entity;
  sampleSize?: number;
  winners?: DiffEntry[];
  losers?: DiffEntry[];
  reason?: string;
}

export default function TftPatchDetailPage() {
  const { t, lang } = useI18n();
  const params = useParams();
  const search = useSearchParams();
  const version = decodeURIComponent(String(params?.version || ''));
  const [entity, setEntity] = useState<Entity>('unit');
  const [bucket, setBucket] = useState<string>(search.get('bucket') || 'master_plus');
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [patchNotesOverride, setPatchNotesOverride] = useState<PatchNoteOverride | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);
  useEffect(() => { loadPatchNotes().then(setPatchNotesOverride); }, []);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/tft/patch-diff?patch=${encodeURIComponent(version)}&entity=${entity}&bucket=${bucket}`)
      .then(r => r.json())
      .then(d => { setDiff(d); setLoading(false); })
      .catch(() => { setDiff({ hasData: false }); setLoading(false); });
  }, [version, entity, bucket]);

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="comps" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <a href="/tft/patch" className="text-accent text-xs hover:underline">← {t('tft.patchNotes.title')}</a>

        <div className="flex items-start justify-between gap-3 mt-3 mb-1 flex-wrap">
          <h1 className="text-white text-2xl font-medium">Patch {version}</h1>
          <a
            href={riotPatchNotesUrl(version, lang)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-surface-raised border border-border-subtle text-fg-secondary hover:text-white hover:border-accent-a50 text-xs transition-colors"
            title={t('tft.patchNotes.officialLinkHint')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            {t('tft.patchNotes.officialLink')}
          </a>
        </div>
        {diff?.previousPatch && (
          <p className="text-fg-secondary text-sm mb-4">
            {t('tft.patchNotes.comparedTo')} <strong className="text-white">Patch {diff.previousPatch}</strong>
            {diff.sampleSize != null && ` · ${diff.sampleSize} ${t('tft.patchNotes.entitiesCompared')}`}
          </p>
        )}

        {/* Patch-Notes-Inhalt aus tactics.tools-Override
            (refresh-patch-notes.mjs). Render NUR wenn der Override-File
            diesen Patch enthält — sonst zeigt nur der existing Winners/
            Losers-Diff (Phase 1). Pattern matched feedback_no_info_texts:
            keine „kommt gleich"-Placeholder bei fehlenden Daten. */}
        {(() => {
          const notes = patchNotesFor(patchNotesOverride, version);
          if (!notes || notes.sections.length === 0) return null;
          return (
            <section className="mb-5 bg-surface-base border border-border-subtle rounded-lg p-4">
              <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-3">
                {t('tft.patchNotes.changes')}
              </h2>
              <div className="space-y-4">
                {notes.sections.map((sec, si) => (
                  <div key={si}>
                    <div className="text-accent text-[10px] uppercase tracking-widest font-semibold mb-2">
                      {sec.category}
                    </div>
                    <div className="space-y-1.5">
                      {sec.entries.map((e, ei) => {
                        const href = patchEntityHref(e.apiName);
                        const Tag = href ? 'a' : 'div';
                        return (
                          <Tag
                            key={ei}
                            {...(href ? { href } : {})}
                            className={`block bg-surface-raised border border-border-subtle rounded p-2.5 text-xs ${
                              href ? 'hover:border-accent-a40 transition-colors cursor-pointer' : ''
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              {e.apiName && (
                                <span className="text-[#a892ff] text-[10px] uppercase tracking-wider font-medium flex-shrink-0 mt-0.5">
                                  {e.displayName || '—'}
                                </span>
                              )}
                              {!e.apiName && e.displayName && (
                                <span className="text-fg-muted text-[10px] uppercase tracking-wider flex-shrink-0 mt-0.5">
                                  {e.displayName}
                                </span>
                              )}
                              <span className="text-fg-bright text-xs leading-snug">
                                {e.change}
                              </span>
                            </div>
                          </Tag>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-fg-faint text-[10px] italic mt-3">
                {t('tft.patchNotes.changes.source')}
              </div>
            </section>
          );
        })()}

        {/* Entity tabs */}
        <div className="flex gap-1 border-b border-border-subtle mb-4">
          {ENTITIES.map(e => (
            <button
              key={e}
              onClick={() => setEntity(e)}
              className={`px-4 py-2 text-xs font-medium uppercase tracking-widest ${
                entity === e ? 'text-white border-b-2 border-accent' : 'text-fg-secondary hover:text-white'
              }`}
            >
              {t(`tft.patchNotes.entity.${e}` as const)}
            </button>
          ))}
        </div>

        {/* Tier-Bucket filter */}
        <div className="flex flex-wrap gap-1 mb-4">
          {['master_plus', 'challenger', 'grandmaster', 'master', 'diamond'].map(b => (
            <button
              key={b}
              onClick={() => setBucket(b)}
              className={`px-3 py-1 rounded text-xs ${bucket === b ? 'bg-accent text-white' : 'bg-surface-raised text-fg-secondary hover:text-white'}`}
            >
              {b.replace('_plus', '+').replace(/^./, c => c.toUpperCase())}
            </button>
          ))}
        </div>

        {loading && (
          <div className="bg-surface-base border border-border-subtle rounded p-6 text-center text-fg-secondary text-sm">
            {t('tft.loading')}
          </div>
        )}

        {!loading && (!diff?.hasData) && (
          <div className="bg-surface-base border border-border-subtle rounded p-6 text-center text-fg-secondary text-sm">
            {diff?.reason === 'single_patch'
              ? t('tft.patchNotes.singlePatch')
              : t('tft.patchNotes.empty')}
          </div>
        )}

        {!loading && diff?.hasData && (() => {
          // Diverging swing chart — same read as the winners overview: +swing
          // (improvement) green/right, −swing (regression) red/left.
          const nameOf = (key: string) => {
            if (entity === 'comp') {
              // cluster_key shape: `<trait>@<level>_<carry>` — combine trait
              // display name + carry champion so the label reads like the
              // comp listing (e.g. "Cyber City 3 · Yi").
              const m = /^(.+)@(\d+)_(.+)$/.exec(key);
              if (!m) return key.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '');
              const traitName = assets?.traits[m[1]]?.name || m[1].replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '');
              const carryName = assets?.champions[m[3]]?.name || m[3].replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '');
              return `${traitName} · ${carryName}`;
            }
            const base = key.split('@')[0];
            const meta = entity === 'unit' ? assets?.champions[base] : entity === 'item' ? assets?.items[base] : assets?.traits[base];
            return meta?.name || base.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '');
          };
          const top = [...(diff.winners || []).slice(0, 8), ...(diff.losers || []).slice(0, 8)];
          const rows = top
            .map(e => ({ key: e.key, name: nameOf(e.key), swing: Number((-e.deltaAvgPlacement).toFixed(3)) }))
            .sort((a, b) => b.swing - a.swing);
          if (rows.length === 0) return null;
          const max = Math.max(0.05, ...rows.map(r => Math.abs(r.swing)));
          return (
            <div className="bg-surface-base border border-border-subtle rounded p-4 mb-4">
              <div className="text-fg-secondary text-[10px] uppercase tracking-widest mb-2">{t('tft.patchWinners.swingChart')}</div>
              <div style={{ width: '100%', height: rows.length * 22 + 12 }}>
                <ResponsiveContainer>
                  <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 12 }}>
                    <XAxis type="number" domain={[-max, max]} hide />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10, fill: 'var(--fg-secondary)' }} axisLine={false} tickLine={false} />
                    <ReferenceLine x={0} stroke="#33445c" />
                    <RechartsTooltip
                      cursor={{ fill: 'rgba(123,97,255,0.08)' }}
                      contentStyle={{ backgroundColor: 'var(--surface-base)', border: '1px solid var(--border-subtle)', borderRadius: 6, fontSize: 12 }}
                      labelStyle={{ color: 'var(--fg-secondary)' }}
                      formatter={(v: any) => [`${Number(v) >= 0 ? '+' : '−'}${Math.abs(Number(v)).toFixed(2)} Ø`, t('tft.patchWinners.swing')]}
                    />
                    <Bar dataKey="swing" radius={[2, 2, 2, 2]} barSize={11}>
                      {rows.map(r => <Cell key={r.key} fill={r.swing >= 0 ? 'var(--pos-win)' : 'var(--pos-loss)'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })()}

        {!loading && diff?.hasData && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DiffColumn
              title={t('tft.patchNotes.winners')}
              entries={diff.winners || []}
              direction="up"
              entity={entity}
              assets={assets}
            />
            <DiffColumn
              title={t('tft.patchNotes.losers')}
              entries={diff.losers || []}
              direction="down"
              entity={entity}
              assets={assets}
            />
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}

function DiffColumn({
  title, entries, direction, entity, assets,
}: {
  title: string;
  entries: DiffEntry[];
  direction: 'up' | 'down';
  entity: Entity;
  assets: TftAssetsBundle | null;
}) {
  const headerColor = direction === 'up' ? 'text-[#3ecf8e]' : 'text-[#e44040]';
  return (
    <div className="bg-surface-base border border-border-subtle rounded overflow-hidden">
      <div className={`px-4 py-2 bg-surface-sunken text-xs uppercase tracking-widest ${headerColor}`}>
        {direction === 'up' ? '▲' : '▼'} {title}
      </div>
      {entries.length === 0 ? (
        <div className="p-4 text-fg-muted text-xs text-center">—</div>
      ) : entries.map(e => (
        <DiffRow key={e.key} entry={e} entity={entity} assets={assets} />
      ))}
    </div>
  );
}

function DiffRow({ entry, entity, assets }: { entry: DiffEntry; entity: Entity; assets: TftAssetsBundle | null }) {
  // Each entity has its own key shape, image source, and target page. The
  // old version routed all non-unit/item entries to /tft/traits/<key>, which
  // broke comp- and trait-rows (comp keys = "trait@level_carry", trait keys
  // = "traitId@activation" — both produced invalid URLs).
  let imageEl: React.ReactNode;
  let displayName: string;
  let href: string;

  if (entity === 'unit') {
    const champ = assets?.champions[entry.key];
    const churl = tftChampionTileUrl(assets, champ);
    imageEl = churl
      ? <img src={churl} alt={champ?.name || ''} className="w-9 h-9 rounded object-cover" />
      : <div className="w-9 h-9 rounded bg-surface-overlay" />;
    displayName = champ?.name || entry.key.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '');
    href = `/tft/units/${encodeURIComponent(entry.key)}`;
  } else if (entity === 'item') {
    const item = assets?.items[entry.key];
    const iurl = tftIconUrl(assets, item?.icon);
    imageEl = iurl
      ? <img src={iurl} alt={item?.name || ''} className="w-9 h-9 rounded" />
      : <div className="w-9 h-9 rounded bg-surface-overlay" />;
    displayName = item?.name || entry.key.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?(?:Item_)?/, '');
    href = `/tft/items/${encodeURIComponent(entry.key)}`;
  } else if (entity === 'comp') {
    const m = /^(.+)@(\d+)_(.+)$/.exec(entry.key);
    const trait = m && assets ? assets.traits[m[1]] : null;
    const carry = m && assets ? assets.champions[m[3]] : null;
    const churl = tftChampionTileUrl(assets, carry);
    imageEl = churl
      ? <img src={churl} alt={carry?.name || ''} className="w-9 h-9 rounded border border-[#c39bff]/60 object-cover" />
      : <div className="w-9 h-9 rounded bg-surface-overlay" />;
    displayName = m
      ? `${trait?.name || m[1].replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '')} · ${carry?.name || m[3].replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '')}`
      : entry.key;
    href = `/tft/comps/${encodeURIComponent(entry.key)}`;
  } else {
    const [traitId, activation] = entry.key.split('@');
    const trait = assets?.traits[traitId];
    const turl = tftIconUrl(assets, trait?.icon);
    imageEl = turl
      ? <img src={turl} alt={trait?.name || ''} className="w-9 h-9 rounded" />
      : <div className="w-9 h-9 rounded bg-surface-overlay" />;
    displayName = `${trait?.name || traitId.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '')}${activation ? ` (${activation})` : ''}`;
    href = `/tft/traits/${encodeURIComponent(traitId)}`;
  }

  const deltaColor = entry.deltaAvgPlacement < 0 ? '#3ecf8e' : '#e44040';
  return (
    <a
      href={href}
      className="grid grid-cols-[2.5rem_1fr_5rem_4rem] gap-2 px-4 py-2 items-center text-xs border-t border-border-subtle hover:bg-white/5"
    >
      {imageEl}
      <div className="text-white truncate">
        {displayName}
        <div className="text-fg-muted text-[10px]">
          {entry.currentAvgPlacement.toFixed(2)} ← {entry.previousAvgPlacement.toFixed(2)}
        </div>
      </div>
      <div className="text-right tabular-nums">
        <div className="font-medium" style={{ color: deltaColor }}>
          {entry.deltaAvgPlacement > 0 ? '+' : ''}{entry.deltaAvgPlacement.toFixed(2)}
        </div>
        <div className="text-fg-muted text-[10px]">avg Δ</div>
      </div>
      <div className="text-right text-fg-muted text-[10px]">
        {entry.currentGames.toLocaleString()}
      </div>
    </a>
  );
}
