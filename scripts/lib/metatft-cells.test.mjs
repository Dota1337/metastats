import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCells, idSetNumber, MIN_UNITS, TOP4_MIN_OBS } from './metatft-cells.mjs';

const NOW = Date.parse('2026-10-26T21:00:00Z');
const SET = 18;

// Beobachtungen je Einheit: so viele wie die Top-4-Schwelle, damit beide Felder
// sie erreichen.
const T = TOP4_MIN_OBS;
const PER_UNIT = 4 * T;

// n Units DA_U0..DA_U{n-1} im Bundle, je zwei Felder mit 3T/1T Beobachtungen.
function setup({ n = MIN_UNITS, extraRows = [], updated = NOW - 3600_000 } = {}) {
  const champions = {};
  const positions = [];
  for (let i = 0; i < n; i++) {
    champions[`DA_U${i}`] = { name: `U${i}` };
    positions.push({ unit: `DA_U${i}`, position: 'cell_1', win_rate: 0.5, count: 3 * T });
    positions.push({ unit: `DA_U${i}`, position: 'cell_28', win_rate: 0.6, count: T });
  }
  return { champions, raw: { positions: [...positions, ...extraRows], updated } };
}

test('Feld cell_N wird Index N-1, Haeufigkeit und Top 4 in Promille', () => {
  const { champions, raw } = setup();
  const out = buildCells(raw, { champions, set: SET, now: NOW });
  const u = out.units.find(x => x.id === 'DA_U0');
  assert.equal(u.n, PER_UNIT);
  assert.deepEqual(u.cells, [[0, 750, 500], [27, 250, 600]]);
  assert.equal(out.units.length, MIN_UNITS);
  assert.equal(out.total, MIN_UNITS * PER_UNIT);
});

test('Top 4 unter der Mindestzahl ist null, die Haeufigkeit bleibt', () => {
  const { champions, raw } = setup({
    extraRows: [{ unit: 'DA_U0', position: 'cell_14', win_rate: 0.9, count: TOP4_MIN_OBS - 1 }],
  });
  const u = buildCells(raw, { champions, set: SET, now: NOW }).units.find(x => x.id === 'DA_U0');
  const c = u.cells.find(([cell]) => cell === 13);
  assert.equal(c[2], null);
  assert.ok(c[1] > 0);
});

test('doppelte Zeilen laufen gewichtet zusammen', () => {
  const { champions, raw } = setup({
    extraRows: [{ unit: 'DA_U0', position: 'cell_1', win_rate: 1, count: T }],
  });
  const u = buildCells(raw, { champions, set: SET, now: NOW }).units.find(x => x.id === 'DA_U0');
  // (3T×0,5 + T×1) / 4T = 0,625; Haeufigkeit 4T von 5T
  assert.deepEqual(u.cells[0], [0, 800, 625]);
});

test('fremde Units fallen weg, solange sie unter 5 % bleiben', () => {
  const { champions, raw } = setup({
    extraRows: [{ unit: 'TFT17_Alt', position: 'cell_3', win_rate: 0.5, count: 1000 }],
  });
  const out = buildCells(raw, { champions, set: SET, now: NOW });
  assert.ok(!out.units.some(u => u.id === 'TFT17_Alt'));
});

test('Set-Gatter: zu viele Beobachtungen auf fremden Units → Abbruch', () => {
  const { champions, raw } = setup({
    extraRows: [{ unit: 'TFT17_Alt', position: 'cell_3', win_rate: 0.5, count: MIN_UNITS * PER_UNIT }],
  });
  assert.throws(() => buildCells(raw, { champions, set: SET, now: NOW }), /Units des Sets/);
});

// Anteil an allen gueltigen Beobachtungen → passende Zeilenmenge zu den Set-Units
const share = (p) => Math.round((MIN_UNITS * PER_UNIT * p) / (1 - p));

test('naechstes Set: zaehlt nicht im Set-Gatter und kommt nie in die Ausgabe', () => {
  // 24.11.2026 live: 15,3 % Set 19 → frueher Abbruch bei 84 %
  const ids = ['DA_Ahri19', 'DA_19_Ahri', 'TFT19_Ahri', 'DA_OceanSong19_Bongos', 'DA_Akali_TrueDamage19'];
  const each = Math.round(share(0.16) / ids.length);
  const { champions, raw } = setup({
    extraRows: ids.map((unit) => ({ unit, position: 'cell_3', win_rate: 0.5, count: each })),
  });
  const out = buildCells(raw, { champions, set: SET, now: NOW });
  assert.equal(out.stats.setSharePermille, 1000);
  assert.equal(out.stats.nextSetPermille, 160);
  assert.ok(!out.units.some((u) => ids.includes(u.id)));
  assert.equal(out.total, MIN_UNITS * PER_UNIT);
});

