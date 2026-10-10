import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, layoutFor, type PolicyInput } from './window-policy.ts';

const base: PolicyInput = {
  trigger: 'click', mode: 'auto', monitors: 1, inTft: false, gameFocused: true,
  mainVisible: false, overlayVisible: false, autoMove: true, startWithClient: true,
  popupOnEnd: true, wasTft: true, coldStart: true, handled: false, userShown: false,
};
const run = (p: Partial<PolicyInput>) => decide({ ...base, ...p }).steps;

test('layoutFor: auto = zweiter Bildschirm oder Overlay, unbekannt = 1', () => {
  assert.equal(layoutFor('auto', 2), 'second');
  assert.equal(layoutFor('auto', 3), 'second');
  assert.equal(layoutFor('auto', 1), 'overlay');
  assert.equal(layoutFor('auto', null), 'overlay');
  assert.equal(layoutFor('overlay', 3), 'overlay');
  assert.equal(layoutFor('desktop', 2), 'second');
  assert.equal(layoutFor('desktop', 1), 'desktop1');
  assert.equal(layoutFor('desktop', null), 'desktop1');
});

test('Klick ohne Spiel: Hauptfenster mit Fokus, in jedem Modus', () => {
  for (const mode of ['auto', 'overlay', 'desktop'] as const) {
    for (const monitors of [1, 2, null]) {
      assert.deepEqual(run({ mode, monitors }), [{ op: 'main-show', focus: true, move: false }], `${mode}/${monitors}`);
    }
  }
});

test('Klick im Spiel: zweiter Bildschirm ohne Fokus, sonst Overlay bzw. nach vorn', () => {
  const g = { inTft: true };
  assert.deepEqual(run({ ...g, mode: 'auto', monitors: 2 }), [{ op: 'main-show', focus: false, move: true }]);
  assert.deepEqual(run({ ...g, mode: 'auto', monitors: 2, autoMove: false }), [{ op: 'main-show', focus: false, move: false }]);
  assert.deepEqual(run({ ...g, mode: 'desktop', monitors: 2 }), [{ op: 'main-show', focus: false, move: true }]);
  assert.deepEqual(run({ ...g, mode: 'auto', monitors: 1 }), [{ op: 'overlay-show' }]);
  assert.deepEqual(run({ ...g, mode: 'overlay', monitors: 3 }), [{ op: 'overlay-show' }]);
  assert.deepEqual(run({ ...g, mode: 'desktop', monitors: 1 }), [{ op: 'main-show', focus: false, move: false }]);
});

test('Klick im Spiel ohne Spiel-Fokus: Desktop-Fenster mit Fokus', () => {
  assert.deepEqual(run({ inTft: true, gameFocused: false, mode: 'auto', monitors: 1 }), [{ op: 'main-show', focus: true, move: false }]);
  assert.deepEqual(run({ inTft: true, gameFocused: false, mode: 'overlay', monitors: 2 }), [{ op: 'main-show', focus: true, move: false }]);
});

test('Unbekannte Herkunft: nur ohne Spiel, ohne Fokus', () => {
  assert.deepEqual(run({ trigger: 'unknown' }), [{ op: 'main-show', focus: false, move: false }]);
  assert.deepEqual(run({ trigger: 'unknown', inTft: true }), []);
});

test('Client-Start: nur Kaltstart, Schalter an, kein Spiel', () => {
  assert.deepEqual(run({ trigger: 'client' }), [{ op: 'main-show', focus: false, move: false }]);
  assert.deepEqual(run({ trigger: 'client', startWithClient: false }), []);
  assert.deepEqual(run({ trigger: 'client', coldStart: false }), []);
  assert.deepEqual(run({ trigger: 'client', inTft: true }), []);
});

test('Spielstart: Umzug auf zweiten Bildschirm, sonst minimieren', () => {
  const g = { trigger: 'game-start' as const, inTft: true };
  assert.deepEqual(run({ ...g, monitors: 2 }), [{ op: 'main-show', focus: false, move: true }]);
  assert.deepEqual(run({ ...g, monitors: 2, autoMove: false }), [{ op: 'main-park' }]);
  assert.deepEqual(run({ ...g, monitors: 1 }), [{ op: 'main-minimize' }]);
  assert.deepEqual(run({ ...g, mode: 'overlay', monitors: 2 }), [{ op: 'main-minimize' }]);
  assert.deepEqual(run({ ...g, mode: 'desktop', monitors: 1 }), [{ op: 'main-minimize' }]);
  assert.deepEqual(run({ ...g, monitors: 1, userShown: true }), []);
  // Neustart der App mitten in der Partie: kein zweiter Umzug.
  assert.deepEqual(run({ ...g, monitors: 2, handled: true }), []);
});

test('Alt+D: ohne Spiel ein/aus mit Fokus; im Spiel je nach Lage', () => {
  const k = { trigger: 'hotkey' as const };
  assert.deepEqual(run({ ...k }), [{ op: 'main-show', focus: true, move: false }]);
  assert.deepEqual(run({ ...k, mainVisible: true }), [{ op: 'main-minimize' }]);
  const g = { ...k, inTft: true };
  assert.deepEqual(run({ ...g, monitors: 1 }), [{ op: 'overlay-show' }]);
  assert.deepEqual(run({ ...g, monitors: 1, overlayVisible: true }), [{ op: 'overlay-close' }]);
  assert.deepEqual(run({ ...g, monitors: 2 }), [{ op: 'main-show', focus: false, move: true }]);
  assert.deepEqual(run({ ...g, monitors: 2, mainVisible: true }), [{ op: 'main-minimize' }]);
  assert.deepEqual(run({ ...g, mode: 'desktop', monitors: 1 }), [{ op: 'main-show', focus: false, move: false }]);
  assert.deepEqual(run({ ...g, mode: 'desktop', monitors: 1, mainVisible: true }), [{ op: 'main-minimize' }]);
});

test('Spielende: Overlay zu, Popup nur nach echter TFT-Partie', () => {
  const e = { trigger: 'game-end' as const };
  assert.deepEqual(run({ ...e }), [{ op: 'main-show', focus: false, move: false }]);
  assert.deepEqual(run({ ...e, overlayVisible: true }), [{ op: 'overlay-close' }, { op: 'main-show', focus: false, move: false }]);
  assert.deepEqual(run({ ...e, wasTft: false }), []);
  assert.deepEqual(run({ ...e, popupOnEnd: false, overlayVisible: true }), [{ op: 'overlay-close' }]);
});

test('Fokus im Spiel nie von selbst', () => {
  for (const trigger of ['game-start', 'hotkey', 'game-end', 'unknown', 'client'] as const) {
    for (const mode of ['auto', 'overlay', 'desktop'] as const) {
      for (const monitors of [1, 2, null]) {
        for (const mainVisible of [false, true]) {
          const steps = run({ trigger, mode, monitors, mainVisible, inTft: true });
          assert.ok(steps.every(s => s.op !== 'main-show' || !s.focus), `${trigger}/${mode}/${monitors}/${mainVisible}`);
        }
      }
    }
  }
});
