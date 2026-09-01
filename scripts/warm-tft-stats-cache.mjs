#!/usr/bin/env node
// Cache-warmer for the TFT stats endpoints.
//
// The stats APIs cache at the Vercel edge for 6h (+24h stale-while-revalidate)
// because the underlying data only changes once a day, after the Hetzner
// aggregate crawl (00:00 UTC start, done by ~09:00 UTC). With caching alone the
// FIRST visitor of each popular filter combo every morning still pays the cold
// Supabase RPC (~1.5s). This script pre-fires those exact combos right after
// the crawl so the edge holds a fresh copy before any user arrives — every real
// request then gets an instant X-Vercel-Cache: HIT.
//
// It hits the SAME query strings the stats pages build (filtersToQueryString
// order: patch, bucket, days, region, dann optional bucketAuto und velocity —
// see app/components/tft/StatsFilterBar) so the warmed cache keys match the
// ones users hit exactly. No secrets needed — these are public GET endpoints.
//
// Diese Deckungsgleichheit ist die ganze Wirkung des Scripts: der Cache-
// Schluessel ist die Adresse Zeichen fuer Zeichen. Ein fehlender Parameter
// waermt ein Fach, das niemand oeffnet, und der erste Besucher zahlt trotzdem
// den kalten Aufruf — genau das war bis 2026-09-01 der Fall.
//
// Usage:
//   node scripts/warm-tft-stats-cache.mjs
//   WARM_BASE_URL=https://staging... WARM_CONCURRENCY=6 node scripts/warm-tft-stats-cache.mjs

import { ONETRICK_REGIONS } from '../app/lib/tft-onetrick-regions.mjs';

const BASE = (process.env.WARM_BASE_URL || 'https://www.metastats.gg').replace(/\/$/, '');
// Serial by default. These are heavy aggregation RPCs sharing one Postgres;
// firing several region=all slices at once makes them contend and tip over the
// 20s statement timeout (observed: 3-wide → 502s, 1-wide → all 24 keys warm
// cleanly). Warming is a background job, so the ~2-3min serial cold run is
// fine. Override with WARM_CONCURRENCY only against a warm cache.
const CONCURRENCY = Math.max(1, Number(process.env.WARM_CONCURRENCY) || 1);
// 60s default: covers the onetricks cold path (Hetzner pool + 1000-puuid
// match fetch + classify, ~10-30s). Stats RPCs are all well under this.
const TIMEOUT_MS = Math.max(5_000, Number(process.env.WARM_TIMEOUT_MS) || 60_000);
// Ueber dieser HTTP-Fehlerquote gilt der Lauf als fehlgeschlagen. 30 % laesst
// einzelne kalte Keys durch (die heilen sich per stale-while-revalidate beim
// naechsten Request), faengt aber den Fall "halbe Seite bleibt kalt".
const MAX_FAIL_RATE = Math.min(1, Number(process.env.WARM_MAX_FAIL_RATE) || 0.3);

// patch=current always: the stats pages never deep-link a specific patch, they
// resolve "current" server-side to the newest established patch.
const PATCH = 'current';

// MUST mirror filtersToQueryString's insertion order — the edge cache key is
// the literal query string, so a different order is a different (cold) key.
//
// `bucketAuto` und `velocity` gehoeren zwingend dazu, auch wenn sie hier lange
// gefehlt haben: filtersToQueryString (app/components/tft/StatsFilterBar.tsx:254)
// haengt `bucketAuto=1` an, solange der Besucher den Rang NICHT selbst gewaehlt
// hat — also bei jedem ersten Seitenaufruf. Ohne den Parameter waermt dieses
// Script eine Adresse, die kein Browser je aufruft (gemessen 2026-09-01:
// Waermer-Form 4,78 s Fehltreffer, Browser-Form 1,17 s; auf /api/tft/units
// stand `Age: 11` gegen `Age: 473`).
//
// `bucketAuto` ist nicht nur Kosmetik fuer den Schluessel: der Server sucht sich
// den Rang damit selbst aus (app/lib/tft-supabase-reader.ts:266-268), die
// Antwort ist also eine andere.
function qs(bucket, days, region, { bucketAuto = false, velocity = 0 } = {}) {
  let s = `patch=${PATCH}&bucket=${bucket}&days=${days}&region=${region}`;
  if (bucketAuto) s += '&bucketAuto=1';
  if (velocity > 0) s += `&velocity=${velocity}`;
  return s;
}

