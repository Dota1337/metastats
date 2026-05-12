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
];

const BATCH = 200;

async function upsertRows(table, rows, conflictCols) {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const url = `${SUPA_URL}/rest/v1/${table}?on_conflict=${conflictCols}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: SUPA_KEY,
        Authorization: `Bearer ${SUPA_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Supabase upsert ${table} failed: HTTP ${res.status} ${body.slice(0, 300)}`);
    }
  }
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
        typical_units: b.typicalUnits || [],
        typical_augments: b.typicalAugments || [],
        carry_items: b.carryItems || [],
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

  log(`  [supabase] write complete for ${region} ${day}`);
}
