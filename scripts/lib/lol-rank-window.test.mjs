import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  pickRankWindow, RANK_IDS_EARLY, RANK_IDS_NEWEST, RANK_NEWEST_MIN_AGE_S, RANK_FALLBACK_S,
} from './lol-rank-window.mjs';

const newest = { major: 16, minor: 22 };
const prev = { major: 16, minor: 21 };
const NOW = Date.parse('2026-11-08T19:30:00Z') / 1000;
const P22 = Date.parse('2026-11-04T06:36:07Z') / 1000;   // erstes 16.22-Spiel der Rohablage
const P21 = Date.parse('2026-10-21T06:15:00Z') / 1000;

test('neuester Patch alt genug: nur er, 100 je Spieler', () => {
  const w = pickRankWindow({ newest, prev, newestStart: P22, prevStart: P21, nowSec: NOW });
  assert.deepEqual(w, { startTime: P22, count: 100, patch: '16.22', onlyNewest: true });
});

test('neuester Patch jünger als 24 h: genau das alte Verhalten', () => {
  const young = NOW - RANK_NEWEST_MIN_AGE_S + 60;
  const w = pickRankWindow({ newest, prev, newestStart: young, prevStart: P21, nowSec: NOW });
  assert.deepEqual(w, { startTime: P21, count: 20, patch: '16.21', onlyNewest: false });
  // Grenze: genau 24 h → umschalten
  assert.equal(pickRankWindow({ newest, prev, newestStart: NOW - RANK_NEWEST_MIN_AGE_S, prevStart: P21, nowSec: NOW }).count, 100);
});

test('keine Zeilen, 0, Zukunft oder kaputter Wert: Rueckfall auf Vorpatch, dann jetzt − 28 Tage', () => {
  for (const bad of [null, 0, Number(null), NaN, NOW + 3600]) {
    const w = pickRankWindow({ newest, prev, newestStart: bad, prevStart: P21, nowSec: NOW });
    assert.equal(w.startTime, P21, String(bad));
    assert.equal(w.count, RANK_IDS_EARLY);
  }
  const empty = pickRankWindow({ newest, prev, newestStart: null, prevStart: null, nowSec: NOW });
  assert.equal(empty.startTime, NOW - RANK_FALLBACK_S);
  assert.equal(pickRankWindow({ newest: null, prev, newestStart: P22, prevStart: P21, nowSec: NOW }).count, 20);
});

test('nie mehr als Riots Maximum 100', () => {
  assert.ok(RANK_IDS_NEWEST <= 100 && RANK_IDS_EARLY <= 100);
});

test('Sammler nutzt das Fenster: count und startTime aus pickRankWindow, je Zyklus neu', () => {
  const src = readFileSync(new URL('../collect-lol-matches.mjs', import.meta.url), 'utf8');
  assert.match(src, /startTime=\$\{rankWindow\.startTime\}&count=\$\{rankWindow\.count\}/);
  assert.doesNotMatch(src, /RANK_IDS_PER_PLAYER/);
  assert.match(src, /async function rankCycle\(budget\) \{[\s\S]{0,400}await loadRankWindow\(\)/);
});