// Combos are restricted to slices that stay safely under the 20s Supabase
// statement timeout even cold (measured 2026-05). The comp LIST RPC was made
// lean in migration 0027, so comps is fast across the board (all-bucket/7d
// ~5s) and gets the full matrix. The units/items/traits RPCs are NOT lean yet
// — get_tft_item_stats over all buckets / 7 days is ~76s today and 502s — so
// they're warmed only on the light, high-traffic slices that complete quickly.
// Warming the slow-but-working ones (e.g. items diamond/3d ~9s) is exactly
// where warming pays off: the morning visitor gets a HIT instead of the 9s.
function buildUrls() {
  const urls = new Set();

  // Der haeufigste Aufruf ueberhaupt: erster Seitenbesuch ohne gesetzten Rang.
  // Die Seite schickt dann `bucketAuto=1` und als Rang den Wert aus
  // autoBucketDefault() bzw. den zuletzt vom Server gelieferten (StatsFilterBar
  // :283-290, AUTO_BUCKET_KEY). Beide sind heute `diamond_plus` — gemessen
  // 2026-09-01 gegen /api/tft/units?…&bucketAuto=1: `filters.bucket` kam als
  // "diamond_plus" zurueck, resolveDefaultBucket liefert also denselben Wert.
  // Aendert sich das (Set-Wechsel, duenne Datenlage), waermt diese Zeile
  // trotzdem exakt den Schluessel, den der Browser baut — der Rang im
  // Schluessel ist der Wunsch, nicht die Antwort.
  const AUTO = { bucketAuto: true };
  urls.add(`/api/tft/comps?${qs('diamond_plus', 3, 'all', AUTO)}&source=data`);
  for (const ep of ['units', 'items', 'traits']) {
    urls.add(`/api/tft/${ep}?${qs('diamond_plus', 3, 'all', AUTO)}`);
  }

  // Comps — full matrix (lean RPC, all slices fast).
  for (const bucket of ['diamond_plus', 'master_plus', 'all']) {
    for (const days of [3, 7]) {
      urls.add(`/api/tft/comps?${qs(bucket, days, 'all')}&source=data`);
    }
  }
  // Region split for the two top buckets at the default 3-day window — the
  // comp meta is region-specific and these are the common region toggles.
  for (const bucket of ['diamond_plus', 'master_plus']) {
    for (const region of ['all', 'west', 'asia', 'euw1', 'kr', 'na1']) {
      urls.add(`/api/tft/comps?${qs(bucket, 3, region)}&source=data`);
    }
  }

  // Units / items / traits — the high-traffic rank slices at region=all.
  // items got the lean RPC in migration 0028 (all-bucket/7d 76s→5.5s), so it
  // now warms the same matrix as the others instead of just the safe defaults.
  for (const ep of ['units', 'items', 'traits']) {
    urls.add(`/api/tft/${ep}?${qs('diamond_plus', 3, 'all')}`);
    urls.add(`/api/tft/${ep}?${qs('master_plus', 3, 'all')}`);
    urls.add(`/api/tft/${ep}?${qs('master_plus', 7, 'all')}`);
  }

  // Onetricks — region-scoped Master+ one-trick detection. Cold call goes
  // through the Hetzner /marketvalue-pool + /player-matches chain and takes
  // 10-30s (1000 puuids × 50 matches ≈ 40MB JSON transfer). Edge cache is
  // 6h, so warming once a day right after the daily crawl finishes keeps
  // every real user hit instant. Die Liste kommt aus derselben Datei wie die
  // Seite: eine Region, die man anklicken kann, muss auch gewaermt werden.
  for (const region of ONETRICK_REGIONS) {
    urls.add(`/api/tft/onetricks?region=${region}`);
  }

  // Meta-Pulse + Patch-Diff — landing-tier pages, both cold ~10s. Patch-diff
  // matrix covers the 4 entity types × 2 default buckets users actually open.
  // Meta-pulse is single-bucket per call.
  // Meta-Puls baut seine Adresse ebenfalls mit filtersToQueryString, dazu zwei
  // Eigenheiten der Seite (app/tft/meta-pulse/page.tsx:50-52): ohne Rang in der
  // URL steht `master_plus` im Filter (nicht diamond_plus wie ueberall sonst),
  // und der Vergleichs-Zeitraum ist nie 0, sondern 3 Tage. Die frueher hier
  // gewaermten Adressen (`bucket=…&days=…&patch=…`, ohne region/velocity und in
  // anderer Reihenfolge) hat kein Browser je aufgerufen.
  urls.add(`/api/tft/meta-pulse?${qs('master_plus', 3, 'all', { bucketAuto: true, velocity: 3 })}`);
  urls.add(`/api/tft/meta-pulse?${qs('master_plus', 3, 'all', { velocity: 3 })}`);
  urls.add(`/api/tft/meta-pulse?${qs('diamond_plus', 3, 'all', { velocity: 3 })}`);
  for (const entity of ['unit', 'item', 'trait', 'comp']) {
    for (const bucket of ['master_plus', 'diamond']) {
      urls.add(`/api/tft/patch-diff?entity=${entity}&bucket=${bucket}`);
    }
  }

  return [...urls];
}

