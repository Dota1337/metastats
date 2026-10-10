import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLane } from './explorer-lane.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

test('Spur: freier Platz sofort, voll → 503, Vorwaermen stellt sich trotzdem an', async () => {
  const lane = makeLane(1, 1);
  await lane.acquire();
  assert.equal(lane.running, 1);
  const queued = lane.acquire();
  assert.throws(() => lane.acquire(), e => e.status === 503 && e.message === 'busy');
  const warm = lane.acquire({ wait: true });
  assert.equal(lane.queue.length, 2);
  lane.release();
  await queued;
  lane.release();
  await warm;
  lane.release();
  assert.equal(lane.running, 0);
  assert.equal(lane.queue.length, 0);
});

test('Spur: Wartender gibt zum Zeitpunkt auf (504), Platz und Schlange bleiben stimmig', async () => {
  const lane = makeLane(1, 8);
  await lane.acquire();
  const t0 = Date.now();
  const late = lane.acquire({ giveUpAt: t0 + 30 });
  const patient = lane.acquire();
  await assert.rejects(late, e => e.status === 504 && e.message === 'timeout' && e.queued === true);
  assert.ok(Date.now() - t0 >= 25, 'nicht vor dem Zeitpunkt');
  assert.equal(lane.queue.length, 1, 'nur der Aufgebende ist raus');
  lane.release();
  await patient;
  assert.equal(lane.running, 1);
  lane.release();
  assert.equal(lane.running, 0);
});

test('Spur: wer vor dem Zeitpunkt drankommt, wird spaeter nicht mehr abgewiesen', async () => {
  const lane = makeLane(1, 8);
  await lane.acquire();
  let rejected = false;
  const w = lane.acquire({ giveUpAt: Date.now() + 40 });
  w.catch(() => { rejected = true; });
  lane.release();
  await w;
  await sleep(60);
  assert.equal(rejected, false);
  assert.equal(lane.running, 1);
  lane.release();
});

test('Spur: Zeitpunkt schon vorbei → Aufgabe ohne Platz', async () => {
  const lane = makeLane(1, 8);
  await lane.acquire();
  await assert.rejects(lane.acquire({ giveUpAt: Date.now() - 1000 }), e => e.status === 504);
  assert.equal(lane.queue.length, 0);
  lane.release();
  assert.equal(lane.running, 0);
});
