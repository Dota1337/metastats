// Per-player historical ranked-season backfill. Riot's API can't tell us
// what tier the player ended a past set on — that data is gone from their
// systems. metatft has been crawling and storing it since ~Set 8.2, and
// exposes the result via its public profile endpoint.
//
// Neuabruf-Regel (2026-09-28): frueher einmal pro puuid und nie wieder — damit
// blieb ein mitten im Set geholter dakgg-Stand ("Diamond") fuer immer stehen,
// obwohl der Spieler spaeter GM wurde. Jetzt:
//   - letzter Abruf vor dem Set-Wechsel → sofort neu (blockierend, 4 s Deckel)
//   - aelter als 7 Tage, oder Fehler aelter als 24 h → im Hintergrund (after())
// Schutzregeln beim Speichern stehen an mergeRankSources.

import { after } from 'next/server';
import { CURRENT_SET, CURRENT_SET_STARTED_AT_MS } from './current-set';

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const METATFT_URL = 'https://api.metatft.com/public/profile/lookup_by_riotid';
// dak.gg is lolchess.gg's backend. Their /summoners/{shard}/{name-tag}/profile
// endpoint returns `summonerSeasons` reaching back to Set 1, which metatft
// can't cover (they only started crawling ~Set 8.2). We combine: dak.gg
// gives us the full skeleton, metatft fills in LP + games where it has them.
const DAKGG_URL = 'https://tft.dakgg.io/api/v1/summoners';

const STANDARD_RANKED_QUEUE = 1100;
const SOURCE_TIMEOUT_MS = 4000;
const DAY_MS = 24 * 60 * 60 * 1000;
const REFRESH_AFTER_MS = 7 * DAY_MS;

export interface SeasonRank {
  set_number: number;
  set_label: string | null;
  queue_id: number;
  peak_tier: string | null;
  peak_division: string | null;
  peak_lp: number | null;
  peak_rating_label: string | null;
  total_games: number | null;
  source: string;
}

interface BackfillOpts {
  /** Force a refresh even if we already attempted this puuid. */
  force?: boolean;
}

/** Wann muss neu geholt werden? Exportiert fuer Tests. */
export function refreshMode(
  state: { metatft_fetched_at?: string | null; metatft_status?: string | null } | null,
  now: number,
  setStartedAt: number | null,
  force = false,
): 'none' | 'block' | 'background' {
  const last = state?.metatft_fetched_at ? Date.parse(state.metatft_fetched_at) : NaN;
  if (force || !state || !Number.isFinite(last)) return 'block';
  // Vor dem Set-Wechsel geholt: der Stand fuer das abgelaufene Set kann ein
  // Zwischenstand sein — der darf nicht einmal kurz als Endrang erscheinen.
  if (setStartedAt != null && last < setStartedAt) return 'block';
  const age = now - last;
  if (state.metatft_status === 'error' ? age > DAY_MS : age > REFRESH_AFTER_MS) return 'background';
  return 'none';
}

/**
 * Holt die Set-Raenge eines Spielers nach, wenn die Regel oben es verlangt,
 * und liefert die gespeicherten Zeilen.
 *
 * @param gameName / @param tagLine — Riot ID parts we need for the
 *   metatft URL. We accept them from the caller because resolving puuid →
 *   riot-id requires a separate Riot account-v1 call we'd otherwise
 *   duplicate.
 */
export async function ensureRankHistoryBackfilled(
  puuid: string,
  region: string,
  gameName: string,
  tagLine: string,
  opts: BackfillOpts = {},
): Promise<SeasonRank[]> {
  const state = await getBackfillState(puuid);
  const mode = refreshMode(state, Date.now(), CURRENT_SET_STARTED_AT_MS, opts.force);

  if (mode === 'block') {
    await refreshRankHistory(puuid, region, gameName, tagLine);
  } else if (mode === 'background') {
    try {
      after(() => refreshRankHistory(puuid, region, gameName, tagLine));
    } catch {
      // Ausserhalb eines Requests (Skript/Test) gibt es kein after().
      await refreshRankHistory(puuid, region, gameName, tagLine);
    }
  }

  return loadRankHistory(puuid);
}

