// Writes a finalized TFT crawl payload into the Supabase daily-stats tables.
// One call per region/day. Idempotent: each row is upserted on its unique
// (region, bucket, patch, set, day, …entity) constraint, so re-running the
// crawler for the same day just overwrites the previous numbers.
//
// Uses the REST API + Service Role Key (no direct Postgres connection), so
// it works from GitHub Actions runners without any extra secret.

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bwawxwgxxfafbruebixa.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Buckets we actually persist. 'all' / 'master_plus' are computed on read
// (the API GROUP BYs across the requested set of base buckets), so we never
// store rolled-up duplicates and the storage footprint stays manageable.
// 'iron' is excluded per the product spec — too few players for meaningful
// per-region stats below Bronze.
const PERSIST_BUCKETS = [
  'bronze', 'silver', 'gold', 'platinum', 'emerald',
  'diamond', 'master', 'grandmaster', 'challenger',
  // Synthetic dimension: rows tagged `pro_pool` exist alongside the
  // tier-bucket rows for any match containing a TFT pro participant.
  // Lets the API filter to pro-only stats via `bucket=pro_pool`.
  'pro_pool',
];

const BATCH = 200;

// Alle Tagestabellen, die dieser Writer befuellt — der Tagestreiber raeumt genau
// diese nach dem Sammeln auf (VACUUM). daily-crawl-post.test.mjs prueft, dass
// die Liste zu den upsertRows-Aufrufen unten passt.
export const DAILY_TABLES = [
  'tft_daily_comp_stats',
  'tft_daily_unit_stats',
  'tft_daily_unit_top_items',
  'tft_daily_unit_builds',
  'tft_daily_item_stats',
  'tft_daily_trait_stats',
  'tft_daily_comp_pairs',
  'tft_daily_augment_stats',
  'tft_daily_trait_unitcount_stats',
  'tft_daily_crawl_meta',
  'tft_daily_comp_outcome',
  'tft_daily_comp_matchups',
];

// tft_daily_comp_matchups (0092): 17k (me1) bis 188k (kr) schmale Zeilen je
// Region und Tag (gemessen am 10.10.2026) — 200er-Pakete waeren bis zu 940
// Anfragen. Aufbewahrung 8 Tage vor dem geschriebenen Tag, also 9 Tage
// gespeichert: die App sendet nie einen Patch. Seit den vollen Tagen (0095)
// endet ihr Fenster (1-7 Tage) am letzten vollstaendigen Tag E, meist
// neuester Tag - 1, und reicht damit bis neuester Tag - 7 (snapshot-matrix.ts
// dataWindow); der neunte Tag ist Puffer fuer einen Patch-Cache, der einen
// Tag hinterherhaengt. Nur direkte API-Aufrufe mit einem laengst abgelaufenen
// Patch reichen weiter zurueck und sehen dann weniger Tage.
const MATCHUP_BATCH = 1000;
const MATCHUP_KEEP_DAYS = 8;
// tft_daily_unit_builds (0096): gleiche Aufbewahrung, gleiche Begruendung.
// Zeilen 1-6 KB (Arrays je Stern und Platz) → kleinere Pakete als 200.
const UNIT_BUILDS_KEEP_DAYS = 8;
const UNIT_BUILDS_BATCH = 100;

/** Erster Tag, der fuer `day` (YYYY-MM-DD) noch aufbewahrt wird. */
export function matchupKeepFrom(day, keepDays = MATCHUP_KEEP_DAYS) {
  const t = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(t)) throw new Error(`bad day ${day}`);
  return new Date(t - keepDays * 86_400_000).toISOString().slice(0, 10);
}

// Transient-failure resilience (Backlog-Item 2, L1). A Supabase compute
// saturation event answers with Cloudflare 522/504 or drops the connection
// entirely (fetch rejects). Before this layer a single such blip on the very
// first upsert (crawl_meta) aborted the whole region for the day — the
// 2026-06-23 outage lost all 15 regions this way. We retry the batch a few
// times with growing backoff that spans a full Supabase restart (~60-120s),
// and bound every attempt with a fetch timeout so a wedged socket can't hang
// the crawl indefinitely (the old code had no timeout at all).
const RETRY_STATUS = new Set([429, 500, 502, 503, 504, 522, 524]);
const RETRY_BACKOFF_MS = [30_000, 60_000, 120_000];
const FETCH_TIMEOUT_MS = 30_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// tft_daily_comp_outcome: Zeilen von mehreren KB. 200 davon waeren bis zu
// ~2 MB je Anfrage und reissen das 30-s-Zeitlimit bei einer langsamen DB.
const OUTCOME_CHUNK_BYTES = 1_500_000;