test('aeltere Sets, Ids ohne Nummer und uebernaechstes Set zaehlen weiter gegen das Gatter', () => {
  for (const unit of ['TFT17_Alt', 'DA_3StarPyke_InfernalIdol', 'DA_TrainingDummy', 'DA_18_Akali_AP', 'DA_Mech20_X']) {
    const { champions, raw } = setup({
      extraRows: [{ unit, position: 'cell_3', win_rate: 0.5, count: share(0.06) }],
    });
    assert.throws(() => buildCells(raw, { champions, set: SET, now: NOW }), /Units des Sets/, unit);
  }
});

test('Bundle-Id mit hoeherer Zahl im Namen zaehlt zum eigenen Set', () => {
  const { champions, raw } = setup({
    extraRows: [{ unit: 'DA_Odd19', position: 'cell_3', win_rate: 0.5, count: share(0.2) }],
  });
  champions.DA_Odd19 = { name: 'Odd' };
  const out = buildCells(raw, { champions, set: SET, now: NOW });
  assert.ok(out.units.some((u) => u.id === 'DA_Odd19'));
  assert.equal(out.stats.nextSetPermille, 0);
});

test('nur naechstes Set in der Quelle → sauberer Abbruch, kein NaN', () => {
  const raw = { positions: [{ unit: 'DA_Ahri19', position: 'cell_1', win_rate: 0.5, count: 5000 }], updated: NOW };
  assert.throws(() => buildCells(raw, { champions: {}, set: SET, now: NOW }), /nur 0\.0 % .*ohne 100\.0 % aus Set 19/);
});

test('Set-Nummer fehlt oder ungueltig → Abbruch', () => {
  const { champions, raw } = setup();
  for (const set of [undefined, 0, '18', 18.5]) {
    assert.throws(() => buildCells(raw, { champions, set, now: NOW }), /Set-Nummer/, String(set));
  }
});

test('idSetNumber: Riots Schreibweisen', () => {
  const cases = {
    TFT17_Aatrox: 17, TFT18_MasterYi: 18, TFT19_X: 19,
    DA_18_Akali_AD: 18, DA_19_Ahri: 19,
    DA_Lux18_Base: 18, DA_NidaleeCougar18_AD: 18, DA_Ahri19: 19, DA_AkaliKDA19: 19,
    DA_OceanSong19_Bongos: 19, DA_Demonvision19_InfernalIdol: 19, DA_Akali_TrueDamage19: 19,
    DA_3StarPyke_InfernalIdol: null, DA_TrainingDummy: null, DA_TheTower_TrainingDummy: null,
    TFT_TrainingDummy: null, TFT9_SLIME_Crab: 9,
  };
  for (const [id, want] of Object.entries(cases)) assert.equal(idSetNumber(id), want, id);
});

test('zu viele ungueltige Zeilen → Abbruch', () => {
  const bad = Array.from({ length: 20 }, () => ({ unit: 'DA_U0', position: 'cell_29', win_rate: 0.5, count: 10 }));
  const { champions, raw } = setup({ extraRows: bad });
  assert.throws(() => buildCells(raw, { champions, set: SET, now: NOW }), /ungueltig/);
});

test('ungueltige Einzelzeilen werden uebersprungen', () => {
  const { champions, raw } = setup({
    extraRows: [{ unit: 'DA_U0', position: 'cell_0', win_rate: 0.5, count: 10 }],
  });
  const u = buildCells(raw, { champions, set: SET, now: NOW }).units.find(x => x.id === 'DA_U0');
  assert.equal(u.n, PER_UNIT);
});

test('zu wenige Units → Abbruch', () => {
  const { champions, raw } = setup({ n: MIN_UNITS - 1 });
  assert.throws(() => buildCells(raw, { champions, set: SET, now: NOW }), /Units mit Daten/);
});

test('Rueckgang ueber 30 % gegen den Vorlauf → Abbruch, knapp darunter nicht', () => {
  const { champions, raw } = setup();
  const total = MIN_UNITS * PER_UNIT;
  assert.throws(() => buildCells(raw, { champions, set: SET, now: NOW, previousTotal: Math.ceil(total / 0.69) }), /Rueckgang/);
  assert.doesNotThrow(() => buildCells(raw, { champions, set: SET, now: NOW, previousTotal: Math.floor(total / 0.71) }));
});

test('veralteter oder fehlender Stempel → Abbruch', () => {
  const old = setup({ updated: NOW - 4 * 86_400_000 });
  assert.throws(() => buildCells(old.raw, { champions: old.champions, set: SET, now: NOW }), /Tage alt/);
  const none = setup();
  delete none.raw.updated;
  assert.throws(() => buildCells(none.raw, { champions: none.champions, set: SET, now: NOW }), /updated/);
});

test('Fehlerantwort ohne Liste → Abbruch', () => {
  assert.throws(() => buildCells({ error: 'x' }, { champions: {}, set: SET, now: NOW }), /positions/);
  assert.throws(() => buildCells(null, { champions: {}, set: SET, now: NOW }), /positions/);
});
