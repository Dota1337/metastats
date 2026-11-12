// Vertrag gh-workflow-fresh (github/fehler-melder): Totmann fuer den
// Fehler-Melder. Nur die reine Bewertung; der Abruf laeuft live
// (node scripts/check-contracts.mjs --id github/fehler-melder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateGhWorkflowFresh } from './contracts.mjs';
import { cronsOf, DISPATCH } from '../gh-dispatch-due.mjs';

const NOW = Date.parse('2026-11-12T14:00:00Z');
const at = (min) => new Date(NOW - min * 60_000).toISOString();
const r = (conclusion, min) => ({ status: 'completed', conclusion, created_at: at(min + 1), updated_at: at(min) });

test('juengster Lauf erfolgreich und frisch: gruen', () => {
  const v = evaluateGhWorkflowFresh({ runs: [r('success', 12), r('failure', 30)], now: NOW, maxAgeHours: 2 });
  assert.equal(v.status, 'ok');
});

test('abgebrochene Laeufe zaehlen nicht (concurrency ersetzt wartende)', () => {
  const v = evaluateGhWorkflowFresh({ runs: [r('cancelled', 1), r('skipped', 2), r('success', 20)], now: NOW, maxAgeHours: 2 });
  assert.equal(v.status, 'ok');
  assert.equal(evaluateGhWorkflowFresh({ runs: [r('cancelled', 1), r('failure', 20)], now: NOW, maxAgeHours: 2 }).status, 'broken');
});

test('letzter Lauf rot, zu alt oder keiner: rot, Text ohne wechselnde Einheit', () => {
  const red = evaluateGhWorkflowFresh({ runs: [r('failure', 5), r('success', 20)], now: NOW, maxAgeHours: 2 });
  assert.equal(red.status, 'broken');
  assert.match(red.detail, /failure/);
  const old = evaluateGhWorkflowFresh({ runs: [r('success', 3 * 60)], now: NOW, maxAgeHours: 2 });
  assert.equal(old.status, 'broken');
  assert.match(old.detail, /vor 3 h \(max 2 h\)/);
  const older = evaluateGhWorkflowFresh({ runs: [r('success', 30 * 60)], now: NOW, maxAgeHours: 2 });
  assert.equal(older.detail.replace(/\d+/g, '#'), old.detail.replace(/\d+/g, '#'), 'gleicher Grund = keine neue Mail');
  assert.equal(evaluateGhWorkflowFresh({ runs: [], now: NOW, maxAgeHours: 2 }).status, 'broken');
  assert.equal(evaluateGhWorkflowFresh({ runs: undefined, now: NOW, maxAgeHours: 2 }).status, 'broken');
  assert.equal(evaluateGhWorkflowFresh({ runs: [], now: NOW }).status, 'error');
});

test('Vertrag im Register passt zum Workflow und zum Box-Anstoss', () => {
  const reg = JSON.parse(readFileSync(new URL('../../infra/contracts.json', import.meta.url), 'utf8'));
  const c = (reg.contracts || reg).find((x) => x.id === 'github/fehler-melder');
  assert.ok(c, 'github/fehler-melder fehlt');
  assert.equal(c.type, 'gh-workflow-fresh');
  assert.equal(c.workflow, 'failure-watch.yml');
  assert.equal(c.owner, '.github/workflows/failure-watch.yml');
  assert.equal(c.maxAgeHours, 2);
  const yml = readFileSync(new URL('../../.github/workflows/failure-watch.yml', import.meta.url), 'utf8');
  assert.deepEqual(cronsOf(yml), ['*/15 * * * *']);
  assert.ok('failure-watch.yml' in DISPATCH, 'Box stoesst den Melder nicht an');
});
