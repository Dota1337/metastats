import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VARIANTS, keySelect, variantRowsSql, variantsForQuery, aggEligible, compListSql, AGG_SIG,
  aggBudgetS, nextUtc, aggCoveredDays, planAgg, aggDue, aggDaysFor,
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
});

test('AGG_BUDGET_S: leer/ungueltig → 1200, 0 → aus', () => {
  assert.equal(aggBudgetS(undefined), 1200);
  assert.equal(aggBudgetS(''), 1200);
  assert.equal(aggBudgetS('abc'), 1200);
  assert.equal(aggBudgetS('-5'), 1200);
  assert.equal(aggBudgetS('0'), 0);
  assert.equal(aggBudgetS('300'), 300);
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
