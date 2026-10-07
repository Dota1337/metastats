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
//
// Anzeige seit 2026-09-28 (User): Rang am Set-Ende (end_*) + hoechste LP des
// Sets (peak_lp). peak_* bleibt der Hoechstrang aus MetaTFT; die Anzeige-Regel
// steht in tft-rank-kind.ts (setRankDisplay).
//
// Hoechst-LP vor Set 9.2 (2026-09-28): MetaTFT hat dort keinen peak_rating.
// Fuer vergangene Sets mit Master+-Ende und ohne LP holt fillPeakLpFromLogs
// das Maximum aus dem dak.gg-LP-Verlauf. Herkunft steht in peak_rating_label:
// 'dakgg-log' = Wert aus dem Verlauf, 'dakgg-log:none' = Verlauf ohne Master+-
// Eintrag, nicht erneut fragen. Rueckbau: Aufruf entfernen und
// `update ... set peak_*=null where peak_rating_label like 'dakgg-log%'`.
//
// Spielzahl je Set (2026-09-28): MetaTFT liefert sie erst ab Set 9.2. Fuer
// vergangene Sets ohne Spielzahl nimmt fillFromLogs den letzten Eintrag des
// Verlaufs (Spiele gesamt). Kein Verlauf → bleibt leer, nie 0. Rueckbau:
// `update ... set total_games=null where source='dakgg'`.

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
// Ab hier gibt es end_* (Migration 0076). Aeltere Abrufe haben fuer
// MetaTFT-Zeilen keinen Endrang und muessen einmal neu geholt werden.
export const RANK_SCHEMA_AT_MS = Date.parse('2026-09-28T15:30:00Z');

// Vom User bestaetigte Korrekturen, die keine Quelle liefert. Chillout war in
// Set 8.5 Challenger 760 LP (dak.gg-Ranglistenverlauf, geprueft 2026-09-28);
// MetaTFT hat fuer 8_2 nur einen Platzhalter, dak.gg nur "Master I".
const RANK_OVERRIDES: { puuid: string; set_label: string; set_number: number; tier: string; lp: number }[] = [
  {
    puuid: 'NQoWt3WdMPUlQxeianc3L4nBVz8_TXwvW8h34YNVTKs2s7DKVgydtHnLwOFrt5fT6aKxSyfPB0O2Aw',
    set_label: 'TFTSet8_2', set_number: 8, tier: 'CHALLENGER', lp: 760,
  },
];

export interface SeasonRank {
  set_number: number;
  set_label: string | null;
  queue_id: number;
  peak_tier: string | null;
  peak_division: string | null;
  peak_lp: number | null;
  peak_rating_label: string | null;
  end_tier?: string | null;
  end_division?: string | null;
  end_lp?: number | null;
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
  schemaAt: number = RANK_SCHEMA_AT_MS,
): 'none' | 'block' | 'background' {
  const last = state?.metatft_fetched_at ? Date.parse(state.metatft_fetched_at) : NaN;
  if (force || !state || !Number.isFinite(last)) return 'block';
  // Vor dem Set-Wechsel geholt: der Stand fuer das abgelaufene Set kann ein
  // Zwischenstand sein — der darf nicht einmal kurz als Endrang erscheinen.
  // Vor RANK_SCHEMA_AT geholt: Endrang fehlt noch.
  if (last < Math.max(setStartedAt ?? 0, schemaAt)) return 'block';
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

  // LP-Verlauf nur, wenn ohnehin neu geholt wird — nie bei jedem Aufruf.
  const fillLogs = () => fillFromLogs(puuid, region, gameName, tagLine);
  if (mode === 'block') {
    await refreshRankHistory(puuid, region, gameName, tagLine);
    await runLater(fillLogs);
  } else if (mode === 'background') {
    await runLater(async () => {
      await refreshRankHistory(puuid, region, gameName, tagLine);
      await fillLogs();
    });
  }

  return loadRankHistory(puuid);
}

async function runLater(fn: () => Promise<unknown>) {
  try {
    after(fn);
  } catch {
    // Ausserhalb eines Requests (Skript/Test) gibt es kein after().
    await fn();
  }
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
  return applyRankOverrides(puuid, await loadRankHistoryRaw(puuid));
}

/**
 * Korrekturen einsetzen und Zeilen ohne echten Rang entfernen (UNRANKED ist
 * kein Rang — dakgg liefert es fuer Sets ohne Ranglisten-Spiele). Laufendes
 * Set bleibt auch ohne Endrang drin: dort setzt die Oberflaeche den Live-Rang
 * ein. Exportiert fuer Tests.
 */
