import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MASK_SIG, MASK_REV, MASK_TABLES, MASK_DATA_TABLES, MASK_COLS, MASK_BIT_COLS, MASK_ORDER, MASK_FP_EMPTY, MASK_TOP4, MASK_TOP1,
  maskTablesDdl, maskSql, maskFpSql, maskCheckHSql, maskBit, maskBitSql, maskPlaceSum, maskPlaceSumSql, maskFpAdd,
  maskEnabled, maskCarryDays, maskQueue, maskDeadlineMs, maskHardMs,
} from './explorer-mask.mjs';
import { AGG_HARD_S } from './explorer-agg.mjs';

// Stolperdraht (Paket 6): MASK_SIG haengt am SQL-Text der Masken (inklusive
// keySelect), an den Tabellen und am Fingerabdruck. Aendert sich davon etwas,
// verwirft der naechste Bau ALLE gespeicherten Masken und rechnet sie im
// Rest-Budget ueber mehrere Laeufe neu — dieser Test macht das sichtbar.
// Aendert sich etwas am Bau ausserhalb dieser SQL, das gespeicherte Masken
// betrifft (explorer-mask-build.mjs), MASK_REV erhoehen und Pin nachziehen.
const PINS = { 0: 'be2f39c243be9a1e' };

test('MASK_SIG unveraendert (sonst werden alle Masken neu gerechnet — bewusst? Pin nachziehen)', () => {
  assert.equal(MASK_SIG, PINS[MASK_REV],
    'Masken-SQL geaendert: alle Masken werden verworfen. Gewollt → Pin nachziehen; Bau-Aenderung ohne SQL → MASK_REV erhoehen');
});

test('Bits: Platz p = Bit p-1, Top 4 / Sieg', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(maskBit), [1, 2, 4, 8, 16, 32, 64, 128]);
  assert.equal(MASK_TOP4, maskBit(1) | maskBit(2) | maskBit(3) | maskBit(4));
  assert.equal(MASK_TOP1, maskBit(1));
  assert.equal(maskBitSql('k.placement'), '(1::UTINYINT << (k.placement - 1))');
});

test('Platzsumme stimmt fuer alle 256 Masken', () => {
  for (let x = 0; x < 256; x++) {
    let want = 0;
    for (let p = 1; p <= 8; p++) if (x & maskBit(p)) want += p;
    assert.equal(maskPlaceSum(x), want, `Maske ${x}`);
  }
  assert.equal(maskPlaceSumSql('m'), '(bit_count(m) + bit_count(m & 170) + 2 * bit_count(m & 204) + 4 * bit_count(m & 240))');
});

test('Tabellen: DDL, Spalten und Sortierung passen zusammen', () => {
  const ddl = maskTablesDdl('O');
  assert.equal(ddl.length, MASK_TABLES.length);
  for (const t of MASK_DATA_TABLES) {
    const stmt = ddl.find((s) => s.startsWith(`CREATE TABLE O.${t}(`));
    assert.ok(stmt, t);
    const colsDdl = stmt.slice(stmt.indexOf('(') + 1, -1).split(',').map((c) => c.trim().split(' ')[0]);
    assert.deepEqual(colsDdl, MASK_COLS[t], `${t}: DDL ≠ MASK_COLS`);
    for (const c of MASK_BIT_COLS[t]) assert.ok(MASK_COLS[t].includes(c), `${t}.${c}`);
    // ORDER BY mit Spaltennummern in maskSql = MASK_ORDER (Kopie aus der vorigen Datei).
    const names = { b: 'B', u: 'U', t: 'T', uk: 'K', compList: 'C' };
    const ord = maskSql(t, names).match(/ORDER BY ([\d, ]+)$/)[1].split(',').map((i) => MASK_COLS[t][Number(i) - 1]);
    assert.equal(ord.join(', '), MASK_ORDER[t], `${t}: Sortierung`);
  }
});

test('maskSql: ui braucht uk und compList, unbekannte Tabelle wirft', () => {
  assert.throws(() => maskSql('mask_ui', { b: 'B' }), /uk und compList/);
  assert.throws(() => maskSql('mask_xx', {}), /unbekannte/);
  assert.match(maskSql('mask_ui', { uk: 'K', compList: 'C' }), /NOT list_contains\(C, item\)/);
  // uk enthaelt Komponenten (leere Liste), ui filtert danach.
  assert.match(maskSql('mask_uk', { b: 'B', u: 'U' }), /list_contains\(\[\]::VARCHAR\[\], item\)/);
});

