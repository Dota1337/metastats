/**
 * Route-Spiegel (app/lib/route-mirror.mjs): Box und Route muessen fuer dieselbe
 * Anfrage denselben Schluessel bilden, sonst findet die Route nie eine Datei und
 * rechnet still live. Ausserdem: nur passende, frische, nicht leere Dateien.
 *
 * Lauf: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ROUTE_MIRRORS, ROUTE_MIRROR_GROUPS, isValidRouteMirror, routeMirrorFetchPath, routeMirrorIndexPath,
  routeMirrorKey, routeMirrorKeys, routeMirrorNames, routeMirrorPath, routeMirrorVariants,
} from './route-mirror.mjs';
import { ACTIVE_REGIONS } from '../../scripts/lib/active-regions.mjs';

const NOW = Date.parse('2026-10-18T14:00:00Z');
const ago = ms => new Date(NOW - ms).toISOString();

test('Varianten: genau die Ansichten der Seiten', () => {
  assert.equal(routeMirrorVariants('rising', ACTIVE_REGIONS).length, 3 * (1 + ACTIVE_REGIONS.length));
  assert.equal(routeMirrorVariants('leaderboard', ACTIVE_REGIONS).length, 3 + ACTIVE_REGIONS.length);
  assert.equal(routeMirrorVariants('regions', ACTIVE_REGIONS).length, 12);
  assert.deepEqual(routeMirrorVariants('tournaments', ACTIVE_REGIONS), [{}]);
  assert.deepEqual(routeMirrorNames('ligen'), ['tournaments', 'standings']);
  for (const g of ROUTE_MIRROR_GROUPS) assert.ok(routeMirrorNames(g).length > 0, g);
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

const RISING = { v: 1, name: 'rising', key: 'days-1__region-all', builtAt: ago(60_000), set: 18,
  body: { hasData: true, days: 1, region: 'all', endDay: '2026-10-18', players: [{ puuid: 'p' }] } };

test('Pruefung: passende frische Datei gilt, alles andere nicht', () => {
  const ok = (snap, name = 'rising', key = 'days-1__region-all', set = 18) => isValidRouteMirror(snap, name, key, { set, now: NOW });
  assert.equal(ok(RISING), true);
  assert.equal(ok(RISING, 'rising', 'days-3__region-all'), false); // anderer Schluessel
  assert.equal(ok({ ...RISING, set: 17 }), false); // anderes Set
  assert.equal(ok(RISING, 'rising', 'days-1__region-all', 19), false);
  assert.equal(ok({ ...RISING, builtAt: ago(37 * 3600_000) }), false); // zu alt
  assert.equal(ok({ ...RISING, builtAt: new Date(NOW + 10 * 60_000).toISOString() }), false); // Zukunft
  assert.equal(ok({ ...RISING, body: { ...RISING.body, players: [] } }), false); // leer
  assert.equal(ok({ ...RISING, body: { ...RISING.body, days: 3 } }), false); // Inhalt passt nicht
  for (const bad of [null, undefined, 'x', 42, [], {}, { ...RISING, v: 2 }, { ...RISING, body: null }, { ...RISING, builtAt: 'kaputt' }]) {
    assert.equal(ok(bad), false);
  }

  const lb = { v: 1, name: 'leaderboard', key: 'region-all__tier-ALL__page-1', builtAt: ago(20 * 60_000),
    body: { region: 'all', tier: 'ALL', page: 1, players: [{ puuid: 'p' }] } };
  assert.equal(isValidRouteMirror(lb, 'leaderboard', lb.key, { set: 18, now: NOW }), true);
  assert.equal(isValidRouteMirror({ ...lb, builtAt: ago(26 * 60_000) }, 'leaderboard', lb.key, { set: 18, now: NOW }), false);

  const tn = { v: 1, name: 'tournaments', key: 'default', builtAt: ago(60_000),
    body: { tournaments: [{ league: 'LEC' }], byLeague: {}, sortedLeagues: [] } };
  assert.equal(isValidRouteMirror(tn, 'tournaments', 'default', { set: null, now: NOW }), true); // kein TFT-Set noetig
  assert.equal(isValidRouteMirror({ ...tn, body: { ...tn.body, tournaments: [] } }, 'tournaments', 'default', { now: NOW }), false);
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
