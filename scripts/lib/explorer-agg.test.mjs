import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VARIANTS, keySelect, variantRowsSql, variantsForQuery, aggEligible, compListSql, AGG_SIG,
  aggBudgetS, nextUtc, aggCoveredDays, planAgg, aggDue, aggDaysFor, aggCopyEstS, aggDueForCopy,
  aggCarryBlocked, aggCarryLate, aggCarryDays, AGG_HARD_S, aggPartCap, packDayParts, packDayPartsSql,
} from './explorer-agg.mjs';

const TABS = ['summary', 'units', 'items', 'traits', 'comps', 'level', 'round', 'gold', 'region', 'rank'];
const plain = { ranks: [], units: [], items: [], traits: [], focus: null };

test('jeder Reiter ausser summary hat eine gespeicherte Variante, jede Variante wird gebraucht', () => {
  const used = new Set();
  for (const tab of TABS.filter(t => t !== 'summary')) {
    for (const split of [null, 'star', 'over']) {
      const v = variantsForQuery({ tab, split });
      assert.ok(Array.isArray(v) && v.length > 0, `${tab}/${split}`);
      v.forEach(x => { assert.ok(VARIANTS.includes(x)); used.add(x); });
    }
  }
  assert.deepEqual([...used].sort(), [...VARIANTS].sort());
});

test('Split-Zuordnung wie im Dienst', () => {
  assert.deepEqual(variantsForQuery({ tab: 'units', split: 'star' }), ['units_star', 'units']);
  assert.deepEqual(variantsForQuery({ tab: 'units', split: 'over' }), ['units']);
  assert.deepEqual(variantsForQuery({ tab: 'traits', split: 'star' }), ['traits']);
  assert.deepEqual(variantsForQuery({ tab: 'traits', split: 'over' }), ['traits_over']);
  assert.deepEqual(variantsForQuery({ tab: 'gold', split: 'star' }), ['gold']);
});

test('Summen-Weg nur ohne Filter, ohne Fokus, nicht fuer summary', () => {
  assert.deepEqual(aggEligible({ ...plain, tab: 'level' }), ['level']);
  assert.equal(aggEligible({ ...plain, tab: 'summary' }), null);
  assert.equal(aggEligible({ ...plain, tab: 'units', ranks: ['MASTER'] }), null);
  assert.equal(aggEligible({ ...plain, tab: 'units', units: [{ id: 'X' }] }), null);
  assert.equal(aggEligible({ ...plain, tab: 'items', items: [{ id: 'X' }] }), null);
  assert.equal(aggEligible({ ...plain, tab: 'traits', traits: [{ id: 'X' }] }), null);
  assert.equal(aggEligible({ ...plain, tab: 'items', focus: 'U' }), null);
});

test('SQL je Variante: Spalten in fester Reihenfolge, Komponenten nur geprueft', () => {
  const names = { b: 'bd', u: 'ud', t: 'td', compList: compListSql(['DA_Component_Sword', "x'; DROP"]) };
  assert.equal(names.compList, "['DA_Component_Sword']::VARCHAR[]");
  for (const v of VARIANTS) {
    assert.match(keySelect(v, names), /^SELECT (DISTINCT )?bd\.bid, bd\.mid, bd\.placement, /, v);
    assert.match(variantRowsSql(v, names, 'SELECT 1'), /GROUP BY ALL$/, v);
  }
  assert.match(keySelect('units', { ...names, withStar: true }), /max\(x\.star\)::INTEGER AS st/);
  assert.throws(() => keySelect('items', { b: 'bd' }), /compList/);
  assert.throws(() => keySelect('nope', names), /unbekannte Variante/);
});

test('AGG_SIG ist ein stabiler Kurz-Hash', () => {
  assert.match(AGG_SIG, /^[0-9a-f]{16}$/);
  // Stand Paket 5b/5c (AGG_REV 0): aendert er sich, rechnet jede Datei ihre
  // Summen neu — dann bewusst hier nachziehen.
  assert.equal(AGG_SIG, '810895ebc43c0841');
});

