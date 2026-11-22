import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveRules, BOX_IP_PLACEHOLDER } from './vercel-firewall-rules.mjs';
import { boxHost } from './box-host.mjs';

const CONF = JSON.parse(readFileSync(new URL('../../infra/vercel/firewall.json', import.meta.url), 'utf8'));
const IP = '203.0.113.9';

test('firewall.json: Box-Ausnahmen nur als Platzhalter, keine feste Adresse', () => {
  const ipValues = JSON.stringify(CONF.rules).match(/"type":"ip_address","op":"eq","value":"[^"]*"/g) || [];
  assert.ok(ipValues.length >= 12, `nur ${ipValues.length} Box-Ausnahmen`);
  for (const v of ipValues) assert.ok(v.endsWith(`"${BOX_IP_PLACEHOLDER}"`), v);
});

test('resolveRules setzt die Adresse in jede Ausnahme ein und laesst sonst alles gleich', () => {
  const rules = resolveRules(CONF, IP);
  const out = JSON.stringify(rules);
  assert.ok(!out.includes(BOX_IP_PLACEHOLDER));
  assert.equal(out.split(`"value":"${IP}"`).length - 1, (JSON.stringify(CONF.rules).split(BOX_IP_PLACEHOLDER).length - 1));
  assert.equal(rules.length, CONF.rules.length);
  assert.deepEqual(rules.map((r) => r.name), CONF.rules.map((r) => r.name));
});

test('resolveRules bricht ohne gueltige IP ab und nennt den Wert nicht', () => {
  for (const bad of [undefined, null, '', 'box.example', '999.1.1.1']) {
    assert.throws(() => resolveRules(CONF, bad), (err) => {
      assert.match(err.message, /Box-Adresse fehlt/);
      if (bad) assert.ok(!err.message.includes(bad));
      return true;
    });
  }
});

test('resolveRules bricht bei unbekanntem Platzhalter ab', () => {
  const conf = { rules: [{ name: 'x', value: '${ANDERES}' }] };
  assert.throws(() => resolveRules(conf, IP), /unbekannten Platzhalter/);
});

test('boxHost: HETZNER_HOST vor URL, kaputte URL ohne Wurf, kein Rueckfall', () => {
  assert.equal(boxHost({ HETZNER_HOST: IP, HETZNER_REFRESH_URL: 'https://198.51.100.1:8443' }), IP);
  assert.equal(boxHost({ HETZNER_REFRESH_URL: `https://${IP}:8443/` }), IP);
  assert.equal(boxHost({ HETZNER_REFRESH_URL: 'kein url' }), null);
  assert.equal(boxHost({}), null);
});
