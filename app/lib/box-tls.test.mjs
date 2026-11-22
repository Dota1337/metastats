// boxFetch muss sich fuer die Aufrufer wie fetch verhalten (Fehlerformen,
// Fristen, Antwort) und darf nur dem gepinnten Zertifikat vertrauen.
// Die https-Proben laufen gegen ein frisch erzeugtes Test-Zertifikat (openssl);
// der Pool dafuer kommt als `agent` herein, BOX_TLS_CERTS bleibt unberuehrt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { X509Certificate } from 'node:crypto';
import { BOX_TLS_CERTS, BOX_TLS_NAME, BOX_TLS_PORT, boxFetch, pinnedTlsOptions } from './box-tls.mjs';

// Jedes gepinnte Zertifikat: auf den Namen, nie auf die Adresse (das Repo ist
// oeffentlich), kein CA, und noch lange genug gueltig.
test('BOX_TLS_CERTS: auf BOX_TLS_NAME, ohne Adresse, kein CA, noch mindestens 60 Tage', () => {
  assert.ok(BOX_TLS_CERTS.length >= 1);
  assert.equal(BOX_TLS_PORT, 8443);
  assert.equal(BOX_TLS_NAME, 'box.invalid');
  for (const pem of BOX_TLS_CERTS) {
    const x = new X509Certificate(pem);
    const left = (new Date(x.validTo).getTime() - Date.now()) / 86_400_000;
    assert.ok(left > 60, `Zertifikat laeuft in ${Math.round(left)} Tagen ab — Wechsel siehe box-tls.mjs`);
    assert.equal(x.subjectAltName, `DNS:${BOX_TLS_NAME}`);
    assert.equal(x.subject.trim(), `CN=${BOX_TLS_NAME}`);
    assert.equal(x.ca, false);
  }
});

let hasOpenssl = true;
try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); } catch { hasOpenssl = false; }

function makePair(dir, name) {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
    '-nodes', '-days', '2', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
    '-keyout', join(dir, `${name}.key`), '-out', join(dir, `${name}.pem`)], { stdio: 'ignore' });
  return { key: readFileSync(join(dir, `${name}.key`), 'utf8'), cert: readFileSync(join(dir, `${name}.pem`), 'utf8') };
}

// Wie das echte Box-Zertifikat: auf den Namen, nicht auf die Adresse.
function makeNamed(dir, name, { ca = false } = {}) {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
    '-nodes', '-days', '2', '-subj', `/CN=${BOX_TLS_NAME}`, '-addext', `subjectAltName=DNS:${BOX_TLS_NAME}`,
    '-addext', ca ? 'basicConstraints=critical,CA:TRUE' : 'basicConstraints=critical,CA:FALSE',
    '-keyout', join(dir, `${name}.key`), '-out', join(dir, `${name}.pem`)], { stdio: 'ignore' });
  return { key: readFileSync(join(dir, `${name}.key`), 'utf8'), cert: readFileSync(join(dir, `${name}.pem`), 'utf8') };
}

// Von `issuer` unterschrieben, selbst aber nicht gepinnt.
function makeSigned(dir, name, issuer) {
  writeFileSync(join(dir, 'issuer.key'), issuer.key);
  writeFileSync(join(dir, 'issuer.pem'), issuer.cert);
  writeFileSync(join(dir, 'ext.cnf'), `subjectAltName=DNS:${BOX_TLS_NAME}\n`);
  execFileSync('openssl', ['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
    '-subj', `/CN=${BOX_TLS_NAME}`, '-keyout', join(dir, `${name}.key`), '-out', join(dir, `${name}.csr`)], { stdio: 'ignore' });
  execFileSync('openssl', ['x509', '-req', '-in', join(dir, `${name}.csr`), '-CA', join(dir, 'issuer.pem'),
    '-CAkey', join(dir, 'issuer.key'), '-set_serial', '7', '-days', '2', '-extfile', join(dir, 'ext.cnf'),
    '-out', join(dir, `${name}.pem`)], { stdio: 'ignore' });
  return { key: readFileSync(join(dir, `${name}.key`), 'utf8'), cert: readFileSync(join(dir, `${name}.pem`), 'utf8') };
}

function listen(server) {
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server.address().port)));
}

