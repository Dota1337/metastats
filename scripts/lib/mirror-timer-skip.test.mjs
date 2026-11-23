import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTimerStart, parseSkipMinutes, timerSkipDecision } from './mirror-timer-skip.mjs';

const M = 60_000;
const timer = { TRIGGER_UNIT: 'metastats-mirror-mv-pages.timer' };

test('Option lesen', () => {
  assert.equal(parseSkipMinutes(['--group=mv-pages', '--timer-skip-if-fresh=240']), 240);
  assert.equal(parseSkipMinutes(['--group=mv-pages']), null);
  assert.equal(parseSkipMinutes(['--timer-skip-if-fresh=abc']), null);
  assert.equal(parseSkipMinutes(['--timer-skip-if-fresh=0']), null);
});

test('Timer-Start erkennen', () => {
  assert.equal(isTimerStart(timer), true);
  assert.equal(isTimerStart({}), false);
  assert.equal(isTimerStart({ TRIGGER_UNIT: 'metastats-marketvalue-sync.service' }), false);
});

test('auslassen nur, wenn alle frisch und der Timer startet', () => {
  const fresh = [{ name: 'a', ageMs: 130 * M }, { name: 'b', ageMs: 131 * M }];
  assert.equal(timerSkipDecision({ minutes: 240, env: timer, ages: fresh }).skip, true);
  assert.equal(timerSkipDecision({ minutes: 240, env: {}, ages: fresh }).skip, false, 'OnSuccess/Hand');
  assert.equal(timerSkipDecision({ minutes: 240, env: { ...timer, ROUTE_MIRROR_TIMER_SKIP: '0' }, ages: fresh }).skip, false);
  assert.equal(timerSkipDecision({ minutes: null, env: timer, ages: fresh }).skip, false);
  assert.equal(timerSkipDecision({ minutes: 240, env: timer, ages: [fresh[0], { name: 'b', ageMs: 480 * M }] }).skip, false, 'einer alt');
  assert.equal(timerSkipDecision({ minutes: 240, env: timer, ages: [fresh[0], { name: 'b', ageMs: null }] }).skip, false, 'Abruffehler');
  assert.equal(timerSkipDecision({ minutes: 240, env: timer, ages: [{ name: 'a', ageMs: -5 }] }).skip, false, 'Uhr daneben');
  assert.equal(timerSkipDecision({ minutes: 240, env: timer, ages: [] }).skip, false);
  assert.equal(timerSkipDecision({ minutes: 240, env: timer, ages: [{ name: 'a', ageMs: 240 * M }] }).skip, false, 'Grenze');
});
