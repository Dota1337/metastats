/**
 * Route-Spiegel (app/lib/route-mirror.mjs): Box und Route muessen fuer dieselbe
 * Anfrage denselben Schluessel bilden, sonst findet die Route nie eine Datei und
 * rechnet still live. Ausserdem: nur passende, frische, nicht leere Dateien.
 *
 * Lauf: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  ROUTE_MIRRORS, ROUTE_MIRROR_GROUPS, isValidRouteMirror, routeMirrorFetchPath, routeMirrorIndexPath,
  routeMirrorKey, routeMirrorKeys, routeMirrorNames, routeMirrorPath, routeMirrorVariants,
} from './route-mirror.mjs';
import { ACTIVE_REGIONS } from '../../scripts/lib/active-regions.mjs';

const NOW = Date.parse('2026-10-18T14:00:00Z');
const ago = ms => new Date(NOW - ms).toISOString();
// Bewusst keine echte Set-Nummer (check-drift: keine Set-Literale ausser CURRENT_SET).
const S = 42;

test('Varianten: genau die Ansichten der Seiten', () => {
  assert.equal(routeMirrorVariants('rising', ACTIVE_REGIONS).length, 3 * (1 + ACTIVE_REGIONS.length));
  assert.equal(routeMirrorVariants('leaderboard', ACTIVE_REGIONS).length, 3 + ACTIVE_REGIONS.length);
  assert.equal(routeMirrorVariants('regions', ACTIVE_REGIONS).length, 12);
  assert.deepEqual(routeMirrorVariants('tournaments', ACTIVE_REGIONS), [{}]);
  assert.deepEqual(routeMirrorNames('ligen'), ['tournaments', 'standings']);
  // Startdaten der Uebersichtsseiten: Marktwert je Region, sonst eine Ansicht.
  assert.equal(routeMirrorVariants('tftMarktwert', ACTIVE_REGIONS).length, ACTIVE_REGIONS.length);
  assert.equal(routeMirrorVariants('tftMarktwertSparks', ACTIVE_REGIONS).length, ACTIVE_REGIONS.length);
  for (const n of ['lolMarktwert', 'tftTournaments', 'lolHome']) assert.deepEqual(routeMirrorVariants(n, ACTIVE_REGIONS), [{}], n);
  assert.deepEqual(routeMirrorVariants('lolLeaderboard', ACTIVE_REGIONS), [{ region: 'euw1', tier: 'CHALLENGER', page: '1' }]);
  assert.deepEqual(routeMirrorNames('mv-pages'), ['tftMarktwert', 'tftMarktwertSparks']);
  assert.deepEqual(routeMirrorNames('slow-pages'), ['lolMarktwert', 'tftTournaments', 'lolHome']);
  assert.deepEqual(routeMirrorNames('lol-leaderboard'), ['lolLeaderboard']);
  for (const g of ROUTE_MIRROR_GROUPS) assert.ok(routeMirrorNames(g).length > 0, g);
  for (const n of Object.keys(ROUTE_MIRRORS)) assert.ok(ROUTE_MIRROR_GROUPS.includes(ROUTE_MIRRORS[n].group), n);
});

test('Schluessel: Startdaten-Spiegel nur fuer genau die Standardansicht', () => {
  // So fragen die Seiten (page-start-queries.ts → Client-Fetch).
  const page = (s) => new URLSearchParams(s);
  assert.equal(routeMirrorKey('tftMarktwert', page('region=euw1&limit=100')), 'region-euw1');
  assert.equal(routeMirrorKey('tftMarktwert', page('region=KR&limit=100')), 'region-kr');
  assert.equal(routeMirrorKey('tftMarktwert', page('region=euw1&limit=100&tier=CHALLENGER')), null); // Rang-Filter
  assert.equal(routeMirrorKey('tftMarktwert', page('region=euw1&limit=50')), null); // andere Laenge
  assert.equal(routeMirrorKey('tftMarktwertSparks', page('region=euw1&limit=100&days=14')), 'region-euw1');
  assert.equal(routeMirrorKey('tftMarktwertSparks', page('region=euw1&limit=100&days=30')), null);
  assert.equal(routeMirrorKey('lolMarktwert', page('region=all&tier=all')), 'default');
  assert.equal(routeMirrorKey('lolMarktwert', page('')), 'default');
  assert.equal(routeMirrorKey('lolMarktwert', page('region=euw1&tier=all')), null);
  assert.equal(routeMirrorKey('lolMarktwert', page('region=all&tier=ALL')), null); // feste Werte ohne Umformung
  assert.equal(routeMirrorKey('tftTournaments', page('limit=200')), 'default');
  for (const f of ['slug=x', 'status=live', 'region=EU', 'tier=S', 'set=18']) {
    assert.equal(routeMirrorKey('tftTournaments', page(`limit=200&${f}`)), null, f);
  }
  assert.equal(routeMirrorKey('lolHome', page('')), 'default');
  assert.equal(routeMirrorKey('lolLeaderboard', page('tier=CHALLENGER&region=euw1&page=1')), 'region-euw1__tier-CHALLENGER__page-1');
  assert.equal(routeMirrorKey('lolLeaderboard', page('tier=challenger&region=EUW1&page=1')), 'region-euw1__tier-CHALLENGER__page-1');
  assert.equal(routeMirrorKey('lolLeaderboard', page('tier=CHALLENGER&region=euw1&page=1&search=x')), null);
  assert.equal(routeMirrorKey('lolLeaderboard', page('tier=DIAMOND&region=euw1&division=I&page=1')), null);
  // Andere Ansichten bilden zwar einen Schluessel, liegen aber nicht im Bestand.
  assert.equal(routeMirrorKeys('lolLeaderboard', ACTIVE_REGIONS).has(routeMirrorKey('lolLeaderboard', page('tier=CHALLENGER&region=kr&page=1'))), false);
  assert.equal(routeMirrorFetchPath('tftMarktwert', { region: 'euw1' }), '/api/tft/marktwert/leaderboard?region=euw1&limit=100');
  assert.equal(routeMirrorFetchPath('tftMarktwertSparks', { region: 'euw1' }), '/api/tft/marktwert/sparklines?region=euw1&limit=100&days=14');
});

test('Schluessel: Box-Variante und Seiten-Anfrage treffen dieselbe Datei', () => {
  // So fragt die Seite (rising/page.tsx, leaderboard/page.tsx, regions/page.tsx).
  const page = (s) => new URLSearchParams(s);
  assert.equal(routeMirrorKey('rising', page('days=1&region=all')), routeMirrorKey('rising', { days: '1', region: 'all' }));
  assert.equal(routeMirrorKey('leaderboard', page('region=all&tier=ALL&page=1')), 'region-all__tier-ALL__page-1');
  assert.equal(routeMirrorKey('regions', page('days=7&bucket=master_plus&min=80')), 'days-7__bucket-master_plus__min-80');
  // Fremde Parameter zaehlen nicht, Normalisierung wie in der Route.
  assert.equal(routeMirrorKey('leaderboard', page('region=EUW1&tier=all&page=01&_cb=9')), 'region-euw1__tier-ALL__page-1');
  // Pflicht-Parameter fehlt, verbotener Parameter, abweichender fester Wert → keine Datei.
  assert.equal(routeMirrorKey('regions', page('days=7&min=80')), null);
  assert.equal(routeMirrorKey('regions', page('days=7&bucket=diamond&min=80&end=2026-10-10')), null);
  assert.equal(routeMirrorKey('regions', page('days=7&bucket=diamond&min=80&patch=current')), null);
  assert.equal(routeMirrorKey('regions', page('days=7&bucket=diamond&min=80&patch=any')), 'days-7__bucket-diamond__min-80');
  assert.equal(routeMirrorKey('standings', page('league=lec')), null);
  assert.equal(routeMirrorKey('tournaments', page('filter=live&league=lec')), 'default');
  // Nichts landet ungeprueft in einem Pfad.
  assert.equal(routeMirrorKey('leaderboard', page('region=../x')), null);
  assert.throws(() => routeMirrorPath('rising', '../x'));
  assert.equal(routeMirrorPath('rising', 'days-1__region-all'), 'mirror/rising/days-1__region-all.json');
  assert.equal(routeMirrorIndexPath('leaderboard'), 'mirror/leaderboard/index.json');
});

test('Schluessel: jede Variante hat einen eigenen, gueltigen Schluessel und Abrufpfad', () => {
  for (const name of Object.keys(ROUTE_MIRRORS)) {
    const variants = routeMirrorVariants(name, ACTIVE_REGIONS);
    const keys = routeMirrorKeys(name, ACTIVE_REGIONS);
    assert.equal(keys.size, variants.length, name);
    for (const v of variants) {
      assert.ok(routeMirrorPath(name, routeMirrorKey(name, v)), name);
      assert.ok(routeMirrorFetchPath(name, v).startsWith(ROUTE_MIRRORS[name].api), name);
    }
  }
  assert.equal(routeMirrorFetchPath('tournaments', {}), '/api/tournaments?window=full');
});

const RISING = { v: 1, name: 'rising', key: 'days-1__region-all', builtAt: ago(60_000), set: S,
  body: { hasData: true, days: 1, region: 'all', endDay: '2026-10-18', players: [{ puuid: 'p' }] } };

test('Pruefung: passende frische Datei gilt, alles andere nicht', () => {
  const ok = (snap, name = 'rising', key = 'days-1__region-all', set = S) => isValidRouteMirror(snap, name, key, { set, now: NOW });
  assert.equal(ok(RISING), true);
  assert.equal(ok(RISING, 'rising', 'days-3__region-all'), false); // anderer Schluessel
  assert.equal(ok({ ...RISING, set: S - 1 }), false); // anderes Set
  assert.equal(ok(RISING, 'rising', 'days-1__region-all', S + 1), false);
  assert.equal(ok({ ...RISING, builtAt: ago(37 * 3600_000) }), false); // zu alt
  assert.equal(ok({ ...RISING, builtAt: new Date(NOW + 10 * 60_000).toISOString() }), false); // Zukunft
  assert.equal(ok({ ...RISING, body: { ...RISING.body, players: [] } }), false); // leer
  assert.equal(ok({ ...RISING, body: { ...RISING.body, days: 3 } }), false); // Inhalt passt nicht
  for (const bad of [null, undefined, 'x', 42, [], {}, { ...RISING, v: 2 }, { ...RISING, body: null }, { ...RISING, builtAt: 'kaputt' }]) {
    assert.equal(ok(bad), false);
  }

  const lb = { v: 1, name: 'leaderboard', key: 'region-all__tier-ALL__page-1', builtAt: ago(20 * 60_000),
    body: { region: 'all', tier: 'ALL', page: 1, players: [{ puuid: 'p' }] } };
  assert.equal(isValidRouteMirror(lb, 'leaderboard', lb.key, { set: S, now: NOW }), true);
  assert.equal(isValidRouteMirror({ ...lb, builtAt: ago(26 * 60_000) }, 'leaderboard', lb.key, { set: S, now: NOW }), false);

  const tn = { v: 1, name: 'tournaments', key: 'default', builtAt: ago(60_000),
    body: { tournaments: [{ league: 'LEC' }], byLeague: {}, sortedLeagues: [] } };
  assert.equal(isValidRouteMirror(tn, 'tournaments', 'default', { set: null, now: NOW }), true); // kein TFT-Set noetig
  assert.equal(isValidRouteMirror({ ...tn, body: { ...tn.body, tournaments: [] } }, 'tournaments', 'default', { now: NOW }), false);
});

test('Pruefung: Startdaten-Spiegel', () => {
  const ok = (snap, name, key, set = null) => isValidRouteMirror(snap, name, key, { set, now: NOW });
  const snap = (name, key, body, extra = {}) => ({ v: 1, name, key, builtAt: ago(60_000), body, ...extra });

  const mv = snap('tftMarktwert', 'region-euw1', { region: 'euw1', limit: 100, players: [{ puuid: 'p' }] }, { set: S });
  assert.equal(ok(mv, 'tftMarktwert', 'region-euw1', S), true);
  assert.equal(ok(mv, 'tftMarktwert', 'region-euw1', S + 1), false); // anderes Set
  assert.equal(ok({ ...mv, body: { ...mv.body, region: 'kr' } }, 'tftMarktwert', 'region-euw1', S), false);
  assert.equal(ok({ ...mv, body: { ...mv.body, limit: 50 } }, 'tftMarktwert', 'region-euw1', S), false);
  assert.equal(ok({ ...mv, body: { ...mv.body, players: [] } }, 'tftMarktwert', 'region-euw1', S), false);
  assert.equal(ok({ ...mv, builtAt: ago(27 * 3600_000) }, 'tftMarktwert', 'region-euw1', S), false);

  const sp = snap('tftMarktwertSparks', 'region-euw1', { region: 'euw1', series: { p: [1, 2] } }, { set: S });
  assert.equal(ok(sp, 'tftMarktwertSparks', 'region-euw1', S), true);
  assert.equal(ok({ ...sp, body: { region: 'euw1', series: {} } }, 'tftMarktwertSparks', 'region-euw1', S), false);

  const lm = snap('lolMarktwert', 'default', { players: [{ id: 1 }], tierStats: {}, filter: { region: 'all', tier: 'all' } });
  assert.equal(ok(lm, 'lolMarktwert', 'default'), true);
  assert.equal(ok({ ...lm, body: { ...lm.body, filter: { region: 'euw1', tier: 'all' } } }, 'lolMarktwert', 'default'), false);
  assert.equal(ok({ ...lm, body: { ...lm.body, tierStats: null } }, 'lolMarktwert', 'default'), false);

  const tt = snap('tftTournaments', 'default', { tournaments: [{ slug: 'x' }] });
  assert.equal(ok(tt, 'tftTournaments', 'default'), true);
  assert.equal(ok({ ...tt, builtAt: ago(47 * 3600_000) }, 'tftTournaments', 'default'), true);
  assert.equal(ok({ ...tt, builtAt: ago(49 * 3600_000) }, 'tftTournaments', 'default'), false);

  const lh = snap('lolHome', 'default', { stats: { totalTeams: 5, totalProPlayers: 50 }, topChampions: [] });
  assert.equal(ok(lh, 'lolHome', 'default'), true);
  assert.equal(ok({ ...lh, body: { ...lh.body, stats: { totalTeams: 0, totalProPlayers: 50 } } }, 'lolHome', 'default'), false);

  const key = 'region-euw1__tier-CHALLENGER__page-1';
  const named = n => Array.from({ length: 100 }, (_, i) => ({ summonerName: i < n ? `p${i}` : '' }));
  const lb = snap('lolLeaderboard', key, { source: 'riot', region: 'euw1', tier: 'CHALLENGER', page: 1, entries: named(100) });
  assert.equal(ok(lb, 'lolLeaderboard', key), true);
  assert.equal(ok({ ...lb, body: { ...lb.body, entries: named(95) } }, 'lolLeaderboard', key), true);
  assert.equal(ok({ ...lb, body: { ...lb.body, entries: named(94) } }, 'lolLeaderboard', key), false); // Namen fehlen
  assert.equal(ok({ ...lb, body: { ...lb.body, source: 'fallback' } }, 'lolLeaderboard', key), false);
  assert.equal(ok({ ...lb, body: { ...lb.body, tier: 'GRANDMASTER' } }, 'lolLeaderboard', key), false);
  assert.equal(ok({ ...lb, body: { ...lb.body, entries: [] } }, 'lolLeaderboard', key), false);
});

test('Leser: keine Route benutzt den Seiten-Leser (ohne Publisher-Pruefung)', () => {
  // readRouteMirrorForPage prueft die Publisher-Kopfzeile nicht. In einer Route
  // bekaeme die Box ihre eigene alte Datei zurueck und legte sie eingefroren ab.
  const apiDir = new URL('../api/', import.meta.url);
  const routes = readdirSync(apiDir, { recursive: true }).map(String).filter(p => /(^|[\\/])route\.ts$/.test(p));
  assert.ok(routes.length > 50, `nur ${routes.length} Routen gefunden`);
  const offenders = routes.filter(p => readFileSync(new URL(p.replace(/\\/g, '/'), apiDir), 'utf8').includes('readRouteMirrorForPage'));
  assert.deepEqual(offenders, []);
});

test('Vertraege: jeder Spiegel hat einen Frische-Vertrag auf sein index.json', () => {
  const contracts = JSON.parse(readFileSync(new URL('../../infra/contracts.json', import.meta.url), 'utf8'));
  const list = contracts.contracts || contracts;
  for (const name of Object.keys(ROUTE_MIRRORS)) {
    const c = list.find(x => x.id === `mirror/${name}/index-frische`);
    assert.ok(c, `Vertrag mirror/${name}/index-frische fehlt`);
    assert.ok(String(c.url).endsWith(`/${routeMirrorIndexPath(name)}`), `${name}: URL`);
  }
});
