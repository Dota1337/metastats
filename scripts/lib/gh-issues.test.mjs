// GitHub-Zugang (scripts/lib/gh-issues.mjs): neue Versuche nach Methode.
// Plan 24.11.2026 (.claude/plan-current.md). Fehlerformen von Node-fetch lokal
// gemessen (v22): Name unbekannt → cause.code ENOTFOUND, Port zu → ECONNREFUSED
// (bei localhost als AggregateError), eigene Frist → TimeoutError ohne cause.
// Die letzten beiden Faelle laufen gegen echte Sockets auf 127.0.0.1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { makeGh, retryable } from './gh-issues.mjs';

// Bewusst gleichfoermig: ein zufaellig aussehender Wert loest die
// Geheimnis-Suche aus (generic-api-key, Lauf 45371394196).
const TOKEN = 'testtesttesttesttest';

const json = (status, data = {}) => new Response(status === 204 ? null : JSON.stringify(data), { status });
const netErr = (code, message = 'fetch failed') => new TypeError(message, { cause: Object.assign(new Error(code), { code }) });
const timeoutErr = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');

// fetchImpl aus einer Liste von Antworten/Fehlern; zaehlt Aufrufe und Signale.
function scripted(steps) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts, abortedAtCall: opts.signal.aborted });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step instanceof Error || step instanceof DOMException) throw step;
    return typeof step === 'function' ? step() : step;
  };
  return { fetchImpl, calls };
}

function client(fetchImpl, extra = {}) {
  const pauses = [];
  const lines = [];
  const gh = makeGh({
    repo: 'o/r', token: TOKEN, fetchImpl,
    sleep: async (ms) => { pauses.push(ms); },
    log: (l) => lines.push(l),
    ...extra,
  });
  return { gh, pauses, lines };
}

test('GET: Netzfehler, dann Erfolg', async () => {
  const { fetchImpl, calls } = scripted([netErr('ECONNRESET'), json(200, { ok: 1 })]);
  const { gh, pauses, lines } = client(fetchImpl);
  assert.deepEqual(await gh('GET', '/x'), { ok: 1 });
  assert.equal(calls.length, 2);
  assert.deepEqual(pauses, [3_000]);
  assert.match(lines[0], /^GitHub GET \/x: fetch failed \(ECONNRESET\), neuer Versuch 2\/3 in 3 s$/);
});

test('GET: 502, dann Erfolg; 500/503/504 ebenso wiederholt', async () => {
  for (const status of [500, 502, 503, 504]) {
    const { fetchImpl, calls } = scripted([json(status), json(200, [1])]);
    const { gh } = client(fetchImpl);
    assert.deepEqual(await gh('GET', '/x'), [1]);
    assert.equal(calls.length, 2, `HTTP ${status}`);
  }
});

test('GET: dreimal 503 wirft den letzten Fehler im alten Wortlaut', async () => {
  const { fetchImpl, calls } = scripted([json(503)]);
  const { gh, pauses } = client(fetchImpl);
  await assert.rejects(gh('GET', '/actions/jobs/1/logs', null, { text: true }), { message: 'GitHub GET /actions/jobs/1/logs → HTTP 503' });
  assert.equal(calls.length, 3);
  assert.deepEqual(pauses, [3_000, 10_000]);
});

test('GET: Abbruch beim Lesen der Antwort zaehlt zum Versuch', async () => {
  const broken = () => ({ ok: true, status: 200, json: async () => { throw netErr('UND_ERR_SOCKET', 'terminated'); } });
  const { fetchImpl, calls } = scripted([broken, json(200, { ok: 2 })]);
  const { gh } = client(fetchImpl);
  assert.deepEqual(await gh('GET', '/x'), { ok: 2 });
  assert.equal(calls.length, 2);
});

