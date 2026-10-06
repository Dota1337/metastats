'use client';
import { useEffect, useMemo, useState } from 'react';
import { withAlpha } from '../../../lib/color';
import { useParams } from 'next/navigation';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import { useI18n, LOCALE_MAP } from '../../../lib/i18n';
import { formatPrize, formatUsd } from '../../../lib/prize-format';

interface Result {
  placement: number;
  proName: string;
  proPuuid: string | null;
  team: string | null;
  country: string | null;
  prizeUsd: number | null;
  prizeNative: number | null;
  prizeCurrency: string | null;
}

// Sonderpreis (Bounty, MVP …) aus tft_tournament_awards (0087). placeName ist
// der Name der Platz-Zeile desselben Spielers, wenn eindeutig zuordenbar.
interface Award {
  award: string;
  proName: string;
  placeName: string | null;
  proPuuid: string | null;
  team: string | null;
  country: string | null;
  prizeUsd: number | null;
  prizeNative: number | null;
  prizeCurrency: string | null;
}

interface LiveRow {
  source: string;
  stage: string;
  stageOrder: number;
  placement: number | null;
  name: string;
  team: string | null;
  region: string | null;
  points: number | null;
  games: number | null;
  fetchedAt: string;
}

interface Tournament {
  id: string;
  liquipedia_page: string;
  name: string;
  tier: string | null;
  region: string | null;
  set_number: number | null;
  start_date: string | null;
  end_date: string | null;
  status: 'upcoming' | 'live' | 'past';
  prize_pool_usd: number | null;
  prize_pool_native: number | null;
  prize_pool_currency: string | null;
  twitch_channel: string | null;
  format: string | null;
  num_participants: number | null;
  logo_url: string | null;
  source: string;
  results: Result[];
  live_standings: LiveRow[] | null;
  awards?: Award[] | null;
}

const TIER_COLORS: Record<string, string> = { S: '#e0c75a', A: '#7B61FF', B: '#3a8ddc', C: 'var(--fg-faint)' };
const REGION_LABELS: Record<string, string> = {
  INT: 'International', AMER: 'Americas', EMEA: 'EMEA', APAC: 'Pacific', CN: 'China',
};

// Same cleaner used on the list page — drop set-codename suffix/prefix and
// collapse the "/" hierarchy so the tournament reads as a single human name.
/** Summe der Sonderpreise in Dollar; ein einzelner nicht umgerechneter in Landeswaehrung. */
function bonusText(list: Award[] | undefined, locale: string): string | null {
  if (!list || list.length === 0) return null;
  const usd = list.reduce((s, a) => s + (a.prizeUsd != null && a.prizeUsd > 0 ? a.prizeUsd : 0), 0);
  if (usd > 0) return formatUsd(usd);
  if (list.length !== 1) return null;
  const native = formatPrize(null, list[0].prizeNative, list[0].prizeCurrency, locale);
  return native === '—' ? null : native;
}

function cleanTournamentName(raw: string): string {
  let name = raw;
  name = name.replace(/\s*\([^)]+\)\s*$/, '');
  name = name.replace(/^[^/]+\/(.+)$/, '$1');
  name = name.replace(/\//g, ' ');
  return name.trim();
}