test('Uebernahme: Sperrgruende in fester Reihenfolge, sonst null', () => {
  const ok = { prevKind: 'ok', prevTestRun: false, testRun: false, carryEnv: undefined, budgetS: 1200, aggtryExists: false };
  assert.equal(aggCarryBlocked(ok), null);
  assert.equal(aggCarryBlocked({ ...ok, carryEnv: '1' }), null);
  assert.equal(aggCarryBlocked({ ...ok, prevKind: 'none' }), 'vorige Datei: none');
  assert.equal(aggCarryBlocked({ ...ok, prevKind: 'legacy' }), 'vorige Datei: legacy');
  assert.equal(aggCarryBlocked({ ...ok, testRun: true }), 'Testlauf');
  assert.equal(aggCarryBlocked({ ...ok, prevTestRun: true }), 'vorige Datei aus einem Testlauf');
  assert.equal(aggCarryBlocked({ ...ok, carryEnv: ' 0 ' }), 'AGG_CARRY=0');
  assert.equal(aggCarryBlocked({ ...ok, budgetS: 0 }), 'AGG_BUDGET_S=0');
  assert.equal(aggCarryBlocked({ ...ok, aggtryExists: true }), 'Versuchs-Stempel vom letzten Lauf');
});

test('Uebernahme: zu spaet, wenn 2 Fingerabdruecke + 600 s die harte Grenze reissen', () => {
  const t0Ms = Date.parse('2026-10-09T01:35:00Z');
  const edge = t0Ms + (AGG_HARD_S - 2 * 60 - 600) * 1000;
  assert.equal(aggCarryLate({ nowMs: edge, t0Ms, fpOldS: 60 }), false);
  assert.equal(aggCarryLate({ nowMs: edge + 1, t0Ms, fpOldS: 60 }), true);
  assert.equal(aggCarryLate({ nowMs: t0Ms + 4_200_000, t0Ms, fpOldS: 40 }), false);
});

test('Uebernahme: nur gedeckte Tage mit gleichem Fingerabdruck', () => {
  const oldFp = new Map([['2026-10-01', 'a'], ['2026-10-02', 'b'], ['2026-10-03', 'c'], ['2026-09-20', 'z']]);
  const newFp = new Map([['2026-10-03', 'c'], ['2026-10-01', 'a'], ['2026-10-02', 'B'], ['2026-10-04', 'd']]);
  const r = aggCarryDays({ oldFp, newFp, covered: ['2026-10-01', '2026-10-02', '2026-09-20'] });
  assert.deepEqual(r.days, ['2026-10-01']);
  assert.deepEqual(r.differ, ['2026-10-02']);
  assert.deepEqual(r.uncovered, ['2026-10-03']);
  assert.deepEqual(r.noOld, ['2026-10-04']);
  assert.deepEqual(aggCarryDays({ oldFp, newFp: new Map(), covered: ['2026-10-01'] }).days, []);
});

test('AGG_BUDGET_S: leer/ungueltig → 1200, 0 → aus', () => {
  assert.equal(aggBudgetS(undefined), 1200);
  assert.equal(aggBudgetS(''), 1200);
  assert.equal(aggBudgetS('abc'), 1200);
  assert.equal(aggBudgetS('-5'), 1200);
  assert.equal(aggBudgetS('0'), 0);
  assert.equal(aggBudgetS('300'), 300);
});

test('AGG_PART_CAP: leer/ungueltig → 200.000, 0 erlaubt, keine Bruchzahlen', () => {
  assert.equal(aggPartCap(undefined), 200_000);
  assert.equal(aggPartCap(''), 200_000);
  assert.equal(aggPartCap('abc'), 200_000);
  assert.equal(aggPartCap('-1'), 200_000);
  assert.equal(aggPartCap('1.5'), 200_000);
  assert.equal(aggPartCap('0'), 0);
  assert.equal(aggPartCap('150000'), 150_000);
});

// Portionen pruefen wie der Bau sie nutzt: disjunkt, alles abgedeckt, je
// Portion hoechstens cap, ganze Tage — nur ein Tag ueber cap wird geteilt,
// und die Teil-Groessen sind genau die von (Zeilennummer − 1) / cap.
function checkParts(counts, cap) {
  const parts = packDayParts(counts, cap);
  const seen = new Map();
  parts.forEach((p, i) => {
    assert.ok(p.n >= 1 && p.n <= cap, `Portion ${i}: ${p.n}`);
    for (const d of p.days) seen.set(d, [...(seen.get(d) ?? []), i]);
  });
  for (const { day, n } of counts.filter((c) => c.n > 0)) {
    const at = seen.get(day);
    assert.ok(at, `${day} fehlt`);
    if (n <= cap) assert.equal(at.length, 1, `${day} geteilt`);
    else {
      assert.equal(at.length, Math.ceil(n / cap), `${day} Teile`);
      at.forEach((pi, j) => {
        assert.deepEqual(parts[pi].days, [day], `${day} allein`);
        assert.equal(pi, at[0] + j, `${day} Teile hintereinander`);
        assert.equal(parts[pi].n, Math.min(cap, n - j * cap));
      });
    }
  }
  assert.equal(parts.reduce((a, p) => a + p.n, 0), counts.reduce((a, c) => a + c.n, 0));
  return parts;
}