async function refreshRankHistory(puuid: string, region: string, gameName: string, tagLine: string) {
  try {
    // allSettled statt catch(() => []): ein MetaTFT-Ausfall darf nicht wie
    // "keine Daten" aussehen, sonst ersetzt dakgg gespeicherte Hoechstraenge.
    const [mt, dk] = await Promise.allSettled([
      fetchMetatft(region, gameName, tagLine),
      fetchDakggSeasons(region, gameName, tagLine),
    ]);
    if (mt.status === 'rejected' && dk.status === 'rejected') {
      throw new Error(`metatft: ${errMsg(mt.reason)} · dakgg: ${errMsg(dk.reason)}`);
    }
    const existing = await loadRankHistoryRaw(puuid);
    const merged = mergeRankSources(
      mt.status === 'fulfilled' ? mt.value : [],
      dk.status === 'fulfilled' ? dk.value : [],
      existing,
    );
    if (merged.length > 0) await upsertRankHistoryRows(puuid, region, merged);
    // dakgg-Zeilen fuers laufende Set sind ein Tagesstand, kein Hoechstrang.
    if (existing.some(r => r.source === 'dakgg' && r.set_number >= CURRENT_SET)) {
      await deleteRows(puuid, `source=eq.dakgg&set_number=gte.${CURRENT_SET}`);
    }
    if (mt.status === 'rejected' || dk.status === 'rejected') {
      const failed = mt.status === 'rejected' ? `metatft: ${errMsg(mt.reason)}` : `dakgg: ${errMsg((dk as PromiseRejectedResult).reason)}`;
      await upsertBackfillState(puuid, region, 'error', failed.slice(0, 200));
    } else {
      await upsertBackfillState(puuid, region, merged.length > 0 || existing.length > 0 ? 'success' : 'no_data', null);
    }
  } catch (e) {
    await upsertBackfillState(puuid, region, 'error', errMsg(e).slice(0, 200) || 'unknown');
    // Don't throw — we still want to return whatever's already cached.
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function loadRankHistory(puuid: string): Promise<SeasonRank[]> {
  // UNRANKED ist kein Rang — dakgg liefert es fuer Sets ohne Ranglisten-Spiele.
  return (await loadRankHistoryRaw(puuid)).filter(r => isRealTier(r.peak_tier));
}

async function loadRankHistoryRaw(puuid: string): Promise<SeasonRank[]> {
  const r = await fetch(
    `${SUPA_URL}/rest/v1/tft_player_rank_history?puuid=eq.${encodeURIComponent(puuid)}&queue_id=eq.${STANDARD_RANKED_QUEUE}&select=*&order=set_number.desc`,
    { headers: supaHeaders() },
  );
  if (!r.ok) return [];
  return r.json();
}

function isRealTier(tier: string | null | undefined): boolean {
  const t = (tier || '').toUpperCase();
  return t !== '' && t !== 'UNRANKED' && t !== 'NONE';
}

async function deleteRows(puuid: string, filter: string) {
  const res = await fetch(
    `${SUPA_URL}/rest/v1/tft_player_rank_history?puuid=eq.${encodeURIComponent(puuid)}&queue_id=eq.${STANDARD_RANKED_QUEUE}&${filter}`,
    { method: 'DELETE', headers: { ...supaHeaders(), Prefer: 'return=minimal' } },
  );
  if (!res.ok) throw new Error(`rank_history delete failed HTTP ${res.status}`);
}

// ── Supabase wrappers ──────────────────────────────────────────────────────

async function getBackfillState(puuid: string) {
  const r = await fetch(
    `${SUPA_URL}/rest/v1/tft_player_rank_backfill_state?puuid=eq.${encodeURIComponent(puuid)}&select=*`,
    { headers: supaHeaders() },
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0] || null;
}

async function upsertBackfillState(
  puuid: string, region: string, status: string, error: string | null,
) {
  await fetch(
    `${SUPA_URL}/rest/v1/tft_player_rank_backfill_state?on_conflict=puuid`,
    {
      method: 'POST',
      headers: {
        ...supaHeaders(),
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify([{
        puuid, region,
        metatft_fetched_at: new Date().toISOString(),
        metatft_status: status,
        metatft_error: error,
        updated_at: new Date().toISOString(),
      }]),
    },
  );
}

async function upsertRankHistoryRows(
  puuid: string, region: string, rows: Omit<SeasonRank, 'queue_id'>[] & SeasonRank[],
) {
  // Each row already has set_number, peak fields. Add puuid + region.
  const payload = rows.map(r => ({ ...r, puuid, region, fetched_at: new Date().toISOString() }));
  const res = await fetch(
    `${SUPA_URL}/rest/v1/tft_player_rank_history?on_conflict=puuid,set_label,queue_id`,
    {
      method: 'POST',
      headers: {
        ...supaHeaders(),
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    throw new Error(`rank_history upsert failed HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

function supaHeaders() {
  return { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` };
}

// ── Metatft client ─────────────────────────────────────────────────────────

async function fetchMetatft(
  region: string, gameName: string, tagLine: string,
): Promise<SeasonRank[]> {
  if (!gameName || !tagLine) return [];
  const url = `${METATFT_URL}/${region}/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'metastats.gg/1.0',
      'Origin': 'https://www.metatft.com',
      'Referer': 'https://www.metatft.com/',
    },
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
  });
  if (!r.ok) {
    // 404 = profile doesn't exist on metatft, not an error from our PoV
    if (r.status === 404) return [];
    throw new Error(`metatft HTTP ${r.status}`);
  }
  const data = await r.json();
  // MetaTFT meldet Fehler auch mit HTTP 200 und einem error-Feld.
  if (data?.error) throw new Error(`metatft error: ${String(data.error).slice(0, 100)}`);
  return parseMetatftProfile(data, CURRENT_SET, CURRENT_SET_STARTED_AT_MS);
}

/** Exportiert fuer Tests. */
interface MetatftEntry { peak_rating?: unknown; rating_text?: unknown; num_games?: number; total_games?: number; timestamp?: string }
interface MetatftProfile { rating_history?: Record<string, Record<string, MetatftEntry>>; ranked?: MetatftEntry | null }

export function parseMetatftProfile(data: MetatftProfile | null | undefined, currentSet: number, setStartedAt: number | null): SeasonRank[] {
  const ratings = data?.rating_history || {};
  const out: SeasonRank[] = [];
  for (const [setLabel, queues] of Object.entries(ratings)) {
    const setNumber = parseSetNumber(setLabel);
    if (setNumber == null) continue;
    for (const [queueIdStr, entry] of Object.entries(queues)) {
      const queueId = parseInt(queueIdStr, 10);
      if (queueId !== STANDARD_RANKED_QUEUE) continue;
      const row = metatftRow(setNumber, setLabel, entry);
      if (row) out.push(row);
    }
  }
  // Laufendes Set steht NICHT in rating_history, sondern in `ranked` — ohne
  // Set-Kennung. Deshalb zwei Sperren gegen falsche Zuordnung:
  //  - Zeitstempel (MetaTFT schickt ihn ohne Zeitzone, ist UTC) nach dem
  //    Set-Wechsel, sonst koennte es noch das alte Set sein;
  //  - rating_history hat das laufende Set noch nicht als abgeschlossen —
  //    sonst zeigt MetaTFT schon das naechste Set, waehrend tft-set.json
  //    absichtlich noch auf dem alten steht.
  const ranked = data?.ranked;
  const hasCurrentInHistory = Object.keys(ratings).some(l => parseSetNumber(l) === currentSet);
  if (ranked && setStartedAt != null && !hasCurrentInHistory) {
    const ts = parseUtc(ranked.timestamp);
    if (ts != null && ts >= setStartedAt) {
      const row = metatftRow(currentSet, `TFTSet${currentSet}`, ranked);
      if (row) out.push(row);
    }
  }
  return out;
}

// Eine MetaTFT-Zeile ohne peak_rating (bei Set 8.5/9 so geliefert) ist leer
// und darf keine dakgg-Zeile verdraengen — also gar nicht erst erzeugen.
function metatftRow(setNumber: number, setLabel: string, entry: MetatftEntry): SeasonRank | null {
  const peak = parsePeakRating(entry?.peak_rating);
  if (!peak || !isRealTier(peak.tier)) return null;
  return {
    set_number: setNumber,
    set_label: setLabel,
    queue_id: STANDARD_RANKED_QUEUE,
    peak_tier: peak.tier,
    peak_division: peak.division,
    peak_lp: peak.lp,
    peak_rating_label: String(entry.peak_rating),
    total_games: entry?.num_games ?? entry?.total_games ?? null,
    source: 'metatft',
  };
}

function parseUtc(raw: unknown): number | null {
  if (typeof raw !== 'string' || !raw) return null;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(raw);
  const ms = Date.parse(hasZone ? raw : `${raw}Z`);
  return Number.isFinite(ms) ? ms : null;
}

// "TFTSet16" → 16, "TFTSet9_2" → 9 (the .2 set is a mid-set; we keep the
// base number, the set_label retains the original string).
function parseSetNumber(label: string): number | null {
  const m = /^TFTSet(\d+)/i.exec(label);
  return m ? parseInt(m[1], 10) : null;
}

// dak.gg → canonical TFTSetN[_M] format.
//   'set1'   → 'TFTSet1'
//   'set9.5' → 'TFTSet9_2'   (.5 is the mid-set, which Riot internally
//                              labels with the _2 suffix)
function normalizeDakSetLabel(dakLabel: string): string | null {
  const m = /^set(\d+)(?:\.(\d+))?$/i.exec(dakLabel);
  if (!m) return null;
  // .5 ↔ _2 (Riot only ships ONE mid-set per set, conventionally labelled
  // either "set N.5" by community or "TFTSet N_2" by the engine).
  return m[2] ? `TFTSet${m[1]}_2` : `TFTSet${m[1]}`;
}

async function fetchDakggSeasons(
  shard: string, gameName: string, tagLine: string,
): Promise<SeasonRank[]> {
  const slug = `${gameName}-${tagLine}`;
  const url = `${DAKGG_URL}/${shard}/${encodeURIComponent(slug)}/profile`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'metastats.gg/1.0',
      'Origin': 'https://lolchess.gg',
      'Referer': 'https://lolchess.gg/',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
  });
  if (!r.ok) {
    if (r.status === 404) return [];
    throw new Error(`dakgg HTTP ${r.status}`);
  }
  const data = await r.json();
  const seasons = data?.summonerSeasons || [];
  // summonerLeagues holds the LP/plays of the current season — we don't
  // need them here because the player-stats endpoint already shows the
  // live rank from Riot's API. We only consume the past-season list.
  const out: SeasonRank[] = [];
  for (const s of seasons) {
    if (!s?.season || !s?.tier) continue;
    const canonicalLabel = normalizeDakSetLabel(s.season);
    if (!canonicalLabel) continue;
    const setNumber = parseSetNumber(canonicalLabel);
    if (setNumber == null) continue;
    const tier = (s.tier || '').toUpperCase();
    const division = s.rank ? String(s.rank).toUpperCase() : null;
    out.push({
      set_number: setNumber,
      set_label: canonicalLabel,
      queue_id: STANDARD_RANKED_QUEUE,
      peak_tier: tier,
      peak_division: division,
      peak_lp: null,                                     // dakgg doesn't expose LP for past seasons
      peak_rating_label: division ? `${tier} ${division}` : tier,
      total_games: null,
      source: 'dakgg',
    });
  }
  return out;
}

// Welche Zeilen werden geschrieben? Exportiert fuer Tests. Regeln:
//  - MetaTFT (Hoechstrang) schlaegt dakgg (Endrang) im selben Set.
//  - dakgg nie fuers laufende Set (Tagesstand) und nie UNRANKED.
//  - dakgg ueberschreibt keine gespeicherte MetaTFT-Zeile mit Rang — sonst
//    ersetzt ein MetaTFT-Ausfall oder -404 echte Hoechstraenge.
export function mergeRankSources(metatft: SeasonRank[], dakgg: SeasonRank[], existing: SeasonRank[] = [], currentSet = CURRENT_SET): SeasonRank[] {
  const protectedLabels = new Set(
    existing.filter(r => r.source === 'metatft' && isRealTier(r.peak_tier) && r.set_label).map(r => r.set_label!),
  );
  const byLabel = new Map<string, SeasonRank>();
  for (const r of dakgg) {
    if (!r.set_label || r.set_number >= currentSet || !isRealTier(r.peak_tier)) continue;
    if (protectedLabels.has(r.set_label)) continue;
    byLabel.set(r.set_label, r);
  }
  for (const r of metatft) if (r.set_label) byLabel.set(r.set_label, r);
  return [...byLabel.values()];
}

// "CHALLENGER I 1566 LP" → { tier: 'CHALLENGER', division: 'I', lp: 1566 }
// "MASTER 432 LP" → { tier: 'MASTER', division: null, lp: 432 }
// undefined / non-string → null
// 0 LP ist ein echter Wert ("MASTER I 0 LP"), nicht leer.
function toLp(part: string): number | null {
  const n = parseInt(part.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function parsePeakRating(raw: unknown): { tier: string; division: string | null; lp: number | null } | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const parts = raw.trim().split(/\s+/);
  const tier = parts[0].toUpperCase();
  let division: string | null = null;
  let lp: number | null = null;
  // Apex tiers don't have a division.
  const APEX = new Set(['CHALLENGER', 'GRANDMASTER', 'MASTER']);
  if (APEX.has(tier)) {
    // "MASTER 432 LP" or "MASTER I 432 LP" (metatft uses CHALLENGER I sometimes)
    if (parts.length >= 3 && /^[IVX]+$/.test(parts[1])) {
      division = parts[1];
      lp = toLp(parts[2]);
    } else if (parts.length >= 2) {
      lp = toLp(parts[1]);
    }
  } else {
    // "DIAMOND I 23 LP"
    if (parts.length >= 3) {
      division = parts[1];
      lp = toLp(parts[2]);
    } else if (parts.length >= 2) {
      division = parts[1];
    }
  }
  return { tier, division, lp };
}