export function applyRankOverrides(puuid: string, rows: SeasonRank[], currentSet = CURRENT_SET): SeasonRank[] {
  const out = [...rows];
  for (const o of RANK_OVERRIDES) {
    if (o.puuid !== puuid) continue;
    const i = out.findIndex(r => r.set_label === o.set_label);
    const base: SeasonRank = i >= 0 ? out[i] : {
      set_number: o.set_number, set_label: o.set_label, queue_id: STANDARD_RANKED_QUEUE,
      peak_tier: null, peak_division: null, peak_lp: null, peak_rating_label: null, total_games: null, source: 'override',
    };
    const row: SeasonRank = {
      ...base,
      peak_tier: o.tier, peak_division: null, peak_lp: o.lp, peak_rating_label: `${o.tier} ${o.lp} LP`,
      end_tier: o.tier, end_division: null, end_lp: o.lp, source: 'override',
    };
    if (i >= 0) out[i] = row; else out.push(row);
  }
  return out
    .filter(r => isRealTier(r.end_tier) || (r.set_number >= currentSet && isRealTier(r.peak_tier)))
    .sort((a, b) => b.set_number - a.set_number || (b.set_label || '').localeCompare(a.set_label || ''));
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

// peak_rating = Hoechstrang, rating_text = letzter gesehener Stand = Endrang.
// Bei Set 8.5/9 liefert MetaTFT keinen peak_rating und den Zeitstempel
// 1970-01-01 — der rating_text dort ist kein verlaesslicher Endrang (oft ein
// Platzhalter "MASTER I 0 LP"), dafuer gilt dakgg. Ohne beides: keine Zeile.
function metatftRow(setNumber: number, setLabel: string, entry: MetatftEntry): SeasonRank | null {
  const peak = parsePeakRating(entry?.peak_rating);
  const ts = parseUtc(entry?.timestamp);
  const end = ts != null && ts > 0 ? parsePeakRating(entry?.rating_text) : null;
  const hasPeak = !!peak && isRealTier(peak.tier);
  const hasEnd = !!end && isRealTier(end.tier);
  if (!hasPeak && !hasEnd) return null;
  return {
    set_number: setNumber,
    set_label: setLabel,
    queue_id: STANDARD_RANKED_QUEUE,
    peak_tier: hasPeak ? peak!.tier : null,
    peak_division: hasPeak ? peak!.division : null,
    peak_lp: hasPeak ? peak!.lp : null,
    peak_rating_label: hasPeak ? String(entry.peak_rating) : null,
    end_tier: hasEnd ? end!.tier : null,
    end_division: hasEnd ? end!.division : null,
    end_lp: hasEnd ? end!.lp : null,
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
    // dakgg kennt nur den Rang am Set-Ende, ohne LP — also nur end_*.
    out.push({
      set_number: setNumber,
      set_label: canonicalLabel,
      queue_id: STANDARD_RANKED_QUEUE,
      peak_tier: null,
      peak_division: null,
      peak_lp: null,
      peak_rating_label: null,
      end_tier: tier,
      end_division: division,
      end_lp: null,
      total_games: null,
      source: 'dakgg',
    });
  }
  return out;
}

// ── dak.gg LP-Verlauf (Hoechst-LP fuer Sets vor 9.2) ─────────────────────────

const APEX_TIERS = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);
const LOG_LABEL = 'dakgg-log';
const LOG_NONE = 'dakgg-log:none';
const LOG_PAGE_SIZE = 200;
const LOG_MAX_PAGES = 15;
const LOG_DEADLINE_MS = 40_000;

function isLogLabel(label: string | null | undefined): boolean {
  return label === LOG_LABEL || label === LOG_NONE;
}

// 'TFTSet9_2' → 'set9.5', 'TFTSet8' → 'set8' (Umkehrung von normalizeDakSetLabel)
function toDakSeason(setLabel: string): string | null {
  const m = /^TFTSet(\d+)(_2)?$/i.exec(setLabel);
  return m ? `set${m[1]}${m[2] ? '.5' : ''}` : null;
}

type LeagueLog = [number, string, string, number, number, number?];

/**
 * Verlauf eines Sets bereinigt, zeitlich aufsteigend.
 * Eintrag: [Zeit ms, Stufe, Division, LP, Spiele gesamt, Siege].
 *  - Seiten ueberlappen → doppelte Eintraege raus.
 *  - Der Verlauf beginnt manchmal mit dem Schlussstand des Vorsets (Set 6.5:
 *    erst 765 Spiele, dann 145). Die Spielzahl steigt innerhalb eines Sets
 *    fast nur; faellt sie in den ersten Eintraegen, wird alles davor verworfen.
 *  - Ohne Abfall (Set kaum oder gar nicht gespielt) erkennt man den Uebertrag
 *    nur am Vergleich: fuehrende Eintraege gleich dem Vorset-Ende fallen weg.
 */