test('packDayParts: ganze Tage bis zur Grenze, neueste zuerst, grosser Tag allein geteilt', () => {
  const c = (day, n) => ({ day: `2026-10-${day}`, n });
  // 20.10. (436.024 Partien an 45 Tagen, gekuerzt): vorher alles-oder-nichts.
  const parts = checkParts([c(10, 90_000), c(23, 150_000), c(22, 30_000), c(21, 20_000), c(20, 10_000)], 200_000);
  assert.deepEqual(parts.map((p) => p.days), [['2026-10-23', '2026-10-22', '2026-10-21'], ['2026-10-20', '2026-10-10']]);
  // Ein Tag ueber der Grenze: eigene Portionen, die offene Portion davor bleibt zu.
  const big = checkParts([c(24, 5), c(23, 450_000), c(22, 7)], 200_000);
  assert.deepEqual(big.map((p) => [p.days, p.n]), [
    [['2026-10-24'], 5], [['2026-10-23'], 200_000], [['2026-10-23'], 200_000], [['2026-10-23'], 50_000], [['2026-10-22'], 7]]);
  assert.deepEqual(packDayParts([], 200_000), []);
  assert.deepEqual(packDayParts([c(1, 0)], 10), []);
  assert.throws(() => packDayParts([c(1, 3)], 0));
  // Zufaellige Faelle gegen die Regeln.
  let seed = 7;
  const rnd = (m) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % m; };
  for (let k = 0; k < 200; k++) {
    const cap = 1 + rnd(50);
    const n = rnd(12);
    checkParts(Array.from({ length: n }, (_, i) => ({ day: `2026-09-${String(10 + i).padStart(2, '0')}`, n: rnd(3 * cap) })), cap);
  }
});

test('packDayPartsSql: erster Index je Tag, geteilter Tag zaehlt nach mid weiter', () => {
  const parts = packDayParts([{ day: '2026-10-24', n: 3 }, { day: '2026-10-23', n: 25 }], 10);
  const sql = packDayPartsSql('mk_pmd', parts, 10);
  assert.match(sql, /VALUES \(DATE '2026-10-24', 0\), \(DATE '2026-10-23', 1\)\)/);
  assert.match(sql, /\(row_number\(\) OVER \(PARTITION BY m\.day ORDER BY m\.mid\) - 1\) \/\/ 10 AS part/);
  assert.match(sql, /FROM mk_pmd m JOIN/);
});

test('naechstes 02:55 UTC', () => {
  const at = (s) => Date.parse(s);
  assert.equal(nextUtc(at('2026-10-09T01:35:00Z'), [2, 55]), at('2026-10-09T02:55:00Z'));
  assert.equal(nextUtc(at('2026-10-09T02:55:00Z'), [2, 55]), at('2026-10-10T02:55:00Z'));
  assert.equal(nextUtc(at('2026-10-08T19:00:00Z'), [2, 55]), at('2026-10-09T02:55:00Z'));
});