export default function TftTournamentDetailPage() {
  const { t, lang } = useI18n();
  const params = useParams();
  const slug = decodeURIComponent(String(params?.slug || ''));
  const [tournament, setTournament] = useState<Tournament | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/tft/tournaments?slug=${encodeURIComponent(slug)}`)
      .then(r => r.json())
      .then(d => { setTournament(d.tournament || null); setLoading(false); })
      .catch(() => { setTournament(null); setLoading(false); });
  }, [slug]);

  if (loading) {
    return (
      <main className="min-h-screen bg-surface-page">
        <Nav active="tournaments" />
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 text-fg-secondary text-center">{t('tft.loading')}</div>
        <Footer />
      </main>
    );
  }
  if (!tournament) {
    return (
      <main className="min-h-screen bg-surface-page">
        <Nav active="tournaments" />
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 text-fg-secondary text-center">{t('tft.tournaments.notFound')}</div>
        <Footer />
      </main>
    );
  }

  const tierColor = tournament.tier ? (TIER_COLORS[tournament.tier] || 'var(--fg-secondary)') : 'var(--fg-secondary)';
  const locale = LOCALE_MAP[lang];
  const dateFmt = (s: string | null) => s ? new Date(s).toLocaleDateString(locale, { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
  const poolText = formatPrize(tournament.prize_pool_usd, tournament.prize_pool_native, tournament.prize_pool_currency, locale);
  const statusColor = tournament.status === 'live' ? '#e44040' : tournament.status === 'upcoming' ? '#3ecf8e' : 'var(--fg-secondary)';

  // Sonderpreise in der Zeile des Spielers (erste Platz-Zeile mit dem Namen),
  // sonst als eigene Zeile ohne Platz.
  const results = tournament.results || [];
  const placeNames = new Set(results.map(r => r.proName));
  const bonusOf = new Map<string, Award[]>();
  const extra = new Map<string, Award[]>();
  for (const a of tournament.awards || []) {
    const onPlace = a.placeName != null && placeNames.has(a.placeName);
    const target = onPlace ? bonusOf : extra;
    const k = onPlace ? a.placeName! : a.proName;
    target.set(k, [...(target.get(k) || []), a]);
  }
  const given = new Set<string>();
  const takeBonus = (name: string) => {
    if (given.has(name)) return null;
    given.add(name);
    return bonusText(bonusOf.get(name), locale);
  };
  const standingRow = (
    key: string, place: number | null, name: string, puuid: string | null,
    team: string | null, country: string | null, prize: string, bonus: string | null,
  ) => {
    const placeColor = place === 1 ? '#f0c040' : place === 2 ? '#cfd6dc' : place === 3 ? '#cd7f32' : 'var(--fg-secondary)';
    return (
      <div
        key={key}
        className="block sm:grid sm:grid-cols-[3rem_1fr_8rem_5rem_6rem] gap-2 px-4 py-2 sm:items-center text-xs border-t border-border-subtle"
      >
        <div className="hidden sm:block text-right text-base font-bold tabular-nums" style={{ color: placeColor }}>
          {place ?? '—'}
        </div>
        <div className="flex items-baseline gap-2 sm:block">
          <span className="text-base font-bold tabular-nums sm:hidden" style={{ color: placeColor }}>{place != null ? `#${place}` : '—'}</span>
          {puuid ? (
            <PlayerNameLink puuid={puuid} name={name} />
          ) : (
            <span className="text-white font-medium">{name}</span>
          )}
        </div>
        <div className="hidden sm:block text-fg-secondary truncate">{team || '—'}</div>
        <div className="hidden sm:block text-fg-secondary">{country || '—'}</div>
        <div className="flex sm:block items-center justify-between mt-1 sm:mt-0 sm:text-right tabular-nums">
          <span className="text-fg-muted text-[10px] sm:hidden">{team}{team && country ? ' · ' : ''}{country}</span>
          <span className="text-accent font-medium text-right">
            {prize}
            {bonus && (
              <span className="block text-[10px] leading-tight font-normal">+ {bonus} {t('tft.player.prizeBonus')}</span>
            )}
          </span>
        </div>
      </div>
    );
  };

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="tournaments" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <a href="/tft/tournaments" className="text-accent text-xs hover:underline">← {t('tft.tournaments.title')}</a>

        {/* Header */}
        <div className="bg-surface-base border border-border-subtle rounded-lg p-5 mb-5 mt-2">
          <div className="flex items-start gap-4 flex-wrap">
            {tournament.tier && (
              <div
                className="flex items-center justify-center w-14 h-14 rounded-lg font-bold text-xl flex-shrink-0"
                style={{ color: tierColor, backgroundColor: `${withAlpha(tierColor, 0x20)}`, border: `1px solid ${withAlpha(tierColor, 0x55)}` }}
              >
                {tournament.tier}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-white text-2xl font-medium">{cleanTournamentName(tournament.name)}</h1>
              <div className="flex items-center gap-2 flex-wrap mt-1.5">
                <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded" style={{ backgroundColor: `${withAlpha(statusColor, 0x25)}`, color: statusColor }}>
                  {t(`tft.tournaments.${tournament.status}` as const)}
                </span>
                {tournament.region && (
                  <span className="text-xs text-fg-secondary">{REGION_LABELS[tournament.region] || tournament.region}</span>
                )}
              </div>
              <div className="text-fg-secondary text-sm mt-2">
                {dateFmt(tournament.start_date)} – {dateFmt(tournament.end_date)}
              </div>
              {tournament.format && (
                <div className="text-fg-muted text-xs mt-1">{tournament.format}</div>
              )}
            </div>
            {poolText !== '—' && (
              <div className="text-right">
                <div className="text-accent text-2xl font-semibold tabular-nums">
                  {poolText}
                </div>
                <div className="text-fg-muted text-[10px] uppercase tracking-widest">Prize Pool</div>
              </div>
            )}
          </div>

        </div>

        {/* Twitch embed if available + tournament is live */}
        {tournament.status === 'live' && tournament.twitch_channel && (
          <div className="bg-surface-base border border-border-subtle rounded p-3 mb-5">
            <div className="text-fg-secondary text-xs uppercase tracking-widest mb-2">{t('tft.tournaments.liveStream')}</div>
            <div className="aspect-video">
              <iframe
                src={`https://player.twitch.tv/?channel=${tournament.twitch_channel}&parent=metastats.gg&parent=www.metastats.gg&parent=localhost`}
                allowFullScreen
                className="w-full h-full rounded"
              />
            </div>
          </div>
        )}

        {tournament.status !== 'past' && (
          <LiveStandings rows={tournament.live_standings} live={tournament.status === 'live'} locale={locale} />
        )}

        {/* Standings — only rendered when we have data. No info text when
            empty (per user preference to skip explanatory copy). */}
        {(results.length > 0 || extra.size > 0) && (
          <section className="bg-surface-base border border-border-subtle rounded overflow-hidden">
            <div className="px-4 py-2 bg-surface-sunken text-[10px] uppercase tracking-widest text-fg-muted">
              {t('tft.tournaments.standings')}
            </div>
            <div className="hidden sm:grid grid-cols-[3rem_1fr_8rem_5rem_6rem] gap-2 px-4 py-2 text-[10px] uppercase text-fg-muted border-t border-border-subtle">
              <div className="text-right">#</div>
              <div>{t('tft.pros.col.player')}</div>
              <div>{t('tft.pros.col.team')}</div>
              <div>{t('tft.pros.col.region')}</div>
              <div className="text-right">{t('tft.player.colPrize')}</div>
            </div>
            {results.map(r => standingRow(
              `${r.placement}-${r.proName}`, r.placement, r.proName, r.proPuuid, r.team, r.country,
              formatPrize(r.prizeUsd, r.prizeNative, r.prizeCurrency, locale), takeBonus(r.proName),
            ))}
            {[...extra].map(([name, list]) => standingRow(
              `award-${name}`, null, name, list.find(a => a.proPuuid)?.proPuuid ?? null,
              list[0].team, list[0].country, '—', bonusText(list, locale),
            ))}
          </section>
        )}

        {tournament.status === 'past' && (
          <LiveStandings rows={tournament.live_standings} live={false} locale={locale} />
        )}
      </div>
      <Footer />
    </main>
  );
}

