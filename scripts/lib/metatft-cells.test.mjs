import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCells, MIN_UNITS, TOP4_MIN_OBS } from './metatft-cells.mjs';

const NOW = Date.parse('2026-10-26T21:00:00Z');

// n Units DA_U0..DA_U{n-1} im Bundle, je zwei Felder mit 3000/1000 Beobachtungen.
function setup({ n = MIN_UNITS, extraRows = [], updated = NOW - 3600_000 } = {}) {
  const champions = {};
  const positions = [];
  for (let i = 0; i < n; i++) {
    champions[`DA_U${i}`] = { name: `U${i}` };
    positions.push({ unit: `DA_U${i}`, position: 'cell_1', win_rate: 0.5, count: 3000 });
    positions.push({ unit: `DA_U${i}`, position: 'cell_28', win_rate: 0.6, count: 1000 });
  }
  return { champions, raw: { positions: [...positions, ...extraRows], updated } };
}

test('Feld cell_N wird Index N-1, Haeufigkeit und Top 4 in Promille', () => {
  const { champions, raw } = setup();
  const out = buildCells(raw, { champions, now: NOW });
  const u = out.units.find(x => x.id === 'DA_U0');
  assert.equal(u.n, 4000);
  assert.deepEqual(u.cells, [[0, 750, 500], [27, 250, 600]]);
  assert.equal(out.units.length, MIN_UNITS);
  assert.equal(out.total, MIN_UNITS * 4000);
});

test('Top 4 unter der Mindestzahl ist null, die Haeufigkeit bleibt', () => {
  const { champions, raw } = setup({
    extraRows: [{ unit: 'DA_U0', position: 'cell_14', win_rate: 0.9, count: TOP4_MIN_OBS - 1 }],
  });
  const u = buildCells(raw, { champions, now: NOW }).units.find(x => x.id === 'DA_U0');
  const c = u.cells.find(([cell]) => cell === 13);
  assert.equal(c[2], null);
  assert.ok(c[1] > 0);
});

test('doppelte Zeilen laufen gewichtet zusammen', () => {
  const { champions, raw } = setup({
    extraRows: [{ unit: 'DA_U0', position: 'cell_1', win_rate: 1, count: 1000 }],
  });
  const u = buildCells(raw, { champions, now: NOW }).units.find(x => x.id === 'DA_U0');
  // (3000×0,5 + 1000×1) / 4000 = 0,625
  assert.deepEqual(u.cells[0], [0, 800, 625]);
});

test('fremde Units fallen weg, solange sie unter 5 % bleiben', () => {
  const { champions, raw } = setup({
    extraRows: [{ unit: 'TFT17_Alt', position: 'cell_3', win_rate: 0.5, count: 1000 }],
  });
  const out = buildCells(raw, { champions, now: NOW });
  assert.ok(!out.units.some(u => u.id === 'TFT17_Alt'));
});

test('Set-Gatter: zu viele Beobachtungen auf fremden Units → Abbruch', () => {
  const { champions, raw } = setup({
    extraRows: [{ unit: 'TFT17_Alt', position: 'cell_3', win_rate: 0.5, count: MIN_UNITS * 4000 }],
  });
  assert.throws(() => buildCells(raw, { champions, now: NOW }), /Units des Sets/);
});

test('zu viele ungueltige Zeilen → Abbruch', () => {
  const bad = Array.from({ length: 20 }, () => ({ unit: 'DA_U0', position: 'cell_29', win_rate: 0.5, count: 10 }));
  const { champions, raw } = setup({ extraRows: bad });
  assert.throws(() => buildCells(raw, { champions, now: NOW }), /ungueltig/);
});

test('ungueltige Einzelzeilen werden uebersprungen', () => {
  const { champions, raw } = setup({
    extraRows: [{ unit: 'DA_U0', position: 'cell_0', win_rate: 0.5, count: 10 }],
  });
  const u = buildCells(raw, { champions, now: NOW }).units.find(x => x.id === 'DA_U0');
  assert.equal(u.n, 4000);
});

test('zu wenige Units → Abbruch', () => {
  const { champions, raw } = setup({ n: MIN_UNITS - 1 });
  assert.throws(() => buildCells(raw, { champions, now: NOW }), /Units mit Daten/);
});

test('Rueckgang ueber 30 % gegen den Vorlauf → Abbruch, knapp darunter nicht', () => {
  const { champions, raw } = setup();
  const total = MIN_UNITS * 4000;
  assert.throws(() => buildCells(raw, { champions, now: NOW, previousTotal: Math.ceil(total / 0.69) }), /Rueckgang/);
  assert.doesNotThrow(() => buildCells(raw, { champions, now: NOW, previousTotal: Math.floor(total / 0.71) }));
});

test('veralteter oder fehlender Stempel → Abbruch', () => {
  const old = setup({ updated: NOW - 4 * 86_400_000 });
  assert.throws(() => buildCells(old.raw, { champions: old.champions, now: NOW }), /Tage alt/);
  const none = setup();
  delete none.raw.updated;
  assert.throws(() => buildCells(none.raw, { champions: none.champions, now: NOW }), /updated/);
});

test('Fehlerantwort ohne Liste → Abbruch', () => {
  assert.throws(() => buildCells({ error: 'x' }, { champions: {}, now: NOW }), /positions/);
  assert.throws(() => buildCells(null, { champions: {}, now: NOW }), /positions/);
});