test('pinnedTlsOptions: Pruefung gibt Fehler zurueck statt zu werfen', () => {
  const opts = pinnedTlsOptions(BOX_TLS_CERTS);
  assert.deepEqual(opts.ca, BOX_TLS_CERTS);
  const fp = new X509Certificate(BOX_TLS_CERTS.at(-1)).fingerprint256;
  assert.equal(opts.checkServerIdentity('203.0.113.5', { fingerprint256: fp }), undefined);
  for (const cert of [undefined, {}, { fingerprint256: 'AA:BB' }]) {
    const err = opts.checkServerIdentity('203.0.113.5', cert);
    assert.ok(err instanceof Error);
    assert.equal(err.code, 'ERR_BOX_TLS_NOT_PINNED');
    assert.ok(!err.message.includes('203.0.113.5'));
  }
});

test('Pinning am Fingerabdruck: Namens-Zertifikat ueber die Adresse', { skip: !hasOpenssl && 'openssl fehlt' }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'box-tls-pin-'));
  const named = makeNamed(dir, 'named');
  const twin = makeNamed(dir, 'twin');
  const ipCert = makePair(dir, 'ip');
  const issuer = makeNamed(dir, 'issuer', { ca: true });
  const child = makeSigned(dir, 'child', issuer);
  rmSync(dir, { recursive: true, force: true });

  const servers = [];
  const serve = async (pair) => {
    const s = https.createServer({ key: pair.key, cert: pair.cert }, (req, res) => { res.writeHead(200); res.end('ok'); });
    servers.push(s);
    return `https://127.0.0.1:${await listen(s)}`;
  };
  const agents = [];
  const agentFor = (certs) => { const a = new https.Agent(pinnedTlsOptions(certs)); agents.push(a); return a; };
  t.after(() => {
    agents.forEach((a) => a.destroy());
    servers.forEach((s) => { s.closeAllConnections(); s.close(); });
  });

  const namedUrl = await serve(named);
  const twinUrl = await serve(twin);
  const ipUrl = await serve(ipCert);
  const childUrl = await serve(child);

  await t.test('gepinntes Namens-Zertifikat: Verbindung ueber 127.0.0.1 klappt', async () => {
    const res = await boxFetch(`${namedUrl}/`, { agent: agentFor([named.cert]) });
    assert.equal(await res.text(), 'ok');
  });

  await t.test('Wechselphase: altes Adress- und neues Namens-Zertifikat beide gepinnt', async () => {
    const agent = agentFor([ipCert.cert, named.cert]);
    assert.equal(await (await boxFetch(`${ipUrl}/`, { agent })).text(), 'ok');
    assert.equal(await (await boxFetch(`${namedUrl}/`, { agent })).text(), 'ok');
  });

  await t.test('gleicher Name, anderer Schluessel: abgelehnt', async () => {
    await assert.rejects(boxFetch(`${twinUrl}/`, { agent: agentFor([named.cert]) }),
      (err) => err.name === 'TypeError' && err.cause?.code === 'DEPTH_ZERO_SELF_SIGNED_CERT');
  });

  await t.test('von einem gepinnten Zertifikat unterschrieben, selbst nicht gepinnt: abgelehnt, ohne Adresse im Text', async () => {
    await assert.rejects(boxFetch(`${childUrl}/`, { agent: agentFor([issuer.cert]) }), (err) => {
      assert.equal(err.cause?.code, 'ERR_BOX_TLS_NOT_PINNED');
      assert.ok(!String(err.cause?.message).includes('127.0.0.1'));
      return true;
    });
  });

  await t.test('nur `ca` ohne Fingerabdruck-Pruefung scheitert am Namen (darum pinnedTlsOptions)', async () => {
    const plain = new https.Agent({ ca: [named.cert] });
    agents.push(plain);
    await assert.rejects(boxFetch(`${namedUrl}/`, { agent: plain }), (err) => err.cause?.code === 'ERR_TLS_CERT_ALTNAME_INVALID');
  });
});