// Punktetabelle aus den oeffentlichen Tabellen der Veranstalter (Google-Sheets,
// apactft.com), stuendlich geholt von scripts/fetch-tft-live-standings.mjs.
// Mehrere Runden (Tag 1, Finale …) als Umschalter, hoechste Runde zuerst.
function LiveStandings({ rows, live, locale }: { rows: LiveRow[] | null; live: boolean; locale: string }) {
  const { t } = useI18n();
  const stages = useMemo(() => {
    const by = new Map<string, { key: string; stage: string; order: number; rows: LiveRow[]; fetchedAt: string }>();
    for (const r of rows || []) {
      const key = `${r.source}|${r.stage}`;
      let s = by.get(key);
      if (!s) { s = { key, stage: r.stage, order: r.stageOrder, rows: [], fetchedAt: r.fetchedAt }; by.set(key, s); }
      s.rows.push(r);
      if (r.fetchedAt > s.fetchedAt) s.fetchedAt = r.fetchedAt;
    }
    const list = [...by.values()].sort((a, b) => b.order - a.order);
    for (const s of list) {
      s.rows.sort((a, b) => (a.placement ?? 9999) - (b.placement ?? 9999) || (b.points ?? 0) - (a.points ?? 0));
    }
    return list;
  }, [rows]);
  const [picked, setPicked] = useState<string | null>(null);
  if (stages.length === 0) return null;
  const cur = stages.find(s => s.key === picked) || stages[0];
  const hasRegion = cur.rows.some(r => r.region);
  const hasGames = cur.rows.some(r => r.games != null);
  const cols = `2.5rem minmax(0,1fr)${hasRegion ? ' 4rem' : ''} 4rem${hasGames ? ' 3.5rem' : ''}`;
  const updated = new Date(cur.fetchedAt).toLocaleString(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  return (
    <section className="bg-surface-base border border-border-subtle rounded overflow-hidden mb-5">
      <div className="px-4 py-2 bg-surface-sunken flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-fg-muted">
          {live && (
            <span className="relative flex h-2 w-2">
              <span className="absolute inset-0 rounded-full opacity-75 animate-ping bg-pos-loss" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-pos-loss" />
            </span>
          )}
          {live ? t('tft.tournaments.liveStandings') : t('tft.tournaments.pointsTable')}
        </div>
        <div className="text-[10px] text-fg-muted tabular-nums">{t('tft.tournaments.updatedAt').replace('{time}', updated)}</div>
      </div>
      {stages.length > 1 && (
        <div className="flex flex-wrap gap-1.5 px-4 py-2 border-t border-border-subtle">
          {stages.map(s => (
            <button
              key={s.key}
              onClick={() => setPicked(s.key)}
              className={`text-xs px-2 py-0.5 rounded border transition-colors ${s.key === cur.key ? 'border-accent-a60 text-white bg-surface-raised' : 'border-border-subtle text-fg-secondary hover:text-white'}`}
            >
              {s.stage}
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-2 px-4 py-2 text-[10px] uppercase text-fg-muted border-t border-border-subtle" style={{ gridTemplateColumns: cols }}>
        <div className="text-right">#</div>
        <div>{t('tft.pros.col.player')}</div>
        {hasRegion && <div>{t('tft.pros.col.region')}</div>}
        <div className="text-right">{t('tft.tournaments.colPoints')}</div>
        {hasGames && <div className="text-right">{t('tft.tournaments.colGames')}</div>}
      </div>
      {cur.rows.map(r => {
        const placeColor = r.placement === 1 ? '#f0c040' : r.placement === 2 ? '#cfd6dc' : r.placement === 3 ? '#cd7f32' : 'var(--fg-secondary)';
        return (
          <div key={`${r.name}-${r.placement}`} className="grid gap-2 px-4 py-1.5 items-center text-xs border-t border-border-subtle" style={{ gridTemplateColumns: cols }}>
            <div className="text-right font-bold tabular-nums" style={{ color: placeColor }}>{r.placement ?? '—'}</div>
            <div className="min-w-0 truncate">
              {r.team && <span className="text-fg-muted mr-1">{r.team}</span>}
              <span className="text-white font-medium">{r.name}</span>
            </div>
            {hasRegion && <div className="text-fg-secondary truncate">{r.region || '—'}</div>}
            <div className="text-right text-accent font-medium tabular-nums">{r.points ?? '—'}</div>
            {hasGames && <div className="text-right text-fg-secondary tabular-nums">{r.games ?? '—'}</div>}
          </div>
        );
      })}
    </section>
  );
}

// Pro name link — resolves PUUID → TFT player profile URL via the /api/tft/pros
// endpoint to pull the riot_id (which we need for the slug). Cached client-side
// so going to the same tournament twice doesn't refetch the same pro.
const playerLinkCache = new Map<string, { gameName: string; tagLine: string; region: string }>();

function PlayerNameLink({ puuid, name }: { puuid: string; name: string }) {
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    const cached = playerLinkCache.get(puuid);
    if (cached) {
      setLink(`/tft/player/${encodeURIComponent(cached.gameName)}--${encodeURIComponent(cached.tagLine)}?region=${cached.region}`);
      return;
    }
    fetch(`/api/tft/pros?puuid=${puuid}`)
      .then(r => r.ok ? r.json() : { pro: null })
      .then(d => {
        if (!d.pro?.riot_id) return;
        const [gameName, tagLine] = d.pro.riot_id.split('#');
        if (!gameName) return;
        playerLinkCache.set(puuid, { gameName, tagLine: tagLine || '', region: d.pro.region });
        setLink(`/tft/player/${encodeURIComponent(gameName)}--${encodeURIComponent(tagLine || '')}?region=${d.pro.region}`);
      })
      .catch(() => {});
  }, [puuid]);

  if (link) {
    return (
      <a href={link} className="text-white font-medium hover:text-accent truncate">
        {name}
      </a>
    );
  }
  return <span className="text-white font-medium">{name}</span>;
}
