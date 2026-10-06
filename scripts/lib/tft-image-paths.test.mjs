// Haelt die Pfadregel der Bild-Kopie und die des Bild-Weiterleiters gleich.
// Laufen die beiden auseinander, kopiert der Job Bilder, die die Route nie
// ausliefert — oder die Route sucht Bilder, die der Job nie ablegt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  safeCdragonUrl,
  CDRAGON_GAME_BASE as TS_BASE,
  CDRAGON_PATH_PREFIXES as TS_PREFIXES,
  imageContentType as tsContentType,
} from '../../app/lib/cdragon-base.ts';
import {
  mirrorKeyFor,
  collectImagePaths,
  looksLikeCompleteImage,
  CDRAGON_GAME_BASE,
  CDRAGON_PATH_PREFIXES,
  imageContentType,
} from './tft-image-paths.mjs';

const PUBLIC_DIR = resolve(fileURLToPath(import.meta.url), '../../../public');

function routeKey(path) {
  const url = safeCdragonUrl(path.split('/'));
  return url ? url.slice(TS_BASE.length) : null;
}

test('Base und Praefixe sind in beiden Dateien gleich', () => {
  assert.equal(CDRAGON_GAME_BASE, TS_BASE);
  assert.deepEqual(CDRAGON_PATH_PREFIXES, [...TS_PREFIXES]);
});

test('Grenzfaelle werden gleich entschieden', () => {
  const cases = [
    'assets/maps/tft/icons/augments/hexcore/teamup_reunion_ii.png',
    'assets/characters/tft17_ahri/hud/tft17_ahri_square.tft_set17.png',
    'assets/ux/traiticons/trait_icon_17_stargazer.png',
    'assets/ux/foo.PNG',
    'assets/ux/foo.webp',
    'assets/ux/foo.jpg',
    'assets/ux/foo.gif',
    'assets/ux/foo',
    'assets/loadouts/companions/foo.png',
    'assets/maps/../../plugins/x.png',
    'assets/maps/./x.png',
    'assets/maps//x.png',
    'assets/maps/x\\y.png',
    'assets/maps/x\0.png',
    'assets/maps/x.png?y=1',
    'assets/maps/x.png#y',
    'assets/maps/a b.png',
    'assets/maps/%2e%2e/x.png',
    '/assets/maps/x.png',
    'https://evil.example/assets/maps/x.png',
    '',
  ];
  for (const c of cases) {
    const route = routeKey(c);
    const mirror = mirrorKeyFor(c);
    // Die Kopie darf strenger sein (umgeschriebene Pfade), nie lockerer.
    if (mirror !== null) assert.equal(mirror, route, `Pfad ${JSON.stringify(c)}`);
    if (route === null) assert.equal(mirror, null, `Pfad ${JSON.stringify(c)}`);
  }
  for (const ext of ['png', 'PNG', 'jpg', 'jpeg', 'webp', 'gif', '']) {
    assert.equal(imageContentType(`x.${ext}`), tsContentType(`x.${ext}`));
  }
});

test('jeder gesammelte Pfad wird von der Route unter demselben Namen ausgeliefert', () => {
  const { paths, current } = collectImagePaths(PUBLIC_DIR);
  assert.ok(paths.length > 1000, `nur ${paths.length} Pfade gefunden`);
  assert.ok(current.size > 500, `nur ${current.size} Pfade im aktuellen Bundle`);
  assert.equal(new Set(paths).size, paths.length, 'doppelte Pfade');
  for (const p of paths) assert.equal(routeKey(p), p, p);
  // Das aktuelle Bundle steht vorne.
  const firstNonCurrent = paths.findIndex((p) => !current.has(p));
  if (firstNonCurrent !== -1) {
    assert.ok(paths.slice(firstNonCurrent).every((p) => !current.has(p)));
  }
});

test('nur vollstaendige Bilder gelten als Bild', () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(40),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from('IEND'),
    Buffer.from([0xae, 0x42, 0x60, 0x82]),
  ]);
  assert.equal(looksLikeCompleteImage('a.png', png), true);
  assert.equal(looksLikeCompleteImage('a.png', png.subarray(0, png.length - 6)), false, 'abgeschnitten');
  assert.equal(looksLikeCompleteImage('a.png', Buffer.from('<html>error code: 522</html>'.padEnd(80))), false, 'Fehlerseite');
  assert.equal(looksLikeCompleteImage('a.png', Buffer.alloc(0)), false);
  assert.equal(looksLikeCompleteImage('a.gif', png), false);
});
