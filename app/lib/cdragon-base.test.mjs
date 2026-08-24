// Allowlist des Bild-Proxys. Die Route reicht Bytes von einer fremden Domain
// durch — jede Luecke hier ist ein offener Proxy, kein Schoenheitsfehler.
// Deshalb stehen die Negativfaelle zuerst.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeCdragonUrl, imageContentType, CDRAGON_GAME_BASE, CDRAGON_PLUGINS_BASE, rankEmblemUrl } from './cdragon-base.ts';

const seg = (s) => s.split('/');

test('weist alles zurueck, was aus der Base herausfuehrt', () => {
  const boese = [
    seg('assets/maps/../../../etc/passwd'),
    seg('assets/maps/..'),
    seg('../assets/maps/tft/icons/x.png'),
    ['assets', 'maps', '', 'x.png'],
    ['assets\\maps\\x.png'],
    ['assets/maps/x.png\0.png'],
    [],
  ];
  for (const p of boese) assert.equal(safeCdragonUrl(p), null, `durchgelassen: ${JSON.stringify(p)}`);
});

test('weist fremde Praefixe und Nicht-Bilder zurueck', () => {
  // Die LoL-Rank-Embleme liegen unter latest/plugins/, nicht unter latest/game/
  // — sie bleiben bewusst direkt und duerfen hier NICHT durchkommen.
  assert.equal(safeCdragonUrl(seg('plugins/rcp-fe-lol-static-assets/global/default/x.png')), null);
  assert.equal(safeCdragonUrl(seg('assets/maps/tft/data.json')), null);
  assert.equal(safeCdragonUrl(seg('assets/maps/tft/icon.png.txt')), null);
  // Die 10 "none"-Eintraege aus dem Bundle.
  assert.equal(safeCdragonUrl(['none']), null);
});

test('laesst die echten Bundle-Praefixe durch', () => {
  const echt = [
    'assets/maps/tft/icons/items/hexcore/tft_item_bluebuff.tft_set13.png',
    'assets/characters/tft17_aatrox/hud/tft17_aatrox_square.tft_set17.png',
    'assets/ux/traiticons/trait_icon_17_doomer.png',
  ];
  for (const p of echt) {
    assert.equal(safeCdragonUrl(seg(p)), CDRAGON_GAME_BASE + p);
  }
});

test('Content-Type kommt aus der Endung, nicht von upstream', () => {
  assert.equal(imageContentType('a/b.png'), 'image/png');
  assert.equal(imageContentType('a/b.JPG'), 'image/jpeg');
  assert.equal(imageContentType('a/b.webp'), 'image/webp');
  assert.equal(imageContentType('a/b.json'), null);
});

// Die Rank-Embleme sind der einzige Direktzugriff, der nach dem Bild-Proxy
// uebrig ist. Der Test haelt beide Enden fest: die URL muss unter der
// Plugins-Base liegen UND von der Allowlist abgewiesen werden. Wandert sie
// jemals unter latest/game/, faellt hier auf, dass sie dann durch den Proxy
// gehoert statt daran vorbei.
test('rankEmblemUrl liegt ausserhalb der Proxy-Allowlist', () => {
  const url = rankEmblemUrl('DIAMOND');
  assert.ok(url.startsWith(CDRAGON_PLUGINS_BASE));
  assert.match(url, /emblem-diamond.png$/);
  assert.equal(safeCdragonUrl(url.slice(CDRAGON_PLUGINS_BASE.length).split('/')), null);
  assert.equal(rankEmblemUrl(null), null);
  assert.equal(rankEmblemUrl(undefined), null);
});