function cleanLeagueLogs(logs: LeagueLog[], prevLast?: LeagueLog | null): LeagueLog[] {
  const seen = new Set<string>();
  const rows = logs
    .filter(l => Array.isArray(l) && Number.isFinite(l[0]) && typeof l[1] === 'string')
    .filter(l => { const k = `${l[0]}|${l[1]}|${l[3]}|${l[4]}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a[0] - b[0]);
  let start = 0;
  for (let i = 1; i < Math.min(rows.length, 5); i++) {
    if (Number(rows[i][4]) < Number(rows[i - 1][4])) start = i;
  }
  while (prevLast && start < rows.length && sameLogState(rows[start], prevLast)) start++;
  return rows.slice(start);
}

function sameLogState(a: LeagueLog, b: LeagueLog): boolean {
  return a[1].toUpperCase() === String(b[1]).toUpperCase() && Number(a[3]) === Number(b[3]) && Number(a[4]) === Number(b[4]);
}

function latestLog(logs: LeagueLog[]): LeagueLog | null {
  let best: LeagueLog | null = null;
  for (const l of logs) if (Array.isArray(l) && Number.isFinite(l[0]) && (!best || l[0] > best[0])) best = l;
  return best;
}

/**
 * Hoechster Master+-Stand eines Sets aus dem LP-Verlauf. Exportiert fuer Tests.
 * Die Endstufe kommt nie von hier, nur die End-LP (endFromLeagueLogs).
 */
export function peakFromLeagueLogs(logs: LeagueLog[], prevLast?: LeagueLog | null): { tier: string; lp: number } | null {
  let best: { tier: string; lp: number } | null = null;
  for (const l of cleanLeagueLogs(logs, prevLast)) {
    const tier = l[1].toUpperCase();
    const lp = Number(l[3]);
    if (!APEX_TIERS.has(tier) || !Number.isFinite(lp)) continue;
    if (!best || lp > best.lp) best = { tier, lp };
  }
  return best;
}

/**
 * Spiele eines Sets = Spielzahl im letzten Verlaufs-Eintrag (nicht das Maximum:
 * sie faellt im Set gelegentlich um 1). Nur Uebertrag oder leer → null, nie 0.
 * Exportiert fuer Tests.
 */
export function gamesFromLeagueLogs(logs: LeagueLog[], prevLast?: LeagueLog | null): number | null {
  const rows = cleanLeagueLogs(logs, prevLast);
  const g = rows.length ? Number(rows[rows.length - 1][4]) : NaN;
  return Number.isFinite(g) && g > 0 ? g : null;
}

/**
 * End-LP eines Sets = LP im letzten Verlaufs-Eintrag, nur wenn dessen Stufe der
 * gespeicherten Endstufe (Master+) entspricht. "Master 0" ist echt: dak.gg
 * schreibt den Verfall auch ohne Spiele mit (Gegenprobe 2026-10-07: 44/44
 * MetaTFT-Enden = letzter Eintrag). Nur Uebertrag oder leer → null.
 * Exportiert fuer Tests.
 */
export function endFromLeagueLogs(logs: LeagueLog[], prevLast: LeagueLog | null | undefined, endTier: string | null | undefined): number | null {
  const tier = (endTier || '').toUpperCase();
  if (!APEX_TIERS.has(tier)) return null;
  const rows = cleanLeagueLogs(logs, prevLast);
  const last = rows[rows.length - 1];
  if (!last || last[1].toUpperCase() !== tier) return null;
  const lp = Number(last[3]);
  return Number.isFinite(lp) && lp >= 0 ? lp : null;
}

// Seite 1 mit sort=desc enthaelt immer den neuesten Eintrag — fuer die
// Spielzahl allein reicht eine Seite.
async function fetchDakggLeagueLogs(shard: string, gameName: string, tagLine: string, season: string, maxPages = LOG_MAX_PAGES): Promise<LeagueLog[]> {
  const slug = encodeURIComponent(`${gameName}-${tagLine}`);
  const all: LeagueLog[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `${DAKGG_URL}/${shard}/${slug}/league-logs?queueId=${STANDARD_RANKED_QUEUE}&season=${season}&page=${page}&size=${LOG_PAGE_SIZE}&sort=desc`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'metastats.gg/1.0', Origin: 'https://lolchess.gg', Referer: 'https://lolchess.gg/', Accept: 'application/json' },
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    });
    if (!r.ok) throw new Error(`dakgg league-logs HTTP ${r.status}`);
    const data = await r.json();
    const logs: LeagueLog[] = Array.isArray(data?.summonerLeagueLogs) ? data.summonerLeagueLogs : [];
    all.push(...logs);
    const total = Number(data?.meta?.totalCount);
    if (logs.length === 0 || (Number.isFinite(total) ? page * LOG_PAGE_SIZE >= total : logs.length < LOG_PAGE_SIZE)) break;
  }
  return all;
}

/**
 * Vergangene Sets aus dem Verlauf ergaenzen, nacheinander, jedes Set sofort
 * gespeichert, 40 s Deckel:
 *  - Master+-Ende ohne LP → Hoechstwert (leerer Verlauf → Marker).
 *  - Spielzahl leer (MetaTFT hat sie erst ab 9.2) → letzter Eintrag; kein
 *    Verlauf → bleibt leer und wird beim naechsten Neuabruf wieder gefragt.
 *  - Master+-Ende ohne End-LP → LP des letzten Eintrags bei gleicher Stufe;
 *    sonst leer, naechstes Mal erneut. Sets, die nur das brauchen, kommen
 *    zuletzt dran, damit der Deckel zuerst Hoechstwert und Spiele trifft.
 * Der Uebertrag vom Vorset wird am letzten Eintrag des Vorsets erkannt.
 * Fehler → nichts gespeichert (naechstes Mal erneut). Exportiert fuer das
 * Erstbefuellungs-Skript.
 */
export async function fillFromLogs(
  puuid: string, region: string, gameName: string, tagLine: string,
  deadlineMs = LOG_DEADLINE_MS,
): Promise<{ peak: number; games: number; end: number; none: number; failed: number }> {
  const res = { peak: 0, games: 0, end: 0, none: 0, failed: 0 };
  if (!gameName || !tagLine) return res;
  const until = Date.now() + deadlineMs;
  const rows = (await loadRankHistoryRaw(puuid))
    .filter(r => r.set_label && r.set_number < CURRENT_SET)
    .sort((a, b) => a.set_number - b.set_number || a.set_label!.localeCompare(b.set_label!));
  const latest = new Map<string, LeagueLog | null>();
  const latestOf = async (label: string) => {
    if (!latest.has(label)) {
      const season = toDakSeason(label);
      latest.set(label, season ? latestLog(await fetchDakggLeagueLogs(region, gameName, tagLine, season, 1)) : null);
    }
    return latest.get(label) ?? null;
  };
  const apexEnd = (r: SeasonRank) => APEX_TIERS.has((r.end_tier || '').toUpperCase());
  const needs = (r: SeasonRank) => ({
    needPeak: apexEnd(r) && r.peak_lp == null && !isLogLabel(r.peak_rating_label),
    needGames: r.total_games == null,
    needEnd: apexEnd(r) && r.end_lp == null,
  });
  // Zuerst Sets mit Hoechstwert/Spielzahl (End-LP faellt dort mit ab), dann die nur mit End-LP.
  const order = rows.map((_, i) => i).filter(i => rows[i].source !== 'override' && isRealTier(rows[i].end_tier));
  const onlyEnd = (i: number) => { const n = needs(rows[i]); return !n.needPeak && !n.needGames; };
  order.sort((a, b) => Number(onlyEnd(a)) - Number(onlyEnd(b)) || a - b);
  for (const i of order) {
    const r = rows[i];
    const { needPeak, needGames, needEnd } = needs(r);
    if (!needPeak && !needGames && !needEnd) continue;
    if (Date.now() > until) break;
    const season = toDakSeason(r.set_label!);
    if (!season) continue;
    try {
      const logs = await fetchDakggLeagueLogs(region, gameName, tagLine, season, needPeak ? LOG_MAX_PAGES : 1);
      latest.set(r.set_label!, latestLog(logs));
      const prevLast = i > 0 ? await latestOf(rows[i - 1].set_label!) : null;
      const patch: Partial<SeasonRank> = {};
      if (needPeak) {
        const peak = peakFromLeagueLogs(logs, prevLast);
        Object.assign(patch, peak
          ? { peak_tier: peak.tier, peak_division: null, peak_lp: peak.lp, peak_rating_label: LOG_LABEL }
          : { peak_rating_label: LOG_NONE });
        if (peak) res.peak++; else res.none++;
      }
      if (needGames) {
        const games = gamesFromLeagueLogs(logs, prevLast);
        if (games != null) { patch.total_games = games; res.games++; }
      }
      if (needEnd) {
        const lp = endFromLeagueLogs(logs, prevLast, r.end_tier);
        if (lp != null) { patch.end_lp = lp; res.end++; }
      }
      if (Object.keys(patch).length) await patchRankRow(puuid, r.set_label!, patch);
    } catch {
      res.failed++;
    }
  }
  return res;
}

async function patchRankRow(puuid: string, setLabel: string, patch: Partial<SeasonRank>) {
  const res = await fetch(
    `${SUPA_URL}/rest/v1/tft_player_rank_history?puuid=eq.${encodeURIComponent(puuid)}&set_label=eq.${encodeURIComponent(setLabel)}&queue_id=eq.${STANDARD_RANKED_QUEUE}`,
    { method: 'PATCH', headers: { ...supaHeaders(), 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(patch) },
  );
  if (!res.ok) throw new Error(`rank_history patch failed HTTP ${res.status}`);
}

// Welche Zeilen werden geschrieben? Exportiert fuer Tests. Je Feld:
//  - Hoechstrang (peak_*) nur aus MetaTFT; fehlt MetaTFT diesmal, bleibt der
//    gespeicherte MetaTFT-Wert. Alte dakgg-Zeilen trugen ihren Endrang in
//    peak_* — der wird dabei geleert. Werte aus dem dak.gg-LP-Verlauf
//    ('dakgg-log*') bleiben, bis MetaTFT selbst einen Hoechstwert hat.
//  - Endrang (end_*): MetaTFT, sonst gespeicherter MetaTFT-Endrang, sonst dakgg.
//    End-LP aus dem Verlauf bleiben bei vergangenen Sets stehen, wenn die neue
//    Quelle keine LP hat und die Endstufe gleich ist — egal welche Quelle.
//  - dakgg nie fuers laufende Set (Tagesstand) und nie UNRANKED.
export function mergeRankSources(metatft: SeasonRank[], dakgg: SeasonRank[], existing: SeasonRank[] = [], currentSet = CURRENT_SET): SeasonRank[] {
  const labels = new Set<string>();
  const mt = new Map<string, SeasonRank>();
  const dk = new Map<string, SeasonRank>();
  const ex = new Map<string, SeasonRank>();
  for (const r of metatft) if (r.set_label) { mt.set(r.set_label, r); labels.add(r.set_label); }
  for (const r of dakgg) {
    if (!r.set_label || r.set_number >= currentSet || !isRealTier(r.end_tier)) continue;
    dk.set(r.set_label, r); labels.add(r.set_label);
  }
  for (const r of existing) if (r.set_label) ex.set(r.set_label, r);

  const out: SeasonRank[] = [];
  for (const label of labels) {
    const m = mt.get(label), d = dk.get(label), e = ex.get(label);
    const eMt = e?.source === 'metatft' ? e : undefined;
    // Verlaufs-Werte (und der "kein Verlauf"-Marker) bleiben stehen, bis
    // MetaTFT selbst einen Hoechstwert liefert.
    const eLog = e && isLogLabel(e.peak_rating_label) ? e : undefined;
    const peakFrom = m && isRealTier(m.peak_tier) ? m : eMt && isRealTier(eMt.peak_tier) ? eMt : eLog;
    const endFrom = m && isRealTier(m.end_tier) ? m : eMt && isRealTier(eMt.end_tier) ? eMt : d;
    const base = (m || d || e)!;
    out.push({
      set_number: base.set_number,
      set_label: label,
      queue_id: STANDARD_RANKED_QUEUE,
      peak_tier: peakFrom?.peak_tier ?? null,
      peak_division: peakFrom?.peak_division ?? null,
      peak_lp: peakFrom?.peak_lp ?? null,
      peak_rating_label: peakFrom?.peak_rating_label ?? null,
      end_tier: endFrom?.end_tier ?? null,
      end_division: endFrom?.end_division ?? null,
      end_lp: endFrom?.end_lp
        ?? (e && base.set_number < currentSet && sameTier(e.end_tier, endFrom?.end_tier) ? e.end_lp ?? null : null),
      // Spielzahl aus dem Verlauf steht auf dakgg-Zeilen — beim Neuabruf behalten.
      total_games: m?.total_games ?? e?.total_games ?? null,
      source: m || eMt ? 'metatft' : 'dakgg',
    });
  }
  return out;
}

function sameTier(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toUpperCase() === b.toUpperCase();
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
