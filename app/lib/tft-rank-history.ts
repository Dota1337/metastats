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

// Welche Zeilen werden geschrieben? Exportiert fuer Tests. Je Feld:
//  - Hoechstrang (peak_*) nur aus MetaTFT; fehlt MetaTFT diesmal, bleibt der
//    gespeicherte MetaTFT-Wert. Alte dakgg-Zeilen trugen ihren Endrang in
//    peak_* — der wird dabei geleert.
//  - Endrang (end_*): MetaTFT, sonst gespeicherter MetaTFT-Endrang, sonst dakgg.
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
    const peakFrom = m && isRealTier(m.peak_tier) ? m : eMt && isRealTier(eMt.peak_tier) ? eMt : undefined;
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
      end_lp: endFrom?.end_lp ?? null,
      total_games: m?.total_games ?? eMt?.total_games ?? null,
      source: m || eMt ? 'metatft' : 'dakgg',
    });
  }
  return out;
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
