// Tests der Prompt-Deutung (Runde 10, Sicherheitsdurchsicht 24.10.2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isApprovalPrompt, isTrivialPrompt, isNewTopic, isMachinePrompt } from './prompt-words.mjs';

test('freigabe-aus-rueckfrage: Rueckfragen und Vorbehalte sind keine Freigabe', () => {
  for (const p of ['go', 'Go', 'ok', 'Passt', 'Ja und go', 'Go B', 'Go Freigabe', 'Code: ja', 'passt, los', 'go + server']) {
    assert.equal(isApprovalPrompt(p), true, p);
  }
  for (const p of [
    'Ok, aber mach X anders', 'ja, jedoch ohne Tabelle', 'Ist das okay?', 'ok?', 'go — allerdings nur A',
    'mach weiter', 'Code: etwas voellig anderes', `ok ${'x'.repeat(130)}`, 'yes but later',
  ]) assert.equal(isApprovalPrompt(p), false, p);
});

test('freigabe-aus-rueckfrage: Trivial nur als Aussage, nicht als Frage oder verneint', () => {
  for (const p of ['trivial', 'Code: trivial', 'spot-fix', 'Code: spotfix, Tippfehler in der Fusszeile']) {
    assert.equal(isTrivialPrompt(p), true, p);
  }
  for (const p of [
    'Ist das trivial?', 'das ist nicht trivial', 'Code: kein Spot-Fix, bitte mit Review', 'not trivial',
    'trivial, aber bitte mit Review', 'Das ist nicht so trivial', `trivial ${'x'.repeat(130)}`,
  ]) assert.equal(isTrivialPrompt(p), false, p);
});

test('trivial-marker-ohne-laengengrenze: zusaetzliche Marker gelten nur mit denselben Grenzen', () => {
  const extra = [/\btypo\b/i];
  assert.equal(isTrivialPrompt('Code: typo im Footer', extra), true);
  assert.equal(isTrivialPrompt(`Code: Baue die Seite neu, ${'und noch viel mehr '.repeat(10)} — kein typo`, extra), false);
  assert.equal(isTrivialPrompt('Code: no typo here, rebuild the cache', extra), false);
  assert.equal(isTrivialPrompt('Code: typo im Footer', []), false);
});

test('Themenwechsel und Maschinen-Meldungen', () => {
  assert.equal(isNewTopic('Code: x'), true);
  assert.equal(isNewTopic('  code : x'), true);
  assert.equal(isNewTopic('Kein Code'), false);
  assert.equal(isMachinePrompt('<task-notification>trivial</task-notification>'), true);
  assert.equal(isMachinePrompt('trivial'), false);
});