test('boxFetch: Pinning, Fehlerformen, Fristen und Wiederholung', { skip: !hasOpenssl && 'openssl fehlt' }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'box-tls-test-'));
  const good = makePair(dir, 'good');
  const other = makePair(dir, 'other');
  rmSync(dir, { recursive: true, force: true });

  let requests = 0;
  let killNextReuse = false;
  const server = https.createServer({ key: good.key, cert: good.cert }, (req, res) => {
    requests += 1;
    const n = (req.socket.metastatsCount = (req.socket.metastatsCount || 0) + 1);
    if (killNextReuse && n > 1) { killNextReuse = false; req.socket.destroy(); return; }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const path = req.url;
      if (path === '/json') {
        res.writeHead(201, { 'Content-Type': 'application/json', 'X-Probe': 'ja' });
        return res.end(JSON.stringify({ method: req.method, auth: req.headers.authorization, body, tls: req.socket.encrypted }));
      }
      if (path === '/empty') { res.writeHead(204); return res.end(); }
      if (path === '/slow') { setTimeout(() => { res.writeHead(200); res.end('spaet'); }, 700); return; }
      if (path === '/stall-body') { res.writeHead(200); res.write('halb'); return; }
      res.writeHead(404); res.end();
    });
  });
  const port = await listen(server);
  const base = `https://127.0.0.1:${port}`;
  const agent = new https.Agent({ keepAlive: true, ca: [good.cert], timeout: 300 });
  t.after(() => { agent.destroy(); server.closeAllConnections(); server.close(); });

  await t.test('gepinnt: Status, Kopf, JSON, Body und Methode kommen an', async () => {
    const res = await boxFetch(`${base}/json`, {
      method: 'POST', agent,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
      body: JSON.stringify({ a: 1 }),
    });
    assert.equal(res.status, 201);
    assert.equal(res.ok, true);
    assert.equal(res.headers.get('x-probe'), 'ja');
    assert.deepEqual(await res.json(), { method: 'POST', auth: 'Bearer x', body: '{"a":1}', tls: true });
  });

  await t.test('204 ohne Inhalt', async () => {
    const res = await boxFetch(`${base}/empty`, { agent });
    assert.equal(res.status, 204);
    assert.equal(await res.text(), '');
  });

  await t.test('fremdes Zertifikat: TypeError mit Grund in err.cause.code', async () => {
    const wrong = new https.Agent({ ca: [other.cert] });
    await assert.rejects(boxFetch(`${base}/json`, { agent: wrong }), (err) => {
      assert.equal(err.name, 'TypeError');
      assert.equal(err.cause?.code, 'DEPTH_ZERO_SELF_SIGNED_CERT');
      return true;
    });
    wrong.destroy();
  });

  await t.test('ohne Pinning (System-Vertrauen) abgelehnt', async () => {
    await assert.rejects(boxFetch(`${base}/json`, { agent: new https.Agent() }), (err) => err.cause?.code === 'DEPTH_ZERO_SELF_SIGNED_CERT');
  });

  await t.test('Frist: TimeoutError wie bei fetch', async () => {
    await assert.rejects(boxFetch(`${base}/slow`, { agent, signal: AbortSignal.timeout(150) }), (err) => err.name === 'TimeoutError');
  });

  await t.test('Frist greift auch, wenn die Antwort mitten im Body haengt', async () => {
    await assert.rejects(boxFetch(`${base}/stall-body`, { agent, signal: AbortSignal.timeout(200) }), (err) => err.name === 'TimeoutError');
  });

  await t.test('Ruhe-Abbau des Pools (300 ms) bricht laufende Anfrage (700 ms) nicht ab', async () => {
    const res = await boxFetch(`${base}/slow`, { agent });
    assert.equal(await res.text(), 'spaet');
  });

  await t.test('geschlossene Pool-Verbindung: genau eine Wiederholung', async () => {
    await (await boxFetch(`${base}/json`, { agent })).text();
    const vorher = requests;
    killNextReuse = true;
    const res = await boxFetch(`${base}/json`, { agent });
    assert.equal(res.status, 201);
    assert.equal(requests - vorher, 2);
  });

  await t.test('retry:false wiederholt nicht', async () => {
    await (await boxFetch(`${base}/json`, { agent })).text();
    killNextReuse = true;
    await assert.rejects(boxFetch(`${base}/json`, { agent, retry: false }), (err) => err.cause?.code === 'ECONNRESET');
  });
});

test('boxFetch: http-Adressen gehen unveraendert an fetch', async (t) => {
  const server = http.createServer((req, res) => { res.writeHead(200); res.end(`klar ${req.method}`); });
  const port = await listen(server);
  t.after(() => { server.closeAllConnections(); server.close(); });
  const res = await boxFetch(`http://127.0.0.1:${port}/x`, { method: 'POST', body: 'b', cache: 'no-store' });
  assert.equal(await res.text(), 'klar POST');
});