test('GET: eigene Frist wird wiederholt, Fehler ohne Code (bad port, kaputtes JSON) nicht', async () => {
  let r = scripted([timeoutErr(), json(200, {})]);
  await client(r.fetchImpl).gh('GET', '/x');
  assert.equal(r.calls.length, 2);

  r = scripted([new TypeError('fetch failed', { cause: new Error('bad port') })]);
  await assert.rejects(client(r.fetchImpl).gh('GET', '/x'), /fetch failed/);
  assert.equal(r.calls.length, 1);

  r = scripted([new Response('{kaputt', { status: 200 })]);
  await assert.rejects(client(r.fetchImpl).gh('GET', '/x'), /GitHub GET \/x →/);
  assert.equal(r.calls.length, 1);
});

test('erlaubter Status kommt ohne neuen Versuch zurueck, 401/404 ohne allow werden nicht wiederholt', async () => {
  let r = scripted([json(404)]);
  assert.deepEqual(await client(r.fetchImpl).gh('GET', '/l', null, { allow: [404, 410] }), { status: 404 });
  assert.equal(r.calls.length, 1);

  r = scripted([json(422)]);
  assert.deepEqual(await client(r.fetchImpl).gh('POST', '/labels', { name: 'x' }, { allow: [422] }), { status: 422 });
  assert.equal(r.calls.length, 1);

  for (const status of [401, 403, 404, 422]) {
    r = scripted([json(status)]);
    await assert.rejects(client(r.fetchImpl).gh('GET', '/x'), { message: `GitHub GET /x → HTTP ${status}` });
    assert.equal(r.calls.length, 1, `HTTP ${status}`);
  }
});

test('POST: nur wenn die Anfrage GitHub sicher nicht erreicht hat', async () => {
  for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']) {
    const r = scripted([netErr(code), json(201, { number: 7 })]);
    assert.deepEqual(await client(r.fetchImpl).gh('POST', '/issues', { title: 't' }), { number: 7 });
    assert.equal(r.calls.length, 2, code);
  }
  // Node buendelt IPv4/IPv6-Fehlschlaege: Code nur in errors[]
  const agg = new TypeError('fetch failed', { cause: new AggregateError([Object.assign(new Error('a'), { code: 'ECONNREFUSED' })]) });
  const r = scripted([agg, json(201, { number: 8 })]);
  assert.deepEqual(await client(r.fetchImpl).gh('POST', '/issues', {}), { number: 8 });
  assert.equal(r.calls.length, 2);
});

test('POST: nach Abbruch, Frist oder 5xx kein zweiter Versuch (koennte schon angelegt sein)', async () => {
  for (const step of [netErr('ECONNRESET'), netErr('UND_ERR_SOCKET'), netErr('ETIMEDOUT'), netErr('EPIPE'), timeoutErr(), json(502), json(500)]) {
    const r = scripted([step, json(201, {})]);
    await assert.rejects(client(r.fetchImpl).gh('POST', '/issues/3/comments', { body: 'b' }), /GitHub POST \/issues\/3\/comments →/);
    assert.equal(r.calls.length, 1, String(step?.cause?.code ?? step?.name ?? step?.status));
  }
});

test('POST: nach 2xx nie wiederholt, auch wenn das Lesen scheitert', async () => {
  const broken = () => ({ ok: true, status: 201, json: async () => { throw netErr('UND_ERR_SOCKET', 'terminated'); } });
  const r = scripted([broken, json(201, {})]);
  await assert.rejects(client(r.fetchImpl).gh('POST', '/issues', {}), /terminated/);
  assert.equal(r.calls.length, 1);
});

test('PATCH wird wie GET wiederholt', async () => {
  const r = scripted([json(503), json(200, { state: 'closed' })]);
  assert.deepEqual(await client(r.fetchImpl).gh('PATCH', '/issues/3', { state: 'closed' }), { state: 'closed' });
  assert.equal(r.calls.length, 2);
});

test('jeder Versuch hat ein eigenes, frisches Frist-Signal', async () => {
  const r = scripted([json(502), json(502), json(200, {})]);
  await client(r.fetchImpl).gh('GET', '/x');
  const signals = r.calls.map((c) => c.opts.signal);
  assert.equal(new Set(signals).size, 3);
  assert.ok(r.calls.every((c) => c.abortedAtCall === false));
});

