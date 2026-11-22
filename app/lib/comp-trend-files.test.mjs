import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COMP_TREND_WINDOW_DAYS, TREND_ALL_TIERS, TREND_BUCKET_GROUPS, TREND_REGION_GROUPS,
  addDays, buildTrendFile, dayRange, trendFileCovers, trendFileKey, trendFileUsableStale, trendFileValid,
  trendGroupFor, trendGroupMembers, trendGroups, trendPoints,
} from './comp-trend-files.mjs';

const sorted = (a) => [...a].sort();

test('Gruppen = expandRegions/expandBuckets der Route (alle 49)', async () => {
  const { expandRegions, expandBuckets, ALL_BUCKETS } = await import('./tft-supabase-reader.ts');
  assert.deepEqual(sorted(TREND_ALL_TIERS), sorted(ALL_BUCKETS));
  assert.equal(trendGroups().length, 49);
  for (const g of trendGroups()) {
    assert.deepEqual(sorted(g.regions), sorted(expandRegions(g.region)), g.region);
    assert.deepEqual(sorted(g.buckets), sorted(expandBuckets(g.bucket)), g.bucket);
    assert.deepEqual(trendGroupFor(expandRegions(g.region), expandBuckets(g.bucket)), { region: g.region, bucket: g.bucket });
  }
});

