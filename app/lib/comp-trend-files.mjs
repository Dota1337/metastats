// Vorberechneter Comp-Verlauf (seit 22.11.2026).
//
// Die Abfrage get_tft_comp_daily_trend (Migration 0043) brauchte kalt rund
// 13 s, die Seite wartet 8 s — der Verlauf auf Comp-Detail und Comp-Vergleich
// blieb deshalb ueber den ganzen Tag immer wieder leer. Die Box rechnet ihn
// jetzt jede Nacht vor (scripts/publish-comp-trends.mjs) und legt eine Datei
// je Region-Gruppe x Rang-Gruppe in den Blob-Speicher. Die Route
// (app/api/tft/comps/trend/route.ts) liest die Datei und faellt nur dann auf
// die Abfrage zurueck, wenn die Datei das gewuenschte Fenster nicht abdeckt.
//
// Damit die Datei-Antwort exakt der Abfrage entspricht:
//   - eine Datei enthaelt ALLE Comps mit mindestens einer Tageszeile im
//     Fenster, ohne Spiele-Schwelle. Fehlt ein Slug, hat er im Fenster keine
//     Zeile — die Summe bleibt exakt, es gibt keine Teilsumme.
//   - trendPoints rechnet wie die Abfrage: Fenster (Endtag - days, Endtag],
//     Summe je Tag ueber die Slugs (jeder Slug einmal, wie `= any(...)`),
//     danach games >= minGamesPerDay, aufsteigend nach Tag.
//   - die aufgeloesten Regionen/Raenge stehen in der Datei; die Route nutzt sie
//     nur, wenn sie gleich expandRegions/expandBuckets sind (Paritaets-Test in
//     comp-trend-files.test.mjs).
//
// Reines JS ohne Importe: Route (Vercel) und Box-Skript nutzen dieselbe Datei.
// Steht deshalb im Pfad-Filter von .github/workflows/deploy-hetzner.yml.

export const COMP_TREND_PREFIX = 'tft/comp-trend/v1';
export const COMP_TREND_INDEX_KEY = `${COMP_TREND_PREFIX}/index.json`;
/** Tage je Datei: 30-Tage-Ansicht plus Luft fuer einen Endtag (&end=) bis 5 Tage zurueck. */
export const COMP_TREND_WINDOW_DAYS = 35;
/** Aelter darf eine Datei als Notantwort (Abfrage gescheitert) nicht sein. */
export const COMP_TREND_MAX_STALE_DAYS = 7;
export const COMP_TREND_FORMAT = 1;
/** So viele Endtage bleiben im Blob-Speicher liegen (Seiten mit &end= aus den Vortagen). */
export const COMP_TREND_KEEP_DAYS = 10;

// Region-Auswahl der Comp-Detailseite (app/tft/comps/[slug]/CompDetailClient.tsx).
export const TREND_REGION_GROUPS = ['all', 'euw1', 'kr', 'na1', 'eun1', 'br1', 'jp1'];
// Rang-Auswahl (TIER_BUCKETS, app/lib/tft-tier-bucket.ts).
export const TREND_BUCKET_GROUPS = [
  'all', 'challenger', 'grandmaster_plus', 'master_plus', 'diamond_plus', 'emerald_plus', 'platinum_plus',
];

// = REGION_GROUPS.all (app/lib/tft-supabase-reader.ts, Quelle app/lib/active-regions.ts).
const ALL_REGIONS = [
  'euw1', 'eun1', 'tr1', 'ru', 'me1',
  'na1', 'br1', 'la1', 'la2',
  'kr', 'jp1',
  'oc1', 'sg2', 'tw2', 'vn2',
];
// = ALL_BUCKETS (ebd.), von unten nach oben.
export const TREND_ALL_TIERS = [
  'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'master', 'grandmaster', 'challenger',
];

/** Einzelregionen und Einzelraenge einer Gruppe — dieselben wie expandRegions/expandBuckets. */
export function trendGroupMembers(region, bucket) {
  if (!TREND_REGION_GROUPS.includes(region) || !TREND_BUCKET_GROUPS.includes(bucket)) return null;
  const regions = region === 'all' ? [...ALL_REGIONS] : [region];
  let buckets;
  if (bucket === 'all') buckets = [...TREND_ALL_TIERS];
  else if (bucket.endsWith('_plus')) {
    const floor = bucket.slice(0, -'_plus'.length);
    const i = TREND_ALL_TIERS.indexOf(floor);
    if (i < 0) return null;
    buckets = TREND_ALL_TIERS.slice(i);
  } else buckets = [bucket];
  return { regions, buckets };
}

/** Alle 49 Gruppen in fester Reihenfolge. */
export function trendGroups() {
  const out = [];
  for (const region of TREND_REGION_GROUPS) {
    for (const bucket of TREND_BUCKET_GROUPS) out.push({ region, bucket, ...trendGroupMembers(region, bucket) });
  }
  return out;
}

export function trendGroupId(region, bucket) {
  return `${region}__${bucket}`;
}

/**
 * Pfad mit Endtag: jede Nacht neue Dateien statt ueberschriebener. Das Blob-CDN
 * haelt ueberschriebene Dateien trotz kurzer max-age teils Stunden (gemessen
 * 22.11.2026: Manifest mit Age 14.483 s) — die Route holt deshalb genau die
 * Datei zu ihrem Endtag.
 */
