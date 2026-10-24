// Vertrag tls-cert (box/tls-zertifikat): Bewertung der Restlaufzeit des
// ausgelieferten Zertifikats. Der Netzabruf selbst wird live geprueft
// (node scripts/check-contracts.mjs --id box/tls-zertifikat).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateTlsCert } from './contracts.mjs';
import { BOX_TLS_PORT } from '../../app/lib/box-tls.mjs';

const NOW = Date.parse('2026-10-24T04:00:00Z');

test('frisches 160-h-Zertifikat ist gruen', () => {
  const r = evaluateTlsCert({ validTo: 'Oct 31 03:59:00 2026 GMT', now: NOW, minHoursLeft: 40 });
  assert.equal(r.status, 'ok');
  assert.equal(r.hoursLeft, 168);
});

test('normale Erneuerung bei ~53 h Restlaufzeit loest keinen Alarm aus', () => {
  const r = evaluateTlsCert({ validTo: new Date(NOW + 53 * 3_600_000).toUTCString(), now: NOW, minHoursLeft: 40 });
  assert.equal(r.status, 'ok');
});

test('unter der Schwelle rot, mit Restlaufzeit im Text', () => {
  const r = evaluateTlsCert({ validTo: new Date(NOW + 30 * 3_600_000).toUTCString(), now: NOW, minHoursLeft: 40 });
  assert.equal(r.status, 'broken');
  assert.match(r.detail, /nur noch 30 h/);
});

test('abgelaufen ist rot, unlesbares Datum ist error', () => {
  assert.equal(evaluateTlsCert({ validTo: new Date(NOW - 3_600_000).toUTCString(), now: NOW, minHoursLeft: 40 }).status, 'broken');
  assert.equal(evaluateTlsCert({ validTo: undefined, now: NOW, minHoursLeft: 40 }).status, 'error');
});

test('Vertrag im Register: Art, Ziel und Schwelle', () => {
  const reg = JSON.parse(readFileSync(new URL('../../infra/contracts.json', import.meta.url), 'utf8'));
  const c = (reg.contracts || reg).find((x) => x.id === 'box/tls-zertifikat');
  assert.ok(c, 'box/tls-zertifikat fehlt');
  assert.equal(c.type, 'tls-cert');
  assert.equal(c.owner, 'metastats-refresh-api.service');
  // eigenes Zertifikat: Pinning auf BOX_TLS_CERTS und derselbe Port wie die Aufrufer
  assert.equal(c.pinned, true);
  assert.equal(c.port, BOX_TLS_PORT);
  // 3-Jahres-Zertifikat, Wechsel von Hand: genug Vorlauf, aber kein Dauer-Rot
  assert.ok(c.minHoursLeft >= 24 * 30 && c.minHoursLeft <= 24 * 90, `minHoursLeft ${c.minHoursLeft}`);
});