test('Gruppen = Auswahl der Detailseite (Regionen + TIER_BUCKETS)', async () => {
  const { TIER_BUCKETS } = await import('./tft-tier-bucket.ts');
  assert.deepEqual([...TREND_BUCKET_GROUPS], [...TIER_BUCKETS]);
  const src = readFileSync(new URL('../tft/comps/[slug]/CompDetailClient.tsx', import.meta.url), 'utf8');
  const block = src.match(/const REGIONS = \[([\s\S]*?)\] as const;/);
  assert.ok(block, 'REGIONS-Liste in CompDetailClient.tsx nicht gefunden');
  const values = [...block[1].matchAll(/value:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(values, TREND_REGION_GROUPS);
});

test('trendGroupFor: Westen, pro_pool und Komma-Listen haben keine Datei', async () => {
  const { expandRegions, expandBuckets } = await import('./tft-supabase-reader.ts');
  assert.equal(trendGroupFor(expandRegions('west'), expandBuckets('all')), null);
  assert.equal(trendGroupFor(expandRegions('all'), expandBuckets('pro_pool')), null);
  assert.equal(trendGroupFor(expandRegions('euw1,kr'), expandBuckets('all')), null);
  // Unbekannte Region faellt in der Route auf "alle" — die Abfrage auch, die Datei darf greifen.
  assert.deepEqual(trendGroupFor(expandRegions('xx9'), expandBuckets('diamond_plus')), { region: 'all', bucket: 'diamond_plus' });
});

// ---------------------------------------------------------------- Gleichheit

// Nachbau von get_tft_comp_daily_trend (0043) + Route (endOffset, day <= Endtag).
function liveReference(rows, { regions, buckets, slug, slugs, days, endDay, today, minGamesPerDay }) {
  const endOffset = Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${endDay}T00:00:00Z`)) / 86_400_000));
  const from = addDays(today, -(days + endOffset));
  const keys = slugs ?? [slug];
  const by = new Map();
  for (const r of rows) {
    if (!regions.includes(r.region) || !buckets.includes(r.bucket) || !keys.includes(r.cluster_key)) continue;
    if (!(r.day > from)) continue;
    const v = by.get(r.day) || [0, 0, 0, 0];
    v[0] += r.games; v[1] += r.sum_placement; v[2] += r.top4; v[3] += r.top1;
    by.set(r.day, v);
  }
  return [...by].filter(([, v]) => v[0] >= minGamesPerDay).sort(([a], [b]) => (a < b ? -1 : 1))
    .filter(([d]) => d <= endDay)
    .map(([day, v]) => ({ day, games: v[0], sum_placement: v[1], top4: v[2], top1: v[3] }));
}

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

function fakeRows(endDay) {
  const r = rng(7);
  const regions = ['euw1', 'kr', 'na1', 'oc1', 'br1'];
  const buckets = [...TREND_ALL_TIERS, 'pro_pool'];
  const comps = ['A', 'B', 'C', 'D', '__proto__'];
  const rows = [];
  for (const day of dayRange(addDays(endDay, -45), addDays(endDay, 2))) {
    for (const region of regions) for (const bucket of buckets) for (const ck of comps) {
      if (r() < 0.55) continue;
      // Patch-Tag: zwei Zeilen je Comp und Tag; manche Zeilen mit 0 Spielen.
      const n = r() < 0.15 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const games = r() < 0.05 ? 0 : 1 + Math.floor(r() * 40);
        rows.push({ day, region, bucket, cluster_key: ck, games, sum_placement: games * (1 + Math.floor(r() * 8)), top4: Math.floor(games * r()), top1: Math.floor(games * r() * 0.3) });
      }
    }
  }
  return rows;
}

test('Datei = Live-Abfrage (Familie, exakt, Raenge, Endtag, Mindestspiele, Duplikate)', () => {
  const endDay = '2026-11-21';
  const rows = fakeRows(endDay);
  const days = dayRange(addDays(endDay, 1 - COMP_TREND_WINDOW_DAYS), endDay);
  const rowsByDay = new Map();
  for (const x of rows) {
    if (!days.includes(x.day) || !TREND_ALL_TIERS.includes(x.bucket)) continue;
    if (!rowsByDay.has(x.day)) rowsByDay.set(x.day, []);
    rowsByDay.get(x.day).push([x.region, x.bucket, x.cluster_key, x.games, x.sum_placement, x.top4, x.top1]);
  }
  let checked = 0;
  for (const g of trendGroups()) {
    const file = JSON.parse(JSON.stringify(buildTrendFile({ region: g.region, bucket: g.bucket, endDay, days, rowsByDay })));
    assert.ok(trendFileValid(file, g.regions, g.buckets));
    for (const [d, offset] of [[14, 0], [30, 0], [14, 2], [30, 2], [30, 4], [1, 0]]) {
      const end = addDays(endDay, -offset);
      if (!trendFileCovers(file, d, end)) continue;
      for (const today of [addDays(end, 1), addDays(end, 3)]) {
        const cases = [
          { slug: 'A', slugs: null, min: 0 },
          { slug: '__proto__', slugs: null, min: 0 },
          { slug: 'A', slugs: ['A', 'B', 'B', 'Z'], min: 20 },
          { slug: 'C', slugs: ['C', 'D', '__proto__'], min: 20 },
          // Familie ohne den Slug selbst: zaehlt nur die Liste (wie p_cluster_keys)
          { slug: 'A', slugs: ['C', 'D'], min: 20 },
          // Slug ohne jede Zeile
          { slug: 'Z', slugs: null, min: 0 },
        ];
        for (const c of cases) {
          const want = liveReference(rows, { regions: g.regions, buckets: g.buckets, slug: c.slug, slugs: c.slugs, days: d, endDay: end, today, minGamesPerDay: c.min });
          const got = trendPoints(file, { slugs: c.slugs ?? [c.slug], days: d, endDay: end, minGamesPerDay: c.min });
          assert.deepEqual(got, want, `${g.region}/${g.bucket} ${d}d end-${offset} ${c.slug}`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 1000, `nur ${checked} Vergleiche`);
});

test('Abdeckung und Notantwort', () => {
  const endDay = '2026-11-21';
  const days = dayRange(addDays(endDay, 1 - COMP_TREND_WINDOW_DAYS), endDay);
  const file = buildTrendFile({ region: 'all', bucket: 'all', endDay, days, rowsByDay: new Map() });
  assert.equal(trendFileCovers(file, 30, endDay), true);
  assert.equal(trendFileCovers(file, 30, addDays(endDay, -5)), true);
  assert.equal(trendFileCovers(file, 30, addDays(endDay, -6)), false); // Fenster beginnt vor der Datei
  assert.equal(trendFileCovers(file, 14, addDays(endDay, 1)), false); // Datei endet zu frueh
  assert.equal(trendFileCovers(file, 60, endDay), false);
  assert.equal(trendFileUsableStale(file, addDays(endDay, 7)), true);
  assert.equal(trendFileUsableStale(file, addDays(endDay, 8)), false);
  // Notantwort: echte Punkte bis zum Datei-Ende, nichts danach.
  assert.deepEqual(trendPoints(file, { slugs: ['A'], days: 14, endDay: addDays(endDay, 2) }), []);
});

test('Pfad mit Endtag; Datei bis E+1, Anfrage bis E liefert keinen Punkt nach E', () => {
  assert.equal(trendFileKey('2026-11-21', 'all', 'diamond_plus'), 'tft/comp-trend/v1/2026-11-21/all__diamond_plus.json');
  const endDay = '2026-11-22';
  const days = dayRange(addDays(endDay, 1 - COMP_TREND_WINDOW_DAYS), endDay);
  const rowsByDay = new Map(days.map((d) => [d, [['euw1', 'master', 'A', 10, 40, 6, 1]]]));
  const file = buildTrendFile({ region: 'all', bucket: 'all', endDay, days, rowsByDay });
  const pts = trendPoints(file, { slugs: ['A'], days: 14, endDay: '2026-11-21' });
  assert.equal(pts.length, 14);
  assert.equal(pts[0].day, '2026-11-08');
  assert.equal(pts[pts.length - 1].day, '2026-11-21');
});

test('trendFileValid: falsche Listen, Format oder Tage werden abgelehnt', () => {
  const endDay = '2026-11-21';
  const days = dayRange(addDays(endDay, -2), endDay);
  const { regions, buckets } = trendGroupMembers('euw1', 'master_plus');
  const file = buildTrendFile({ region: 'euw1', bucket: 'master_plus', endDay, days, rowsByDay: new Map() });
  assert.equal(trendFileValid(file, regions, buckets), true);
  assert.equal(trendFileValid(file, ['kr'], buckets), false);
  assert.equal(trendFileValid(file, regions, ['master']), false);
  assert.equal(trendFileValid({ ...file, v: 2 }, regions, buckets), false);
  assert.equal(trendFileValid({ ...file, days: days.slice(1) }, regions, buckets), false);
  assert.equal(trendFileValid(null, regions, buckets), false);
  assert.throws(() => buildTrendFile({ region: 'west', bucket: 'all', endDay, days, rowsByDay: new Map() }));
});