export function trendFileKey(endDay, region, bucket) {
  return `${COMP_TREND_PREFIX}/${endDay}/${trendGroupId(region, bucket)}.json`;
}

function sameSet(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

/**
 * Gruppe zu den aufgeloesten Listen der Route (expandRegions/expandBuckets),
 * sonst null (z. B. Westen/Asien, pro_pool, mehrere Regionen per Komma).
 */
export function trendGroupFor(regions, buckets) {
  for (const g of trendGroups()) {
    if (sameSet(g.regions, regions) && sameSet(g.buckets, buckets)) return { region: g.region, bucket: g.bucket };
  }
  return null;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isTrendDay(s) {
  if (typeof s !== 'string' || !DAY_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

export function addDays(day, n) {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Tage von `first` bis `last` einschliesslich. */
export function dayRange(first, last) {
  const out = [];
  for (let d = first; d <= last; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Tageszeile: [region, bucket, cluster_key, games, sum_placement, top4, top1].
 * @param {{ region: string, bucket: string, endDay: string, days: string[],
 *   rowsByDay: Map<string, any[][]>, builtAt?: string }} p
 */
export function buildTrendFile({ region, bucket, endDay, days, rowsByDay, builtAt = new Date().toISOString() }) {
  const members = trendGroupMembers(region, bucket);
  if (!members) throw new Error(`unbekannte Gruppe ${region}/${bucket}`);
  if (!days.length || days[days.length - 1] !== endDay) throw new Error('Tage enden nicht am Endtag');
  const rs = new Set(members.regions);
  const bs = new Set(members.buckets);
  // Ohne Prototyp: ein cluster_key "__proto__" waere sonst kein eigener Schluessel.
  const comps = Object.create(null);
  days.forEach((day, di) => {
    const acc = new Map();
    for (const r of rowsByDay.get(day) || []) {
      if (!rs.has(r[0]) || !bs.has(r[1])) continue;
      let a = acc.get(r[2]);
      if (!a) { a = [0, 0, 0, 0]; acc.set(r[2], a); }
      a[0] += Number(r[3]) || 0;
      a[1] += Number(r[4]) || 0;
      a[2] += Number(r[5]) || 0;
      a[3] += Number(r[6]) || 0;
    }
    for (const [key, a] of acc) (comps[key] ||= []).push(di, a[0], a[1], a[2], a[3]);
  });
  return {
    v: COMP_TREND_FORMAT,
    region,
    bucket,
    regions: members.regions,
    buckets: members.buckets,
    firstDay: days[0],
    endDay,
    days,
    builtAt,
    comps,
  };
}

/** Taugt die Datei fuer diese Gruppe (Format, Listen, Tage)? */
export function trendFileValid(file, regions, buckets) {
  return Boolean(file) && file.v === COMP_TREND_FORMAT
    && isTrendDay(file.firstDay) && isTrendDay(file.endDay)
    && Array.isArray(file.days) && file.days[0] === file.firstDay && file.days[file.days.length - 1] === file.endDay
    && file.comps && typeof file.comps === 'object'
    && sameSet(file.regions, regions) && sameSet(file.buckets, buckets);
}

/** Deckt die Datei das ganze Fenster (endDay - days, endDay] ab? */
export function trendFileCovers(file, days, endDay) {
  if (!isTrendDay(endDay) || !Number.isInteger(days) || days < 1) return false;
  return file.firstDay <= addDays(endDay, 1 - days) && file.endDay >= endDay;
}

/** Notantwort erlaubt: Datei hoechstens COMP_TREND_MAX_STALE_DAYS hinter dem Endtag. */
export function trendFileUsableStale(file, endDay) {
  return isTrendDay(endDay) && file.endDay >= addDays(endDay, -COMP_TREND_MAX_STALE_DAYS);
}

/**
 * Tagespunkte wie get_tft_comp_daily_trend, aus der Datei.
 * @returns {{ day: string, games: number, sum_placement: number, top4: number, top1: number }[]}
 */
export function trendPoints(file, { slugs, days, endDay, minGamesPerDay = 0 }) {
  const from = addDays(endDay, -days); // ausschliesslich, wie `day > current_date - p_days`
  const perDay = new Map();
  for (const slug of new Set(slugs)) {
    if (!Object.hasOwn(file.comps, slug)) continue;
    const a = file.comps[slug];
    for (let i = 0; i + 4 < a.length; i += 5) {
      let v = perDay.get(a[i]);
      if (!v) { v = [0, 0, 0, 0]; perDay.set(a[i], v); }
      v[0] += a[i + 1];
      v[1] += a[i + 2];
      v[2] += a[i + 3];
      v[3] += a[i + 4];
    }
  }
  const out = [];
  for (const di of [...perDay.keys()].sort((x, y) => x - y)) {
    const day = file.days[di];
    if (!day || !(day > from && day <= endDay)) continue;
    const v = perDay.get(di);
    if (v[0] < minGamesPerDay) continue;
    out.push({ day, games: v[0], sum_placement: v[1], top4: v[2], top1: v[3] });
  }
  return out;
}
