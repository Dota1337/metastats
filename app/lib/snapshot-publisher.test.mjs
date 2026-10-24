// Publisher-Vorrecht: nur Kopf UND Geheimnis zusammen gelten (Sicherheits-
// durchsicht 24.10.2026). Dazu die Senderseite der Box und der Pfad-Filter des
// Box-Deploys, ohne den die Box nach einer Aenderung hier still den alten
// Stand naehme.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PUBLISHER_HEADER, PUBLISHER_TOKEN_HEADER, publisherHeaders, publisherTokenValid,
} from './snapshot-publisher.mjs';

const TOKEN = 'a'.repeat(64);
const getter = (h) => (name) => (name in h ? h[name] : null);

test('Kopf und richtiges Geheimnis → Vorrecht', () => {
  assert.equal(publisherTokenValid(getter(publisherHeaders(TOKEN)), TOKEN), true);
});

test('nur der alte Kopf reicht nicht mehr', () => {
  assert.equal(publisherTokenValid(getter({ [PUBLISHER_HEADER]: '1' }), TOKEN), false);
});

test('falsches oder kuerzeres Geheimnis → kein Vorrecht', () => {
  const h = { [PUBLISHER_HEADER]: '1', [PUBLISHER_TOKEN_HEADER]: 'b'.repeat(64) };
  assert.equal(publisherTokenValid(getter(h), TOKEN), false);
  h[PUBLISHER_TOKEN_HEADER] = TOKEN.slice(1);
  assert.equal(publisherTokenValid(getter(h), TOKEN), false);
});

test('Geheimnis ohne Kopf = 1 → kein Vorrecht', () => {
  assert.equal(publisherTokenValid(getter({ [PUBLISHER_TOKEN_HEADER]: TOKEN }), TOKEN), false);
});

test('ohne gesetztes Geheimnis gibt es kein Vorrecht, auch nicht mit leerem Kopf', () => {
  const h = { [PUBLISHER_HEADER]: '1', [PUBLISHER_TOKEN_HEADER]: '' };
  assert.equal(publisherTokenValid(getter(h), undefined), false);
  assert.equal(publisherTokenValid(getter(h), ''), false);
  assert.equal(publisherTokenValid(getter({ ...h, [PUBLISHER_TOKEN_HEADER]: 'x'.repeat(10) }), 'x'.repeat(10)), false);
});

test('publisherHeaders wirft ohne gueltiges Geheimnis', () => {
  assert.throws(() => publisherHeaders(undefined));
  assert.throws(() => publisherHeaders('kurz'));
});

test('Box-Deploy beobachtet das Modul', () => {
  const yml = readFileSync(new URL('../../.github/workflows/deploy-hetzner.yml', import.meta.url), 'utf8');
  assert.match(yml, /'app\/lib\/snapshot-publisher\.mjs'/);
});

test('kein Box-Sender schickt den Kopf noch von Hand', () => {
  for (const f of ['publish-snapshot-bundle.mjs', 'publish-route-mirrors.mjs', 'publish-lol-builds.mjs']) {
    const src = readFileSync(new URL(`../../scripts/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /'x-snapshot-publisher'\s*:/, f);
    assert.match(src, /publisherHeaders\(/, f);
    assert.match(src, /assertPublisherAccepted\(/, f);
  }
});
