import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScoringView } from './scoring-view.ts';

const reps = (v) => Array.from({ length: 200 }, (_, r) => v - 10 + (r % 21));
function player(values) {
  return {
    available: true,
    metrics: Object.entries(values).map(([id, v]) => ({
      id, main: 'x', variantOf: id.endsWith('k') ? id.slice(0, -1) : null,
      value: v, lo: null, hi: null, n: 50, minN: 20, reps: v == null ? null : reps(v),
    })),
  };
}

test('Hauptwert nur aus Unterwerten, die alle haben; Variante nur, wenn alle sie haben', () => {
  const a = player({ '1.1': 80, '1.2': 60, '1.3': 40, '5.1': 50, '5.1k': 70, '5.2': 30 });
  const b = player({ '1.1': 20, '1.2': null, '1.3': 60, '5.1': 40, '5.2': 70 });
  const v = buildScoringView([a, b]);
  assert.deepEqual(v.common.results, ['1.1', '1.3']);
  assert.equal(v.pick['5.1'], '5.1', 'b hat keine Nur-bekannt-Fassung');
  assert.equal(v.main[0].results.value, 60);
  assert.equal(v.main[1].results.value, 40);
  assert.equal(v.main[0].ceiling.value, 40);
  assert.equal(v.main[0].board.value, null, 'keine gemeinsamen Unterwerte');
  // Gesamt = Mittel der vorhandenen Hauptwerte
  assert.equal(v.overall[0].value, 50);
  assert.ok(v.overall[0].lo <= 50 && v.overall[0].hi >= 50);
});

test('Alle mit Nur-bekannt-Fassung → die wird genutzt', () => {
  const a = player({ '5.1': 50, '5.1k': 70 });
  const b = player({ '5.1': 40, '5.1k': 30 });
  const v = buildScoringView([a, b]);
  assert.equal(v.pick['5.1'], '5.1k');
  assert.equal(v.main[0].ceiling.value, 70);
});

test('Bereich fehlt, wenn zu viele Wiederholungen leer sind', () => {
  const a = player({ '1.1': 50 });
  a.metrics[0].reps = Array.from({ length: 200 }, (_, r) => (r < 50 ? null : 50));
  const v = buildScoringView([a, player({ '1.1': 60 })]);
  assert.equal(v.main[0].results.value, 50);
  assert.equal(v.main[0].results.lo, null);
});
