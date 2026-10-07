import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsertBatches, isRetriable } from './supabase-upsert.mjs';

// Uhr und Pausen laufen kuenstlich: sleep schiebt nur die Uhr vor.
function harness(responses, { deadline = Infinity } = {}) {
  let t = 0;
  const calls = [];
  const sleeps = [];
  const logs = [];
  const queue = [...responses];
  return {
    calls, sleeps, logs,
    opts: {
      url: 'https://x.supabase.co', key: 'k', table: 'tbl', onConflict: 'a,b',
      deadline,
      log: (m) => logs.push(m),
      now: () => t,
      sleep: async (ms) => { sleeps.push(ms); t += ms; },
      fetchImpl: async (endpoint, init) => {
        calls.push({ endpoint, rows: JSON.parse(init.body).length, init });
        const next = queue.shift();
        if (typeof next === 'function') return next();
        return next;
      },
    },
  };
}

const ok = () => ({ ok: true, status: 201, text: async () => '' });
const http = (status, body = '') => ({ ok: false, status, text: async () => body });
const timeout = () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); };
const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));

test('teilt in 200er-Pakete und setzt Upsert-Kopfzeilen', async () => {
  const h = harness([ok(), ok(), ok()]);
  const out = await upsertBatches({ ...h.opts, rows: rows(450) });
  assert.deepEqual(h.calls.map((c) => c.rows), [200, 200, 50]);
  assert.equal(h.calls[0].endpoint, 'https://x.supabase.co/rest/v1/tbl?on_conflict=a,b');
  assert.equal(h.calls[0].init.headers.Prefer, 'resolution=merge-duplicates,return=minimal');
  assert.deepEqual(out, { batches: 3, retries: 0 });
});

test('Timeout, dann Erfolg: Paket wird nach 30 s wiederholt', async () => {
  const h = harness([timeout, ok()]);
  const out = await upsertBatches({ ...h.opts, rows: rows(10) });
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.sleeps, [30_000]);
  assert.equal(out.retries, 1);
  assert.match(h.logs.join('\n'), /Paket 1\/1: The operation was aborted due to timeout .*Versuch 2 in 30 s/);
  assert.match(h.logs.join('\n'), /angekommen im Versuch 2/);
});

test('fuenfmal 503: nach 4 Versuchen Abbruch mit HTTP-Text', async () => {
  const h = harness([http(503), http(503), http(503), http(503), http(503)]);
  await assert.rejects(upsertBatches({ ...h.opts, rows: rows(10) }),
    /Supabase upsert tbl failed: HTTP 503.*4 Versuche/);
  assert.equal(h.calls.length, 4);
  assert.deepEqual(h.sleeps, [30_000, 60_000, 120_000]);
});

test('400 bricht sofort ab, ohne Pause', async () => {
  const h = harness([http(400, '{"message":"bad column"}')]);
  await assert.rejects(upsertBatches({ ...h.opts, rows: rows(10) }), /HTTP 400 \{"message":"bad column"\}/);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.sleeps, []);
});

test('fehlende Tabelle bleibt am Text erkennbar', async () => {
  const h = harness([http(404, '{"message":"relation \\"public.tbl\\" does not exist"}')]);
  await assert.rejects(upsertBatches({ ...h.opts, rows: rows(10) }),
    (err) => /relation .* does not exist/i.test(err.message));
  assert.equal(h.calls.length, 1);
});

test('Frist: endet mit Zahl der uebertragenen Pakete statt weiter zu warten', async () => {
  const h = harness([ok(), http(503), http(503)], { deadline: 45_000 });
  await assert.rejects(upsertBatches({ ...h.opts, rows: rows(450) }),
    /Frist abgelaufen: tbl 1 von 3 Paketen uebertragen \(zuletzt HTTP 503\)/);
  // erste Pause (30 s) passt noch, die zweite (60 s) nicht mehr
  assert.deepEqual(h.sleeps, [30_000]);
  assert.equal(h.calls.length, 3);
});

test('isRetriable: Netzfehler ja, Programmfehler nein', () => {
  assert.equal(isRetriable(new TypeError('fetch failed')), true);
  assert.equal(isRetriable(Object.assign(new Error('x'), { cause: { code: 'ECONNRESET' } })), true);
  assert.equal(isRetriable(Object.assign(new Error('x'), { status: 429 })), true);
  assert.equal(isRetriable(Object.assign(new Error('x'), { status: 409 })), false);
  assert.equal(isRetriable(new TypeError('rows.slice is not a function')), false);
});
