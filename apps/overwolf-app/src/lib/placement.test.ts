import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rectFromGame, clampPos, matchupFrac, toPixels, toFrac, overlayBox, MATCHUP_DEFAULT, MATCHUP_WIDTH } from './placement.ts';

test('rectFromGame: 16:9-Flaeche, mittig, Balken bei anderen Formaten', () => {
  assert.deepEqual(rectFromGame(1920, 1080), { ox: 0, oy: 0, bw: 1920, bh: 1080 });
  assert.deepEqual(rectFromGame(2560, 1080), { ox: 320, oy: 0, bw: 1920, bh: 1080 });
  assert.deepEqual(rectFromGame(1920, 1200), { ox: 0, oy: 60, bw: 1920, bh: 1080 });
  for (const [w, h] of [[0, 1080], [1920, 0], [null, 1080], [undefined, undefined], [NaN, 1080]] as const) {
    assert.equal(rectFromGame(w, h), null);
  }
});

test('Standardlage: rechts vom Spielfeld, links der Spielerliste, oben', () => {
  assert.ok(MATCHUP_DEFAULT.x >= 0.75, 'nicht ueber dem Spielfeld');
  assert.ok(MATCHUP_DEFAULT.x + MATCHUP_WIDTH <= 0.87, 'nicht ueber der Spielerliste');
  assert.ok(MATCHUP_DEFAULT.y <= 0.2);
  assert.deepEqual(matchupFrac(null), MATCHUP_DEFAULT);
  assert.deepEqual(matchupFrac(undefined), MATCHUP_DEFAULT);
});

test('clampPos: haelt das Overlay im Bild, Unsinn wird Standardlage', () => {
  assert.deepEqual(clampPos({ x: 0.5, y: 0.5 }), { x: 0.5, y: 0.5 });
  assert.deepEqual(clampPos({ x: -1, y: -0.2 }), { x: 0, y: 0 });
  const far = clampPos({ x: 2, y: 3 });
  assert.equal(far.x, 1 - MATCHUP_WIDTH);
  assert.equal(far.y, 0.95);
  assert.deepEqual(clampPos({ x: NaN, y: 0.3 }), MATCHUP_DEFAULT);
  assert.deepEqual(clampPos({ x: 'a' as unknown as number, y: 0.3 }), MATCHUP_DEFAULT);
  assert.deepEqual(clampPos({}), MATCHUP_DEFAULT);
});

test('toPixels und toFrac sind umkehrbar (auch mit Balken)', () => {
  const r = rectFromGame(2560, 1080)!;
  const f = { x: 0.3, y: 0.7 };
  const px = toPixels(f, r);
  assert.deepEqual(px, { left: 320 + 1920 * 0.3, top: 1080 * 0.7 });
  const back = toFrac(px.left, px.top, r);
  assert.ok(Math.abs(back.x - f.x) < 1e-9 && Math.abs(back.y - f.y) < 1e-9);
});

test('overlayBox: Shop mit fester Groesse, Gegner-Overlay nur mit Lage', () => {
  const r = rectFromGame(1920, 1080)!;
  const shop = overlayBox('shop', r, null);
  assert.equal(Math.round(shop.left), 461);
  assert.equal(Math.round(shop.top), 864);
  assert.ok(shop.width! > 0 && shop.height! > 0);
  const m = overlayBox('matchup', r, null);
  assert.equal(Math.round(m.left), Math.round(1920 * MATCHUP_DEFAULT.x));
  assert.equal(Math.round(m.top), Math.round(1080 * MATCHUP_DEFAULT.y));
  assert.equal(m.width, undefined);
  assert.equal(m.height, undefined);
  const moved = overlayBox('matchup', r, { x: 0.1, y: 0.2 });
  assert.deepEqual([moved.left, moved.top], [192, 216]);
});