// Teilt Zeilen in Pakete von hoechstens maxBytes (JSON-Laenge) und hoechstens
// BATCH Zeilen. Eine einzelne zu grosse Zeile bildet ihr eigenes Paket.
export function chunkByBytes(rows, maxBytes) {
  const chunks = [];
  let cur = [];
  let size = 0;
  for (const r of rows) {
    const len = JSON.stringify(r).length;
    if (cur.length > 0 && (size + len > maxBytes || cur.length >= BATCH)) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(r);
    size += len;
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

// Eine Anfrage mit den Wiederholungen oben; wirft nach dem letzten Versuch.
async function requestWithRetry(url, init, label, log) {
  for (let attempt = 0; ; attempt++) {
    let res = null;
    let netErr = null;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (err) {
      // fetch rejects on connection refused/reset (TypeError) or on the
      // AbortSignal timeout (TimeoutError). Both are transient → retriable.
      netErr = err;
    }
    if (res && res.ok) return;

    const retriable = netErr != null || RETRY_STATUS.has(res.status);
    if (retriable && attempt < RETRY_BACKOFF_MS.length) {
      const waitMs = RETRY_BACKOFF_MS[attempt];
      const reason = netErr ? `${netErr.name || 'fetch error'}` : `HTTP ${res.status}`;
      log(`  [supabase] ${label} transient ${reason} — retry ${attempt + 1}/${RETRY_BACKOFF_MS.length} in ${waitMs / 1000}s`);
      await sleep(waitMs);
      continue;
    }

    if (netErr) {
      throw new Error(`Supabase ${label} failed: ${netErr.name || 'fetch error'} ${netErr.message || ''}`.trim());
    }
    const errBody = await res.text();
    throw new Error(`Supabase ${label} failed: HTTP ${res.status} ${errBody.slice(0, 300)}`);
  }
}

async function upsertRows(table, rows, conflictCols, log = console.log, batchSize = BATCH) {
  if (rows.length === 0) return;
  const headers = {
    apikey: SUPA_KEY,
    Authorization: `Bearer ${SUPA_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  };
  const url = `${SUPA_URL}/rest/v1/${table}?on_conflict=${conflictCols}`;
  for (let i = 0; i < rows.length; i += batchSize) {
    const body = JSON.stringify(rows.slice(i, i + batchSize));
    await requestWithRetry(url, { method: 'POST', headers, body }, `upsert ${table}`, log);
  }
}

// filters: PostgREST-Filter je Spalte, z. B. { region: 'eq.euw1', day: 'lt.2026-10-01' }.
// Ohne Filter verweigert die Funktion — ein DELETE ohne WHERE leert die Tabelle.
async function deleteRows(table, filters, log = console.log) {
  const qs = new URLSearchParams(filters).toString();
  if (!qs) throw new Error(`deleteRows ${table}: kein Filter`);
  const headers = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Prefer: 'return=minimal' };
  await requestWithRetry(`${SUPA_URL}/rest/v1/${table}?${qs}`, { method: 'DELETE', headers }, `delete ${table}`, log);
}

/**
 * @param {object} opts
 * @param {string} opts.region        platform routing value ('euw1','kr',…)
 * @param {string} opts.day           YYYY-MM-DD (UTC)
 * @param {string} opts.patch         e.g. '17.2b'
 * @param {number} opts.setNumber     e.g. 17
 * @param {object} opts.payload       finalize() output from tft-build-aggregator
 * @param {(msg: string) => void} [opts.log]
 */
export async function writeTftStatsToSupabase(opts) {
  const { region, day, patch, setNumber, payload, log = console.log } = opts;
  if (!SUPA_KEY) {
    log('  [supabase] SUPABASE_SERVICE_ROLE_KEY missing, skipping DB write');
    return;
  }
  if (!patch || setNumber == null) {
    log('  [supabase] patch/setNumber missing, skipping DB write');
    return;
  }

  const baseRow = { region, patch, set_number: setNumber, day };

  // 1) Crawl meta — one row per bucket
  const metaRows = [];
  for (const bucket of PERSIST_BUCKETS) {
    const participants = payload.participantsByBucket?.[bucket] || 0;
    if (participants === 0) continue;
    metaRows.push({
      ...baseRow,
      bucket,
      matches_analyzed: payload.matchesAnalyzed || 0,
      matches_skipped: payload.matchesSkipped || 0,
      participants,
      finished_at: new Date().toISOString(),
    });
  }
  log(`  [supabase] crawl_meta: ${metaRows.length} rows`);
  await upsertRows('tft_daily_crawl_meta', metaRows, 'region,bucket,day,set_number');

  // 2) Units
  const unitRows = [];
  for (const [cid, buckets] of Object.entries(payload.byUnit || {})) {
    for (const bucket of PERSIST_BUCKETS) {
      const b = buckets[bucket];
      if (!b || !b.games) continue;
      unitRows.push({
        ...baseRow, bucket, character_id: cid,
        games: b.games, sum_placement: b.sumPlacement, top4: b.top4, top1: b.top1 ?? 0,
      });
    }
  }
  log(`  [supabase] unit_stats: ${unitRows.length} rows`);
  await upsertRows('tft_daily_unit_stats', unitRows,
    'region,bucket,patch,set_number,day,character_id');

  // 3) Items (with topUsers jsonb)
  const itemRows = [];
  for (const [apiName, buckets] of Object.entries(payload.byItem || {})) {
    for (const bucket of PERSIST_BUCKETS) {
      const b = buckets[bucket];
      if (!b || !b.games) continue;
      itemRows.push({
        ...baseRow, bucket, api_name: apiName,
        games: b.games, sum_placement: b.sumPlacement, top4: b.top4,
        top1: b.top1 ?? 0,
        top_users: b.topUsers || [],
      });
    }
  }
  log(`  [supabase] item_stats: ${itemRows.length} rows`);
  await upsertRows('tft_daily_item_stats', itemRows,
    'region,bucket,patch,set_number,day,api_name');

  // 4) Augments — per slot
  const augRows = [];
  for (const [apiName, slotMap] of Object.entries(payload.byAugment || {})) {
    for (const [slotKey, buckets] of Object.entries(slotMap)) {
      const slot = Number(slotKey);
      if (Number.isNaN(slot)) continue;
      for (const bucket of PERSIST_BUCKETS) {
        const b = buckets[bucket];
        if (!b || !b.games) continue;
        augRows.push({
          ...baseRow, bucket, api_name: apiName, slot,
          games: b.games, sum_placement: b.sumPlacement, top4: b.top4,
        });
      }
    }
  }
  log(`  [supabase] augment_stats: ${augRows.length} rows`);
  await upsertRows('tft_daily_augment_stats', augRows,
    'region,bucket,patch,set_number,day,api_name,slot');

  // 5) Traits — per activation level
  const traitRows = [];
  for (const [name, levels] of Object.entries(payload.byTrait || {})) {
    for (const [actKey, buckets] of Object.entries(levels)) {
      const activation = Number(actKey);
      if (Number.isNaN(activation)) continue;
      for (const bucket of PERSIST_BUCKETS) {
        const b = buckets[bucket];
        if (!b || !b.games) continue;
        traitRows.push({
          ...baseRow, bucket, name, activation,
          games: b.games, sum_placement: b.sumPlacement, top4: b.top4,
        });
      }
    }
  }
  log(`  [supabase] trait_stats: ${traitRows.length} rows`);
  await upsertRows('tft_daily_trait_stats', traitRows,
    'region,bucket,patch,set_number,day,name,activation');

  // 5b) Traits by actual unit count (overcapping signal — migration 0025)
  const traitUcRows = [];
  for (const [name, counts] of Object.entries(payload.byTraitUnitCount || {})) {
    for (const [ucKey, buckets] of Object.entries(counts)) {
      const numUnits = Number(ucKey);
      if (Number.isNaN(numUnits)) continue;
      for (const bucket of PERSIST_BUCKETS) {
        const b = buckets[bucket];
        if (!b || !b.games) continue;
        traitUcRows.push({
          ...baseRow, bucket, name, num_units: numUnits,
          games: b.games, sum_placement: b.sumPlacement, top4: b.top4,
        });
      }
    }
  }
  log(`  [supabase] trait_unitcount_stats: ${traitUcRows.length} rows`);
  await upsertRows('tft_daily_trait_unitcount_stats', traitUcRows,
    'region,bucket,patch,set_number,day,name,num_units');

  // 6) Comps — with jsonb typical_units / augments / carry items
  const compRows = [];
  for (const [clusterKey, buckets] of Object.entries(payload.byComp || {})) {
    for (const bucket of PERSIST_BUCKETS) {
      const b = buckets[bucket];
      if (!b || !b.games) continue;
      compRows.push({
        ...baseRow, bucket, cluster_key: clusterKey,
        games: b.games, sum_placement: b.sumPlacement, top4: b.top4, top1: b.top1 ?? 0,
        sum_level: b.sumLevel ?? 0,
        sum_last_round: b.sumLastRound ?? 0,
        sum_players_eliminated: b.sumPlayersEliminated ?? 0,
        sum_gold_left: b.sumGoldLeft ?? 0,
        typical_units: b.typicalUnits || [],
        typical_augments: b.typicalAugments || [],
        carry_items: b.carryItems || [],
        last_round_dist: b.lastRoundDist || {},
        top4_by_round: b.top4ByRound || {},
        level_dist: b.levelDist || {},
        level_sum_last_round: b.levelSumLastRound || {},
        carry_star_dist: b.carryStarDist || {},
        contested_dist: b.contestedDist || {},
      });
    }
  }
  log(`  [supabase] comp_stats: ${compRows.length} rows`);
  await upsertRows('tft_daily_comp_stats', compRows,
    'region,bucket,patch,set_number,day,cluster_key');

  // 7) Comp pairs (not bucket-stratified in the aggregator; persisted as
  // bucket='all' so the reader can grab counter edges without join gymnastics)
  const pairRows = (payload.compPairs || []).map(e => ({
    ...baseRow, bucket: 'all',
    a_key: e.a, b_key: e.b,
    games: e.games, a_better: e.aBetter,
  }));
  log(`  [supabase] comp_pairs: ${pairRows.length} rows`);
  await upsertRows('tft_daily_comp_pairs', pairRows,
    'region,bucket,patch,set_number,day,a_key,b_key');

  // 8) Unit-Top-Items (migration 0069) — die 15 meistgespielten fertigen Items
  // je Unit x Bucket fuer die Item-Reihe auf /tft/units. Bewusst als letzter
  // Block und abgefangen: ein Fehler hier darf keine der Kern-Tabellen oben
  // kosten und die Region nicht als gescheitert markieren. Ein Ausfall wird
  // vom Laufzeit-Vertrag daily-crawl/unit-top-items gemeldet.
  try {
    const topItemRows = [];
    for (const [cid, buckets] of Object.entries(payload.byUnit || {})) {
      for (const bucket of PERSIST_BUCKETS) {
        const b = buckets[bucket];
        if (!b || !b.games || !Array.isArray(b.persistTopItems) || b.persistTopItems.length === 0) continue;
        topItemRows.push({ ...baseRow, bucket, character_id: cid, items: b.persistTopItems });
      }
    }
    log(`  [supabase] unit_top_items: ${topItemRows.length} rows`);
    await upsertRows('tft_daily_unit_top_items', topItemRows,
      'region,bucket,patch,set_number,day,character_id', log);
  } catch (e) {
    log(`  [supabase] unit_top_items FAILED (non-fatal): ${e.message}`);
  }

  // 8b) Unit-Builds (migration 0096) — Item-Bloecke der Unit-Detailseite
  // (Builds, Items je Stern, Item-Plaetze). Abgefangen wie Block 8, der
  // Vertrag daily-crawl/unit-builds meldet einen Ausfall. Tage vor der
  // Aufbewahrung raeumt derselbe Block ab, nur fuer diese Region.
  try {
    const buildRows = [];
    for (const [cid, buckets] of Object.entries(payload.byUnit || {})) {
      for (const bucket of PERSIST_BUCKETS) {
        const b = buckets[bucket];
        const pb = b?.persistBuilds;
        if (!b || !b.games || !pb) continue;
        buildRows.push({
          ...baseRow, bucket, character_id: cid,
          stars: pb.stars, sets: pb.sets,
          items_by_tier: pb.itemsByTier, sets_by_tier: pb.setsByTier, slots_by_tier: pb.slotsByTier,
        });
      }
    }
    await deleteRows('tft_daily_unit_builds',
      { region: `eq.${region}`, day: `lt.${matchupKeepFrom(day, UNIT_BUILDS_KEEP_DAYS)}` }, log);
    log(`  [supabase] unit_builds: ${buildRows.length} rows`);
    await upsertRows('tft_daily_unit_builds', buildRows,
      'region,bucket,patch,set_number,day,character_id', log, UNIT_BUILDS_BATCH);
  } catch (e) {
    log(`  [supabase] unit_builds FAILED (non-fatal): ${e.message}`);
  }

  // 9) Comp-Ergebnisse je Unit und Item (migration 0078) — eine Zeile je
  // comp_stats-Zeile (ohne pro_pool). Zeilen sind mehrere KB gross, deshalb
  // Pakete nach Bytes statt nach 200 Zeilen. Abgefangen wie Block 8: fehlt ein
  // Tag, blendet die Route die neuen Bloecke fuer dieses Fenster aus
  // (rows_outcome != rows_stats), die Kern-Tabellen bleiben unberuehrt.
  try {
    const outcomeRows = [];
    for (const [clusterKey, buckets] of Object.entries(payload.byComp || {})) {
      for (const bucket of PERSIST_BUCKETS) {
        if (bucket === 'pro_pool') continue;
        const o = buckets[bucket]?.outcome;
        if (!o || !o.games) continue;
        outcomeRows.push({
          ...baseRow, bucket, cluster_key: clusterKey,
          games: o.games,
          placement_hist: o.placementHist,
          level_stats: o.levelStats,
          level_stats_s5: o.levelStatsS5,
          units: o.units,
          unit_levels: o.unitLevels,
          unit_items: o.unitItems,
          unit_sets: o.unitSets,
          // 0091. Immer mitschicken (auch null): PostgREST verlangt in einem
          // Paket dieselben Schluessel in jeder Zeile.
          emblems: o.emblems ?? null,
        });
      }
    }
    const chunks = chunkByBytes(outcomeRows, OUTCOME_CHUNK_BYTES);
    const bytes = outcomeRows.reduce((a, r) => a + JSON.stringify(r).length, 0);
    log(`  [supabase] comp_outcome: ${outcomeRows.length} rows, ${(bytes / 1e6).toFixed(1)} MB in ${chunks.length} requests`);
    for (const chunk of chunks) {
      await upsertRows('tft_daily_comp_outcome', chunk,
        'region,bucket,patch,set_number,day,cluster_key', log);
    }
  } catch (e) {
    log(`  [supabase] comp_outcome FAILED (non-fatal): ${e.message}`);
  }

  // 10) Comp-Duelle je Familie und Rang (migration 0092). Abgefangen wie
  // Block 8/9: ein Fehler kostet nur die Duelle dieses Tages, der Vertrag
  // daily-crawl/comp-matchups meldet ihn.
  try {
    await writeCompMatchups({ region, day, patch, setNumber, compMatchups: payload.compMatchups, log });
  } catch (e) {
    log(`  [supabase] comp_matchups FAILED (non-fatal): ${e.message}`);
  }

  log(`  [supabase] write complete for ${region} ${day}`);
}

/**
 * Block 10 einzeln (auch fuer den Schreibtest mit eigener Test-Region). Erst
 * die Zeilen dieser Region an diesem Tag loeschen — ein Wiederholungslauf mit
 * anderer Stichprobe liesse sonst Paare des ersten Laufs stehen —, dann
 * schreiben. Tage vor der Aufbewahrung raeumt derselbe Aufruf ab, nur fuer
 * diese Region. Wirft bei Fehlern.
 */
export async function writeCompMatchups({ region, day, patch, setNumber, compMatchups, log = console.log }) {
  if (!SUPA_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
  const baseRow = { region, patch, set_number: setNumber, day };
  const rows = [];
  for (const e of compMatchups || []) {
    if (e.bucket === 'pro_pool' || !PERSIST_BUCKETS.includes(e.bucket)) continue;
    rows.push({ ...baseRow, bucket: e.bucket, comp_fam: e.comp, opp_fam: e.opp, games: e.games, better: e.better });
  }
  await deleteRows('tft_daily_comp_matchups',
    { region: `eq.${region}`, day: `eq.${day}`, set_number: `eq.${setNumber}` }, log);
  await deleteRows('tft_daily_comp_matchups',
    { region: `eq.${region}`, day: `lt.${matchupKeepFrom(day)}` }, log);
  log(`  [supabase] comp_matchups: ${rows.length} rows`);
  await upsertRows('tft_daily_comp_matchups', rows,
    'region,bucket,patch,set_number,day,comp_fam,opp_fam', log, MATCHUP_BATCH);
  return rows.length;
}
