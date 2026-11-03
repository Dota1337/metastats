import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUnitTimeline } from './tft-unit-history.ts';

const P = (patch, first_day, last_day) => ({ patch, first_day, last_day });
const row = (key, games, sum_placement, top4, participants) => ({ key, games, sum_placement, top4, participants });

const NEW = P('18.5c', '2026-10-28', '2026-11-02');
const MID = P('18.5b', '2026-10-22', '2026-10-27');
const OLD = P('18.4', '2026-10-07', '2026-10-20');

test('Verlauf: je Patch ein Punkt, aelteste links', () => {
  const { timeline, missing } = buildUnitTimeline('A', [NEW, MID, OLD], [
    [row('A', 100, 400, 60, 1000), row('B', 50, 200, 25, 1000)],
    [row('A', 200, 900, 90, 2000)],
    [row('A', 400, 1600, 240, 8000)],
  ]);
  assert.equal(missing, false);
  assert.deepEqual(timeline.map(t => t.patch), ['18.4', '18.5b', '18.5c']);
  const last = timeline[2];
  assert.equal(last.games, 100);
  assert.equal(last.avgPlacement, 4);
  assert.equal(last.top4Rate, 0.6);
  assert.equal(last.pickRate, 0.1);
  assert.equal(last.firstDay, '2026-10-28');
  assert.equal(last.lastDay, '2026-11-02');
});

test('Verlauf: nicht lesbarer Patch meldet Luecke, die anderen bleiben', () => {
  const { timeline, missing } = buildUnitTimeline('A', [NEW, MID], [[row('A', 100, 400, 60, 1000)], null]);
  assert.equal(missing, true);
  assert.deepEqual(timeline.map(t => t.patch), ['18.5c']);
});

test('Verlauf: unter 30 Spielen kein Punkt, aber auch keine Luecke', () => {
  const { timeline, missing } = buildUnitTimeline('A', [NEW, MID, OLD], [
    [row('A', 29, 100, 10, 1000)],
    [row('A', 30, 120, 15, 1000)],
    [row('B', 500, 2000, 250, 1000)],
  ]);
  assert.equal(missing, false);
  assert.deepEqual(timeline.map(t => t.patch), ['18.5b']);
});

test('Verlauf: ohne Teilnehmerzahl keine Pickrate', () => {
  const { timeline } = buildUnitTimeline('A', [NEW], [[row('A', 100, 400, 60, 0)]]);
  assert.equal(timeline[0].pickRate, null);
});
