import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideIssue, failedSteps, findingsOf } from './tft-data-refresh-report.mjs';

const base = { ran: true, failures: [], findings: [], alarm: null, previousConclusion: 'success', openIssue: null, lastMark: null };

test('sauberer Lauf schliesst, leerer Lauf nicht', () => {
  assert.equal(decideIssue(base).action, 'none');
  assert.equal(decideIssue({ ...base, openIssue: 7 }).action, 'close');
  assert.equal(decideIssue({ ...base, ran: false, openIssue: 7 }).action, 'none');
});

test('Fehlschlag: erst beim zweiten Mal, und er schliesst nichts', () => {
  const failures = ['Schritt bundle fehlgeschlagen'];
  assert.equal(decideIssue({ ...base, failures }).action, 'none');
  assert.equal(decideIssue({ ...base, failures, openIssue: 7 }).action, 'none');
  assert.equal(decideIssue({ ...base, failures, previousConclusion: 'failure' }).action, 'create');
});

test('Befund und Alarm sofort, gleicher Befund nur einmal', () => {
  const first = decideIssue({ ...base, findings: ['a', 'b'] });
  assert.equal(first.action, 'create');
  const again = decideIssue({ ...base, findings: ['b', 'a'], openIssue: 7, lastMark: first.mark });
  assert.equal(again.action, 'none');
  assert.equal(decideIssue({ ...base, findings: ['a', 'c'], openIssue: 7, lastMark: first.mark }).action, 'comment');
  assert.equal(decideIssue({ ...base, ran: false, alarm: 'Patch' }).action, 'create');
});

test('Alarm verhindert das Schliessen', () => {
  assert.notEqual(decideIssue({ ...base, alarm: 'Patch', openIssue: 7 }).action, 'close');
});

test('Melder-Befund ist kein Fehlschlag, Melder-Fehler schon', () => {
  const steps = { bundle: { outcome: 'failure' }, melder: { outcome: 'failure' }, tiers: { outcome: 'success' }, unitinfo: { outcome: 'skipped' } };
  assert.deepEqual(failedSteps(steps, 'BEFUND x'), ['Schritt bundle fehlgeschlagen']);
  assert.deepEqual(failedSteps({}, 'FAIL: Netz'), ['Melder fehlgeschlagen']);
  assert.deepEqual(findingsOf('Patch 18.5: 1\nBEFUND 18.5 · Unit X\n'), ['18.5 · Unit X']);
});