test('Deckung: Fenster, Patch-Tage + Folgetag, Rang-Tage', () => {
  const r = aggCoveredDays({
    covered: ['2026-08-24', '2026-08-25', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-05'],
    w: '2026-08-25', f: '2026-10-02', patchChanged: ['2026-09-30'],
  });
  assert.deepEqual(r.keep, ['2026-08-25', '2026-10-02', '2026-10-05']);
  assert.deepEqual(r.drop, ['2026-08-24', '2026-09-30', '2026-10-01']);
  assert.deepEqual(r.touched, ['2026-09-30', '2026-10-01']);
  assert.deepEqual(r.rankDays, ['2026-10-02', '2026-10-05']);
  assert.deepEqual(aggCoveredDays({ covered: [], w: '2026-08-25', f: '2026-10-02' }).keep, []);
});

test('Plan: Frist = kleinste der drei Grenzen, Pflicht-Tage zuerst, sonst neueste zuerst', () => {
  const t0 = Date.parse('2026-10-09T01:35:00Z');
  const days = ['2026-10-01', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-03'];
  // Teil-Aufbau: jetzt + 1200 s liegt vor 02:55
  let p = planAgg({ nowMs: t0 + 300_000, t0Ms: t0, budgetS: 1200, days, covered: ['2026-10-03'], newestDays: ['2026-10-07', '2026-10-08'] });
  assert.equal(p.deadlineMs, t0 + 1_500_000);
  assert.equal(p.hardMs, t0 + 8_400_000);
  assert.deepEqual(p.todo.map(x => x.day), ['2026-10-08', '2026-10-07', '2026-10-06', '2026-10-05', '2026-10-01']);
  assert.deepEqual(p.todo.map(x => x.must), [true, true, false, false, false]);
  // Vollaufbau fertig um 02:45: Frist 02:55
  p = planAgg({ nowMs: Date.parse('2026-10-09T02:45:00Z'), t0Ms: t0, budgetS: 1200, days, covered: [] });
  assert.equal(p.deadlineMs, Date.parse('2026-10-09T02:55:00Z'));
  // Start am Abend: harte Grenze greift vor 02:55
  const t1 = Date.parse('2026-10-08T19:00:00Z');
  p = planAgg({ nowMs: t1 + 8_000_000, t0Ms: t1, budgetS: 99999, days, covered: [] });
  assert.equal(p.deadlineMs, t1 + 8_400_000);
  // Pflicht-Tag laeuft ueber die Frist hinaus, normaler nicht
  const q = planAgg({ nowMs: t0, t0Ms: t0, budgetS: 60, days, covered: [], newestDays: ['2026-10-08'] });
  assert.equal(aggDue(q, q.todo[0], t0 + 120_000), true);
  assert.equal(aggDue(q, q.todo[1], t0 + 120_000), false);
  assert.equal(aggDue(q, q.todo[0], t0 + 8_400_000), false);
});

test('Block-Kopie: Tag nur, wenn er nach der geschaetzten Kopie noch faellig ist', () => {
  assert.equal(Math.round(aggCopyEstS()), 198);
  assert.equal(Math.round(aggCopyEstS(100)), 198);
  assert.equal(Math.round(aggCopyEstS(300) * 10), 3300);
  const t0 = Date.parse('2026-10-08T18:00:00Z');
  const days = ['2026-09-11', '2026-09-12', '2026-10-08'];
  const p = planAgg({ nowMs: t0, t0Ms: t0, budgetS: 1200, days, covered: [], newestDays: ['2026-10-08'] });
  const normal = p.todo.find(x => !x.must);
  const must = p.todo.find(x => x.must);
  // Fall 18:31: 100 s vor der Frist faellig, nach 170 s Kopie nicht mehr
  const late = p.deadlineMs - 100_000;
  assert.equal(aggDue(p, normal, late), true);
  assert.equal(aggDueForCopy(p, normal, late, aggCopyEstS()), false);
  assert.equal(aggDueForCopy(p, normal, p.deadlineMs - 300_000, aggCopyEstS()), true);
  // Pflicht-Tag misst gegen die harte Grenze
  assert.equal(aggDueForCopy(p, must, late, aggCopyEstS()), true);
  assert.equal(aggDueForCopy(p, must, p.hardMs - 100_000, aggCopyEstS()), false);
});

test('Dienst: Tage je Patch-Wahl, nur bei voller Deckung', () => {
  const dp = [
    { day: '2026-10-06', patch: '18.4' }, { day: '2026-10-07', patch: '18.4' },
    { day: '2026-10-06', patch: '18.3b' }, { day: '2026-10-05', patch: '18.3b' }, { day: '2026-10-05', patch: null },
  ];
  const cov = new Set(['2026-10-06', '2026-10-07']);
  assert.deepEqual(aggDaysFor(['18.4'], dp, cov), ['2026-10-06', '2026-10-07']);
  assert.equal(aggDaysFor(['18.3b'], dp, cov), null);
  assert.equal(aggDaysFor([], dp, cov), null);
  assert.deepEqual(aggDaysFor([], dp, new Set(['2026-10-05', '2026-10-06', '2026-10-07'])), ['2026-10-05', '2026-10-06', '2026-10-07']);
  assert.deepEqual(aggDaysFor(['18.9'], dp, cov), []);
});
