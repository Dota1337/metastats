// Abfragen fuer die Comp-Duelle (Migration 0092). Rechnen: tft-comp-matchups.ts.
import { callRpc, DEFAULT_BUCKET, type ResolvedFilters } from './tft-supabase-reader';
import { lookupSnapshot } from './snapshot-lookup';
import { familyRepresentatives, type MatchupResult, type MatchupRow } from './tft-comp-matchups';

type MatchupFilters = Pick<ResolvedFilters, 'regions' | 'buckets' | 'days' | 'patchFilter' | 'setNumber'>;

/**
 * Duell-Zeilen fuer `fams` (optional nur gegen `oppFams`), summiert ueber die
 * Raenge, Regionen und Tage des Filters. Eine jsonb-Antwort, daher keine
 * 1000-Zeilen-Kappung. Wirft bei Fehlern — der Aufrufer nimmt dann den alten Weg.
 */
export async function fetchCompMatchups(
  filters: MatchupFilters,
  fams: string[],
  oppFams: string[] | null = null,
  timeoutMs = 8000,
): Promise<MatchupResult> {
  if (fams.length === 0) return { days: 0, rows: [] };
  const res = await callRpc<{ days?: number; rows?: MatchupRow[] } | null>('get_tft_comp_matchups', {
    p_fams: fams,
    p_opp_fams: oppFams,
    p_regions: filters.regions,
    p_buckets: filters.buckets,
    p_days: filters.days,
    p_patch: filters.patchFilter,
    p_set: filters.setNumber,
    p_min_games: 1,
  }, timeoutMs);
  return { days: Number(res?.days) || 0, rows: Array.isArray(res?.rows) ? res.rows : [] };
}

// Familie → Link-Ziel der Gegnerlisten aus den Listen-Snapshots, ohne
// Datenbank (eine Abfrage ueber alle Comps des Fensters kostet kalt 7,6 s,
// gemessen 11.10.2026). Zuerst die Standard-Liste (alle Regionen, 3 Tage,
// DEFAULT_BUCKET): aus ihr waehlt der Publisher die Detail-Snapshots, Links
// dorthin laden also vorberechnet. Fehlende Familien aus der Liste des
// gewaehlten Filters. 10 Minuten im Speicher der Instanz, Fehler nicht.
const REP_TTL_MS = 10 * 60_000;
const REP_MEMO_MAX = 32;
type RepComp = { clusterKey: string; games: number };
const repMemo = new Map<string, { at: number; comps: Promise<RepComp[]> }>();

function listComps(opts: Parameters<typeof lookupSnapshot>[1]): Promise<RepComp[]> {
  const key = JSON.stringify(opts);
  const now = Date.now();
  const hit = repMemo.get(key);
  if (hit && now - hit.at < REP_TTL_MS) return hit.comps;
  const comps = lookupSnapshot('comps', opts).then(h => {
    const list = (h?.payload as { comps?: Array<{ clusterKey?: string; games?: number }> } | null)?.comps;
    return Array.isArray(list)
      ? list.filter(c => c.clusterKey).map(c => ({ clusterKey: String(c.clusterKey), games: Number(c.games) || 0 }))
      : [];
  });
  comps.catch(() => { if (repMemo.get(key)?.comps === comps) repMemo.delete(key); });
  repMemo.set(key, { at: now, comps });
  if (repMemo.size > REP_MEMO_MAX) repMemo.delete(repMemo.keys().next().value!);
  return comps;
}

export async function compRepresentatives(
  filters: Pick<ResolvedFilters, 'patch' | 'regionLabel' | 'requestedDays' | 'bucketLabel' | 'setNumber'>,
  extra: Iterable<{ clusterKey?: string | null; games?: number | null }> = [],
): Promise<Map<string, { key: string; games: number }>> {
  const base = { patch: filters.patch, minGames: 0, setNumber: filters.setNumber };
  const [std, own] = await Promise.all([
    listComps({ ...base, region: 'all', days: 3, bucket: DEFAULT_BUCKET }).catch(() => [] as RepComp[]),
    listComps({ ...base, region: filters.regionLabel, days: filters.requestedDays, bucket: filters.bucketLabel })
      .catch(() => [] as RepComp[]),
  ]);
  const reps = familyRepresentatives(std);
  for (const [fam, v] of familyRepresentatives(own)) if (!reps.has(fam)) reps.set(fam, v);
  for (const [fam, v] of familyRepresentatives(extra)) if (!reps.has(fam)) reps.set(fam, v);
  return reps;
}
