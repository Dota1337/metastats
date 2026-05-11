// Per-player historical ranked-season backfill. Riot's API can't tell us
// what tier the player ended a past set on — that data is gone from their
// systems. metatft has been crawling and storing it since ~Set 8.2, and
// exposes the result via its public profile endpoint, so we use that as a
// one-shot backfill source: on first stats request for a puuid we pull the
// rank_history block, persist it in our own table, and never call metatft
// again for that puuid. From Set 18 onwards we snapshot end-of-set ranks
// ourselves and the dependency on metatft falls away naturally.

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const METATFT_URL = 'https://api.metatft.com/public/profile/lookup_by_riotid';

const STANDARD_RANKED_QUEUE = 1100;

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

/**
 * Ensure we've tried to backfill this player's rank-history. Idempotent —
 * subsequent calls hit the state row and exit immediately. Returns the
 * current rank-history rows for the puuid (already in the DB, including
 * any rows we just inserted).
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
  // Already attempted? Don't re-call metatft. We only retry on explicit
  // force or if the previous attempt was an error and is older than 24h.
  const state = await getBackfillState(puuid);
  const shouldFetch =
    opts.force
    || !state
    || (state.metatft_status === 'error'
        && Date.now() - new Date(state.updated_at).getTime() > 24 * 60 * 60 * 1000);

  if (shouldFetch) {
    try {
      const fetched = await fetchMetatftRatingHistory(region, gameName, tagLine);
      if (fetched.length > 0) {
        await upsertRankHistoryRows(puuid, region, fetched);
        await upsertBackfillState(puuid, region, 'success', null);
      } else {
        await upsertBackfillState(puuid, region, 'no_data', null);
      }
    } catch (e: any) {
      await upsertBackfillState(puuid, region, 'error', e.message?.slice(0, 200) || 'unknown');
      // Don't throw — we still want to return whatever's already cached.
    }
  }

  return loadRankHistory(puuid);
}

export async function loadRankHistory(puuid: string): Promise<SeasonRank[]> {
  const r = await fetch(
    `${SUPA_URL}/rest/v1/tft_player_rank_history?puuid=eq.${encodeURIComponent(puuid)}&queue_id=eq.${STANDARD_RANKED_QUEUE}&select=*&order=set_number.desc`,
    { headers: supaHeaders() },
  );
  if (!r.ok) return [];
  return r.json();
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

async function fetchMetatftRatingHistory(
  region: string, gameName: string, tagLine: string,
): Promise<SeasonRank[]> {
  const url = `${METATFT_URL}/${region}/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'metastats.gg/1.0',
      'Origin': 'https://www.metatft.com',
      'Referer': 'https://www.metatft.com/',
    },
  });
  if (!r.ok) {
    // 404 = profile doesn't exist on metatft, not an error from our PoV
    if (r.status === 404) return [];
    throw new Error(`metatft HTTP ${r.status}`);
  }
  const data = await r.json();
  const ratings = data?.rating_history || {};
  const out: SeasonRank[] = [];
  for (const [setLabel, queues] of Object.entries<any>(ratings)) {
    const setNumber = parseSetNumber(setLabel);
    if (setNumber == null) continue;
    for (const [queueIdStr, entry] of Object.entries<any>(queues)) {
      const queueId = parseInt(queueIdStr, 10);
      if (queueId !== STANDARD_RANKED_QUEUE) continue;
      const peak = parsePeakRating(entry?.peak_rating || '');
      out.push({
        set_number: setNumber,
        set_label: setLabel,
        queue_id: queueId,
        peak_tier: peak?.tier ?? null,
        peak_division: peak?.division ?? null,
        peak_lp: peak?.lp ?? null,
        peak_rating_label: typeof entry?.peak_rating === 'string' ? entry.peak_rating : null,
        total_games: entry?.num_games ?? entry?.total_games ?? null,
        source: 'metatft',
      });
    }
  }
  return out;
}

// "TFTSet16" → 16, "TFTSet9_2" → 9 (the .2 set is a mid-set; we keep the
// base number, the set_label retains the original string).
function parseSetNumber(label: string): number | null {
  const m = /^TFTSet(\d+)/i.exec(label);
  return m ? parseInt(m[1], 10) : null;
}

// "CHALLENGER I 1566 LP" → { tier: 'CHALLENGER', division: 'I', lp: 1566 }
// "MASTER 432 LP" → { tier: 'MASTER', division: null, lp: 432 }
// undefined / non-string → null
function parsePeakRating(raw: string | undefined): { tier: string; division: string | null; lp: number | null } | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 1) return null;
  const tier = parts[0].toUpperCase();
  let division: string | null = null;
  let lp: number | null = null;
  // Apex tiers don't have a division.
  const APEX = new Set(['CHALLENGER', 'GRANDMASTER', 'MASTER']);
  if (APEX.has(tier)) {
    // "MASTER 432 LP" or "MASTER I 432 LP" (metatft uses CHALLENGER I sometimes)
    if (parts.length >= 3 && /^[IVX]+$/.test(parts[1])) {
      division = parts[1];
      lp = parseInt(parts[2].replace(/[^\d]/g, ''), 10) || null;
    } else if (parts.length >= 2) {
      lp = parseInt(parts[1].replace(/[^\d]/g, ''), 10) || null;
    }
  } else {
    // "DIAMOND I 23 LP"
    if (parts.length >= 3) {
      division = parts[1];
      lp = parseInt(parts[2].replace(/[^\d]/g, ''), 10) || null;
    } else if (parts.length >= 2) {
      division = parts[1];
    }
  }
  return { tier, division, lp };
}