test('Fingerabdruck und Pruefung h lesen alle Masken-Eingaben', () => {
  const fp = maskFpSql({ b: 'B', u: 'U', t: 'T' });
  assert.match(fp.b, /hash\(b\.mid, b\.placement\)/);
  assert.match(fp.u, /hash\(b\.mid, b\.placement, x\.unit, x\.star, x\.i1, x\.i2, x\.i3\)/);
  assert.match(fp.t, /hash\(b\.mid, b\.placement, x\.trait, x\.lvl, x\.overcap\)/);
  const h = maskCheckHSql({ o: 'O', D: "DATE '2026-10-01'", b: 'B', u: 'U', t: 'T', compList: 'C', mids: 'M' });
  assert.match(h, /day = DATE '2026-10-01' AND mid IN \(SELECT mid FROM M\)/);
  assert.doesNotMatch(maskCheckHSql({ o: 'O', D: 'X', b: 'B', u: 'U', t: 'T', compList: 'C' }), /SELECT mid FROM/);
});

test('maskFpAdd: additiv, exakt ueber 2^53, leer neutral, kaputt wirft', () => {
  const a = '3:18446744073709551615|10:-5|0:0';
  const b = '2:18446744073709551615|1:7|4:9';
  assert.equal(maskFpAdd(a, b), '5:36893488147419103230|11:2|4:9');
  assert.equal(maskFpAdd(a, MASK_FP_EMPTY), a);
  assert.equal(maskFpAdd(undefined, b), b);
  assert.throws(() => maskFpAdd('1:2|3:4', b), /ungueltig/);
});

test('maskEnabled: nur "0" schaltet ab', () => {
  assert.equal(maskEnabled('0'), false);
  assert.equal(maskEnabled(' 0 '), false);
  for (const v of [undefined, null, '', '1', 'ja']) assert.equal(maskEnabled(v), true, String(v));
});

test('maskCarryDays: nur gedeckte Tage im Fenster mit gleichem Fingerabdruck, neueste zuerst', () => {
  const oldFp = new Map([['2026-10-01', 'a'], ['2026-10-02', 'b'], ['2026-10-03', 'c'], ['2026-09-20', 'x']]);
  const newFp = new Map([['2026-10-01', 'a'], ['2026-10-02', 'B'], ['2026-10-03', 'c'], ['2026-09-20', 'x']]);
  const maskDays = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-03', '2026-09-20', '2026-10-04'];
  assert.deepEqual(maskCarryDays({ oldFp, newFp, maskDays, w: '2026-09-25' }), ['2026-10-03', '2026-10-01']);
  assert.deepEqual(maskCarryDays({ oldFp, newFp, maskDays: [], w: '2026-09-25' }), []);
});

test('maskQueue: ohne gedeckte und gesperrte Tage, neueste zuerst', () => {
  const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];
  assert.deepEqual(maskQueue({ days, covered: ['2026-10-02'], skip: ['2026-10-04'] }), ['2026-10-03', '2026-10-01']);
  assert.deepEqual(maskQueue({ days, covered: days }), []);
});

test('Fristen: Rest-Budget, Tauschzeit, harte Grenze, Laufzeit-Alarm', () => {
  const t0 = Date.UTC(2026, 9, 8, 3, 0); // 03:00 UTC, Tausch erst am Folgetag 02:55
  const aggStart = t0 + 600_000;
  assert.equal(maskDeadlineMs({ aggStartMs: aggStart, t0Ms: t0, budgetS: 1200 }), aggStart + 1_200_000);
  assert.equal(maskDeadlineMs({ aggStartMs: aggStart, t0Ms: t0, budgetS: 1200, capMs: t0 + 1_000_000 }), t0 + 1_000_000);
  assert.equal(maskDeadlineMs({ aggStartMs: aggStart, t0Ms: t0, budgetS: 99_999 }), t0 + AGG_HARD_S * 1000);
  const t1 = Date.UTC(2026, 9, 8, 1, 0); // 01:00 UTC → Tausch 02:55
  assert.equal(maskDeadlineMs({ aggStartMs: t1, t0Ms: t1, budgetS: 99_999 }), Date.UTC(2026, 9, 8, 2, 55));
  assert.equal(maskHardMs({ t0Ms: t0 }), t0 + AGG_HARD_S * 1000);
  assert.equal(maskHardMs({ t0Ms: t0, capMs: t0 + 5 }), t0 + 5);
});
