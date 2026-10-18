// Speichern veroeffentlichter Comps (app/api/tft/comps/share/route.ts).
// Anlass 2026-10-18: das Stern-Level ging beim Veroeffentlichen verloren,
// und mit Tactician-Items stehen mehr als 10 Units auf dem Brett.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePlacements, toStarLevel } from './tft-public-comps.ts';

test('Stern-Level 2–4 bleibt, 1★ und Unsinn fallen weg', () => {
  const out = sanitizePlacements([
    { cell: 0, characterId: 'DA_18_Veigar', items: [], star: 4 },
    { cell: 1, characterId: 'DA_Amumu18', items: ['DA_ThiefsGloves'], star: 2 },
    { cell: 2, characterId: 'DA_Gromp18_AP', items: [], star: 1 },
    { cell: 3, characterId: 'DA_18_Kayle', items: [], star: '3' },
    { cell: 4, characterId: 'DA_18_Karma', items: [], star: 5 },
    { cell: 5, characterId: 'DA_18_Leona', items: [] },
  ]);
  assert.deepEqual(out.map(p => p.star), [4, 2, undefined, undefined, undefined, undefined]);
  assert.ok(!('star' in out[2]));
  assert.deepEqual(out[1].items, ['DA_ThiefsGloves']);
  assert.equal(toStarLevel(3), 3);
  assert.equal(toStarLevel(null), undefined);
});

test('Brett: Felder 0–27 je einmal, bis 28 Units, hoechstens 3 Items', () => {
  const full = Array.from({ length: 30 }, (_, i) => ({ cell: i % 28, characterId: `U${i}`, items: ['A', 'B', 'C', 'D'] }));
  const out = sanitizePlacements(full);
  assert.equal(out.length, 28);
  assert.equal(new Set(out.map(p => p.cell)).size, 28);
  // doppelt belegtes Feld: der erste Eintrag gewinnt
  assert.equal(out.find(p => p.cell === 0).characterId, 'U0');
  assert.ok(out.every(p => p.items.length === 3));
  // 13 Units (Brett mit 3 Tactician-Items) kommen vollstaendig an
  assert.equal(sanitizePlacements(full.slice(0, 13)).length, 13);
});

test('Ungueltiges faellt raus', () => {
  assert.deepEqual(sanitizePlacements(null), []);
  assert.deepEqual(sanitizePlacements('x'), []);
  const out = sanitizePlacements([
    { cell: 28, characterId: 'A' }, { cell: -1, characterId: 'A' }, { cell: 1.5, characterId: 'A' },
    { cell: 2, characterId: '' }, { cell: 3, characterId: 7 }, null,
    { cell: 4, characterId: ' <DA_X> ', items: [1, 'DA_Y'] },
  ]);
  assert.deepEqual(out, [{ cell: 4, characterId: 'DA_X', items: ['DA_Y'] }]);
});