test('Obergrenze je Client und backoffMs [] = kein zweiter Versuch', async () => {
  let r = scripted([json(502)]);
  const { gh } = client(r.fetchImpl, { maxRetries: 3 });
  await assert.rejects(gh('GET', '/a')); // 1 + 2 Wiederholungen
  await assert.rejects(gh('GET', '/b')); // 1 + 1 (Rest der Obergrenze)
  await assert.rejects(gh('GET', '/c')); // nur noch 1
  assert.equal(r.calls.length, 3 + 2 + 1);

  r = scripted([json(502), json(200, {})]);
  await assert.rejects(client(r.fetchImpl, { backoffMs: [] }).gh('GET', '/x'), /HTTP 502/);
  assert.equal(r.calls.length, 1);
});

test('Schluessel steht in keiner Meldung und keiner Protokollzeile', async () => {
  const r = scripted([netErr('ECONNRESET'), timeoutErr(), json(503)]);
  const { gh, lines } = client(r.fetchImpl);
  const err = await gh('GET', '/x').catch((e) => e);
  assert.equal(lines.length, 2);
  for (const s of [err.message, ...lines]) assert.ok(!s.includes(TOKEN), s);
  assert.equal(r.calls[0].opts.headers.Authorization, `Bearer ${TOKEN}`);
});

test('Netzfehler behaelt Methode, Pfad, Code und die Ursache', async () => {
  const cause = netErr('UND_ERR_CONNECT_TIMEOUT');
  const r = scripted([cause]);
  const err = await client(r.fetchImpl, { backoffMs: [] }).gh('GET', '/actions/workflows').catch((e) => e);
  assert.equal(err.message, 'GitHub GET /actions/workflows → fetch failed (UND_ERR_CONNECT_TIMEOUT)');
  assert.equal(err.cause, cause);
});

test('retryable: Regeltabelle', () => {
  assert.equal(retryable('GET', { status: 502 }), true);
  assert.equal(retryable('GET', { status: 429 }), false);
  assert.equal(retryable('POST', { status: 503 }), false);
  assert.equal(retryable('POST', { err: netErr('ECONNREFUSED') }), true);
  assert.equal(retryable('POST', { err: netErr('ECONNRESET') }), false);
  assert.equal(retryable('POST', { err: timeoutErr() }), false);
  assert.equal(retryable('GET', { err: timeoutErr() }), true);
  assert.equal(retryable('GET', { err: new SyntaxError('x') }), false);
});

// --- echte Node-Fehler gegen 127.0.0.1 ------------------------------------

const listen = (onConn) => new Promise((resolve) => {
  const srv = createServer(onConn);
  srv.listen(0, '127.0.0.1', () => resolve(srv));
});
const close = (srv) => new Promise((r) => srv.close(() => r()));
const local = (port, calls) => (url, opts) => {
  calls.push(url);
  return fetch(url.replace('https://api.github.com', `http://127.0.0.1:${port}`), opts);
};

test('echt: Port zu → POST wird wiederholt (ECONNREFUSED)', async () => {
  const srv = await listen(() => {});
  const { port } = srv.address();
  await close(srv); // Port ist jetzt zu
  const calls = [];
  const err = await client(local(port, calls)).gh('POST', '/issues', { title: 't' }).catch((e) => e);
  assert.equal(calls.length, 3);
  assert.match(err.message, /^GitHub POST \/issues → fetch failed \(ECONNREFUSED\)$/);
});

test('echt: Server trennt nach Empfang → POST nicht wiederholt, GET schon', async () => {
  const srv = await listen((sock) => sock.once('data', () => sock.destroy()));
  const { port } = srv.address();
  try {
    let calls = [];
    const err = await client(local(port, calls)).gh('POST', '/issues', { title: 't' }).catch((e) => e);
    assert.equal(calls.length, 1);
    assert.match(err.message, /^GitHub POST \/issues → fetch failed \(UND_ERR_SOCKET\)$/);

    calls = [];
    await assert.rejects(client(local(port, calls)).gh('GET', '/x'), /UND_ERR_SOCKET/);
    assert.equal(calls.length, 3);
  } finally {
    await close(srv);
  }
});
