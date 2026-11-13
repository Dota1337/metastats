import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSourceDown } from './source-down.mjs';

const http = status => Object.assign(new Error(`HTTP ${status}`), { status });
const net = code => Object.assign(new Error(code), { code });

test('Server weg oder ueberlastet: Quelle weg', () => {
  for (const s of [500, 502, 503, 504, 520, 522, 524, 429]) assert.equal(isSourceDown(http(s)), true, `HTTP ${s}`);
});

test('Netz: Quelle weg', () => {
  for (const c of ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH']) {
    assert.equal(isSourceDown(net(c)), true, c);
  }
});

test('falsche Adresse, kaputte Daten, Code-Fehler: bleibt rot', () => {
  for (const s of [400, 403, 404, 410]) assert.equal(isSourceDown(http(s)), false, `HTTP ${s}`);
  assert.equal(isSourceDown(new SyntaxError('Unexpected end of JSON input')), false);
  assert.equal(isSourceDown(net('CERT_HAS_EXPIRED')), false);
  assert.equal(isSourceDown(new TypeError('x is undefined')), false);
  assert.equal(isSourceDown(new Error('HTTP 522')), false, 'nur Felder zaehlen, nicht der Text');
  assert.equal(isSourceDown(undefined), false);
});
