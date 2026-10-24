// Community-Kennung (Sicherheitsdurchsicht 24.10.2026): ausgedachte Cookies
// zaehlen nicht, ohne Cookie ergibt dieselbe IP dieselbe Kennung.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { idFromIp, idFromSignedCookie, signedCookieValue, ID_RE } from './community-author-token.ts';

const KEY = 'a'.repeat(64);

test('dieselbe IP ergibt dieselbe Kennung, andere IP eine andere', () => {
  const a = idFromIp(KEY, '203.0.113.7');
  assert.equal(a, idFromIp(KEY, '203.0.113.7'));
  assert.notEqual(a, idFromIp(KEY, '203.0.113.8'));
  assert.match(a, ID_RE);
  assert.ok(!a.includes('203'), 'die IP steht nicht im Klartext in der Kennung');
});

test('unterschriebenes Cookie wird angenommen, auch nach IP-Wechsel', () => {
  const id = idFromIp(KEY, '198.51.100.1');
  assert.equal(idFromSignedCookie(KEY, signedCookieValue(KEY, id)), id);
});

test('ausgedachte, veraenderte oder fremd unterschriebene Cookies zaehlen nicht', () => {
  const id = idFromIp(KEY, '198.51.100.1');
  const good = signedCookieValue(KEY, id);
  assert.equal(idFromSignedCookie(KEY, 'f'.repeat(32)), null, 'altes Format ohne Unterschrift');
  assert.equal(idFromSignedCookie(KEY, 'irgendwas_1234567890123456789012'), null);
  assert.equal(idFromSignedCookie(KEY, good.slice(0, -1) + (good.endsWith('A') ? 'B' : 'A')), null);
  assert.equal(idFromSignedCookie(KEY, 'e'.repeat(32) + good.slice(32)), null, 'Unterschrift einer anderen Kennung');
  assert.equal(idFromSignedCookie('b'.repeat(64), good), null, 'anderer Schluessel');
  assert.equal(idFromSignedCookie(KEY, good + '_x'), null);
});

test('Cookie passt in das bisherige Muster der Spalte und der Routen', () => {
  const v = signedCookieValue(KEY, idFromIp(KEY, '::1'));
  assert.match(v, /^[a-zA-Z0-9_-]{16,80}$/);
});

test('share und upvote erfinden keine Kennung mehr selbst', () => {
  for (const f of ['app/api/tft/comps/share/route.ts', 'app/api/tft/comps/community/[id]/upvote/route.ts']) {
    const src = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
    assert.match(src, /resolveCommunityAuthor\(req\)/, f);
    assert.match(src, /checkRateLimit\(req/, f);
    assert.doesNotMatch(src, /req\.cookies\.get\('tft_author_token'\)/, f);
  }
});
