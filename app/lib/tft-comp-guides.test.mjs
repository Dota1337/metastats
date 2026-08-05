/**
 * Regressionstests für den Levelplan-Block des Comp-Guides.
 *
 * Warum ausgerechnet hier: MetaTFTs Levelling-Kürzel ist die eine Stelle im
 * Guide, an der ein Rendering-Fehler dem Spieler nicht auffällt, sondern ihn in
 * die falsche Richtung schickt. "lvl 6" heisst "auf 6 bleiben und rerollen" —
 * roh ausgeliefert liest es sich als "auf 6 leveln", also als das Gegenteil.
 * Wer das befolgt, pusht in einer Reroll-Comp und verliert das Spiel. Ein
 * stiller Fehler wäre hier teurer als eine leere Sektion.
 *
 * Der zweite Block schützt den Fahrplan davor, erfundene Genauigkeit zu zeigen:
 * die oberen Levelschritte stehen auf sehr wenigen Beobachtungen (gemessen 39
 * gegen 1.094 an der Basis derselben Comp) und dürfen nicht wie eine
 * gleichwertige Empfehlung aussehen.
 *
 * Lauf: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { parseLevelling, significantLevelSteps } from './tft-comp-guides.ts';

const step = (level, count) => ({ level, stage: '3', round: '2', count });

test('Reroll und Fast sind gegensätzliche Absichten, nicht dasselbe Level', () => {
  assert.deepEqual(parseLevelling('lvl 6'), { kind: 'reroll', level: 6 });
  assert.deepEqual(parseLevelling('Fast 8'), { kind: 'fast', level: 8 });
  // Der eigentliche Punkt: gleiche Zahl, andere Absicht.
  const a = parseLevelling('lvl 8');
  const b = parseLevelling('Fast 8');
  assert.equal(a.level, b.level);
  assert.notEqual(a.kind, b.kind);
});

test('alle sechs real vorkommenden Kürzel werden erkannt', () => {
  // Stand 2026-08-05 über alle 69 Comps des Bundles: kein weiterer Wert, kein
  // null. Fällt einer hier durch, verschwindet die Zeile für bis zu 19 Comps.
  for (const raw of ['lvl 5', 'lvl 6', 'lvl 7', 'Fast 8', 'Fast 9', 'Standard']) {
    assert.notEqual(parseLevelling(raw), null, `${raw} nicht erkannt`);
  }
  assert.deepEqual(parseLevelling('Standard'), { kind: 'standard' });
});

test('Schreibweise und Abstände sind egal, die Absicht nicht', () => {
  assert.deepEqual(parseLevelling('LVL7'), { kind: 'reroll', level: 7 });
  assert.deepEqual(parseLevelling('  fast   9  '), { kind: 'fast', level: 9 });
});

test('unbekanntes Kürzel gibt null statt einer geratenen Strategie', () => {
  // MetaTFT kann jederzeit etwas Neues einführen. Nichts anzeigen ist richtig,
  // "Level 0 Reroll" oder ein stillschweigendes Standard wäre erfunden.
  for (const raw of ['Slow 8', 'lvl', 'lvl x', '', null, undefined, 'Fast']) {
    assert.equal(parseLevelling(raw), null, `${JSON.stringify(raw)} hätte null geben müssen`);
  }
});

test('Schritte unter 10 % des Peaks fallen weg, der Peak selbst nie', () => {
  const out = significantLevelSteps([step(4, 1000), step(8, 100), step(9, 39)]);
  assert.deepEqual(out.map(s => s.level), [4, 8]);
});

test('Filter ist relativ, nicht absolut', () => {
  // Kleine Comp: 46 Beobachtungen bei Peak 186 sind ein Viertel und bleiben.
  // Eine feste 100er-Grenze hätte sie verworfen.
  assert.deepEqual(
    significantLevelSteps([step(4, 186), step(9, 46)]).map(s => s.level),
    [4, 9],
  );
  // Grosse Comp: 308 bei Peak 7985 sind 3,9 % und fliegen — dieselbe feste
  // Grenze hätte sie behalten.
  assert.deepEqual(
    significantLevelSteps([step(4, 7985), step(10, 308)]).map(s => s.level),
    [4],
  );
});

test('leere, fehlende und zählerlose Eingaben liefern eine leere Liste', () => {
  assert.deepEqual(significantLevelSteps([]), []);
  assert.deepEqual(significantLevelSteps(null), []);
  assert.deepEqual(significantLevelSteps(undefined), []);
  // Peak 0: kein Schritt ist belastbar, also keiner wird gezeigt. Ohne den
  // Guard wäre die Schwelle 0 und jeder Schritt käme durch.
  assert.deepEqual(significantLevelSteps([step(4, 0), step(5, null)]), []);
});

test('Property: Ergebnis ist stets eine Teilmenge in Eingabe-Reihenfolge', () => {
  fc.assert(fc.property(
    fc.array(fc.record({
      level: fc.integer({ min: 1, max: 10 }),
      count: fc.oneof(fc.integer({ min: 0, max: 30000 }), fc.constant(null)),
    }), { maxLength: 12 }),
    (raw) => {
      const levels = raw.map((r, i) => ({ ...r, level: i + 1, stage: '3', round: '2' }));
      const out = significantLevelSteps(levels);
      assert.ok(out.length <= levels.length);
      // Reihenfolge erhalten — die UI zeigt den Fahrplan chronologisch.
      const idx = out.map(s => levels.indexOf(s));
      assert.deepEqual(idx, [...idx].sort((a, b) => a - b));
      // Nie ein Schritt, der nicht in der Eingabe stand.
      for (const s of out) assert.ok(levels.includes(s));
    },
  ), { numRuns: 300 });
});

test('Property: parseLevelling wirft nie und liefert nur gültige Level', () => {
  fc.assert(fc.property(fc.string(), (s) => {
    const out = parseLevelling(s);
    if (out === null) return;
    assert.ok(['reroll', 'fast', 'standard'].includes(out.kind));
    if (out.kind !== 'standard') {
      assert.ok(Number.isInteger(out.level) && out.level > 0, `Level ${out.level} aus ${JSON.stringify(s)}`);
    }
  }), { numRuns: 500 });
});