async function warmOne(path) {
  const url = `${BASE}${path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      // A bare GET, exactly like the browser — no cache-bust param, so we hit
      // (and populate) the real cache key. cache:no-store keeps THIS process
      // from reusing anything; the edge still caches the response.
      cache: 'no-store',
      signal: ctrl.signal,
    });
    const ms = Date.now() - start;
    const edge = res.headers.get('x-vercel-cache') || '-';
    let comps = '';
    if (res.ok) {
      // Light sanity read so a 200-with-error-body doesn't count as warmed.
      const body = await res.json().catch(() => null);
      // hasData:false ist KEIN HTTP-Fehler und wird getrennt bilanziert: nach
      // einem Patch-Flip liefern patch-diff und meta-pulse voellig legitim leer,
      // und duenne Regionen (br1, jp1) ohnehin. In denselben Fehlertopf wie
      // Timeouts geworfen, wuerde jede Patch-Woche einen Fehlalarm ausloesen.
      const hasData = Boolean(body) && body.hasData !== false;
      comps = hasData ? '' : ' (hasData:false)';
      return { path, ok: res.ok, hasData, status: res.status, ms, edge, note: comps };
    }
    return { path, ok: false, hasData: null, status: res.status, ms, edge, note: '' };
  } catch (e) {
    return { path, ok: false, hasData: null, status: 0, ms: Date.now() - start, edge: '-', note: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

// Simple fixed-size worker pool over the URL list.
async function run() {
  const urls = buildUrls();
  console.log(`Warming ${urls.length} TFT stats cache keys on ${BASE} (concurrency ${CONCURRENCY})`);
  const queue = [...urls];
  const results = [];
  async function worker() {
    while (queue.length) {
      const path = queue.shift();
      const r = await warmOne(path);
      results.push(r);
      const flag = r.ok ? 'ok ' : 'ERR';
      console.log(`  [${flag}] ${String(r.status).padStart(3)} ${r.edge.padEnd(6)} ${String(r.ms).padStart(5)}ms  ${r.path}${r.note}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const failed = results.filter(r => !r.ok);
  const empty = results.filter(r => r.ok && r.hasData === false);
  const miss = results.filter(r => r.edge === 'MISS').length;
  const hit = results.filter(r => r.edge === 'HIT' || r.edge === 'STALE').length;
  console.log(`\nDone: ${results.length - failed.length}/${results.length} warmed (${miss} populated, ${hit} already warm), ${failed.length} failed, ${empty.length} ohne Daten.`);
  if (failed.length) {
    console.error('Failed keys:');
    for (const f of failed) console.error(`  ${f.status} ${f.path} — ${f.note}`);
  }
  if (empty.length) {
    console.log('Keys ohne Daten (kein Fehler, aber im Blick behalten):');
    for (const f of empty) console.log(`  ${f.path}`);
  }

  // Bis 2026-08-16 schlug nur der Totalausfall fehl. Ein Lauf, bei dem die
  // Haelfte der Keys timeoutet, meldete gruen — genau der Zustand, in dem die
  // Seite kalt bleibt. Jetzt entscheidet die HTTP-Fehlerquote. hasData:false
  // zaehlt bewusst NICHT mit hinein (siehe warmOne): das ist nach jedem
  // Patch-Flip der Normalzustand von patch-diff und meta-pulse.
  const failRate = results.length ? failed.length / results.length : 0;
  if (failRate > MAX_FAIL_RATE) {
    console.error(`Fehlerquote ${(failRate * 100).toFixed(0)} % ueber dem Deckel von ${(MAX_FAIL_RATE * 100).toFixed(0)} % — Lauf gilt als fehlgeschlagen.`);
    process.exitCode = 1;
  }

  // Die globale Quote allein reicht nicht: onetricks stellt 11 der ~45 Keys.
  // Faellt diese Familie KOMPLETT aus, liegt die globale Quote bei ~24 % und
  // der Lauf meldet gruen, waehrend eine ganze Seite kalt bleibt. Deshalb
  // zusaetzlich pro Endpunkt-Familie messen.
  const perFamily = new Map();
  for (const r of results) {
    const family = r.path.startsWith('/api/tft/') ? r.path.slice(9).split('?')[0] : r.path;
    const e = perFamily.get(family) || { total: 0, failed: 0 };
    e.total++;
    if (!r.ok) e.failed++;
    perFamily.set(family, e);
  }
  for (const [family, e] of perFamily) {
    const rate = e.failed / e.total;
    if (rate > MAX_FAIL_RATE) {
      console.error(`Endpunkt-Familie ${family}: ${e.failed}/${e.total} fehlgeschlagen (${(rate * 100).toFixed(0)} %) — ueber dem Deckel, Lauf gilt als fehlgeschlagen.`);
      process.exitCode = 1;
    }
  }
}

run().catch(e => { console.error(e); process.exit(1); });
