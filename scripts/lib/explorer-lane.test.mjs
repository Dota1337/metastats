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

test('Spur: Wartender gibt zum Zeitpunkt auf (503 busy), Platz und Schlange bleiben stimmig', async () => {
  const lane = makeLane(1, 8);
  await lane.acquire();
  const t0 = Date.now();
  const late = lane.acquire({ giveUpAt: t0 + 30 });
  const patient = lane.acquire();
  await assert.rejects(late, e => e.status === 503 && e.message === 'busy' && e.queued === true);
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
  await assert.rejects(lane.acquire({ giveUpAt: Date.now() - 1000 }), e => e.status === 503 && e.queued === true);
  assert.equal(lane.queue.length, 0);
  lane.release();
  assert.equal(lane.running, 0);
});

test('Spur: frueheste Aufgabe zuerst, Gleichstand nach Ankunft, Vorwaermen zuletzt', async () => {
  const lane = makeLane(1, 8);
  await lane.acquire();
  const now = Date.now();
  const order = [];
  const take = (name, opts) => lane.acquire(opts).then(() => { order.push(name); lane.release(); });
  const all = [
    take('warm', { wait: true }),
    take('kurz1', { giveUpAt: now + 30_000 }),
    take('kurz2', { giveUpAt: now + 30_000 }),
    take('lang', { giveUpAt: now + 15_000 }),
    take('kurz3', { giveUpAt: now + 31_000 }),
  ];
  lane.release();
  await Promise.all(all);
  assert.deepEqual(order, ['lang', 'kurz1', 'kurz2', 'kurz3', 'warm']);
  assert.equal(lane.running, 0);
});

test('Spur: kurze hinter langer rechnet nach ihr statt aufzugeben (Szenario 10.10.)', async () => {
  // Massstab 1 s = 10 ms: lang belegt 18 s, kurz kommt nach 1 s, Aufgabe nach 30 s.
  const lane = makeLane(1, 8);
  await lane.acquire();
  const t0 = Date.now();
  setTimeout(() => lane.release(), 180);
  await sleep(10);
  await lane.acquire({ giveUpAt: Date.now() + 300 });
  const waited = Date.now() - t0;
  assert.ok(waited >= 170 && waited < 300, `dran nach ${waited} ms`);
  lane.release();
});
