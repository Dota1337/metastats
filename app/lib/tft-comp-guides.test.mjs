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
import {
  parseLevelling, significantLevelSteps, augmentRowsByRarity, AUGMENTS_PER_RARITY,
  resolveGuideId, guideStyleFromUnits,
} from './tft-comp-guides.ts';

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

// ── Augment-Reihen nach Rarity ──────────────────────────────────────────────
// Die Comp-Seite zeigt Prismatisch → Gold → Silber. Vorher lief die Kappung vor
// der Rarity-Zuordnung, und weil MetaTFT Silber zuerst liefert, blieben von
// 12 Plätzen fast nur Silber-Augments übrig.

const bundle = (entries) => ({ augments: Object.fromEntries(entries.map(([id, tier]) => [id, { tier }])) });
const guideOf = (augments) => ({ augments });

test('Reihenfolge ist Prismatisch, Gold, Silber — unabhängig von der Quellreihenfolge', () => {
  const rows = augmentRowsByRarity(guideOf(['s1', 'g1', 'p1']), bundle([['s1', 1], ['g1', 2], ['p1', 3]]));
  assert.deepEqual(rows.map(r => r.rarity), [3, 2, 1]);
});

test('jede Reihe ist gekappt, die Reihenfolge darin bleibt erhalten', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `s${i}`);
  const rows = augmentRowsByRarity(guideOf(ids), bundle(ids.map(id => [id, 1])));
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].augments, ids.slice(0, AUGMENTS_PER_RARITY));
});

test('Augments ohne Bundle-Eintrag verdrängen keinen Platz', () => {
  const ids = ['x0', 'x1', ...Array.from({ length: 8 }, (_, i) => `g${i}`)];
  const rows = augmentRowsByRarity(guideOf(ids), bundle(ids.filter(id => id[0] === 'g').map(id => [id, 2])));
  assert.deepEqual(rows[0].augments, ids.slice(2));
});

test('unbekannte Rarity fällt weg, leere Reihen erscheinen nicht', () => {
  const rows = augmentRowsByRarity(guideOf(['a', 'b', 'c']), bundle([['a', 0], ['b', 4], ['c', 2]]));
  assert.deepEqual(rows, [{ rarity: 2, augments: ['c'] }]);
});

test('ohne Asset-Bundle keine Reihen statt geratener Rarity', () => {
  assert.deepEqual(augmentRowsByRarity(guideOf(['a']), null), []);
  assert.deepEqual(augmentRowsByRarity(guideOf([]), bundle([['a', 1]])), []);
});

// ── Zuordnung zur MetaTFT-Comp nach Spielweise ──────────────────────────────
// Nachgestellt ist der Azir-Fall vom 2026-10-10: unsere Reroll-Comp
// ueberlappt mit einer Fast-8-Comp zu 0,7 und mit der Reroll-Comp nur zu 0,6.
const own = ['Azir', 'U1', 'U2', 'U3', 'U4', 'U5', 'U6'];
const fastUnits = [...own, 'X1', 'X2', 'X3'];                          // Jaccard 7/10 = 0,7
const rerollUnits = ['Azir', 'U1', 'U2', 'U3', 'U4', 'U5', 'Y1', 'Y2', 'Y3']; // Jaccard 6/10 = 0,6
const stars = share3 => ({ carryStars: { Azir: [{ star: 2, pcnt: 1 - share3 }, { star: 3, pcnt: share3 }] } });
const guides = (familyMap = {}, details = { fast: stars(0.04), reroll: stars(0.68) }) => ({
  familyMap,
  comps: [{ id: 'fast', units: fastUnits, games: 900 }, { id: 'reroll', units: rerollUnits, games: 500 }],
  details,
});
const style = share => ({ carry: 'Azir', star3Share: share });

test('ohne Spielweise gilt die alte Regel: beste Ueberlappung ab 0,7', () => {
  assert.equal(resolveGuideId(guides(), [], own, ['Azir']), 'fast');
});

test('Reroll gegen Push schliesst aus, beide Reroll reicht ab 0,5', () => {
  assert.equal(resolveGuideId(guides(), [], own, ['Azir'], style(0.51)), 'reroll');
});

test('unsere Push-Comp bekommt keine Reroll-Anleitung', () => {
  assert.equal(resolveGuideId(guides(), [], own, ['Azir'], style(0.05)), 'fast');
});

test('zwischen den Grenzen bleibt es bei der alten Regel', () => {
  assert.equal(resolveGuideId(guides(), [], own, ['Azir'], style(0.3)), 'fast');
});

test('beide Push (4/5-Kosten-Carry): keine gelockerte Schwelle', () => {
  const g = guides({}, { fast: stars(0.02), reroll: stars(0.03) });
  assert.equal(resolveGuideId(g, [], own, ['Azir'], style(0.02)), 'fast');
});

test('ohne Sterndaten der Anleitung bleibt die Spielweise neutral', () => {
  assert.equal(resolveGuideId(guides({}, {}), [], own, ['Azir'], style(0.51)), 'fast');
});

test('Familien-Map gewinnt bei Einigkeit schon ab 0,5 vor besserer Ueberlappung', () => {
  const g = guides({ 'T__Azir': 'reroll' }, { fast: stars(0.6), reroll: stars(0.68) });
  assert.equal(resolveGuideId(g, ['T__Azir'], own, ['Azir'], style(0.51)), 'reroll');
  assert.equal(resolveGuideId(g, ['T__Azir'], own, ['Azir']), 'fast');
});

test('guideStyleFromUnits: Anteil des Key-Carrys, null bei zu wenig Spielen oder fehlenden Feldern', () => {
  const units = [{ characterId: 'Azir', gamesWithUnit: 5628, star3Games: 2862 }, { characterId: 'Few', gamesWithUnit: 29, star3Games: 20 }];
  assert.deepEqual(guideStyleFromUnits('Azir', units), { carry: 'Azir', star3Share: 2862 / 5628 });
  assert.equal(guideStyleFromUnits('Few', units), null);
  assert.equal(guideStyleFromUnits('Missing', units), null);
  assert.equal(guideStyleFromUnits('Azir', [{ characterId: 'Azir' }]), null);
  assert.equal(guideStyleFromUnits(null, units), null);
});
