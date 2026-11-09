// Tests fuer den Vertrag seo/canonical-consistency (scripts/lib/contracts.mjs).
// Nur die reine Auswertung — die Abrufe macht der Pruefer selbst.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalOf, traitIdLinks, evaluateCanonical, compDetailPaths, playerLinks } from './contracts.mjs';

const page = (path, canonicalPath, { body = '', inBody = false, kind = 'comp' } = {}) => {
  const tags = `<title>X</title><link rel="canonical" href="https://www.metastats.gg${canonicalPath}"/>`;
  const html = inBody
    ? `<html><head><meta charset="utf-8"/></head><body>${tags}${body}</body></html>`
    : `<html><head>${tags}</head><body>${body}</body></html>`;
  return { path, kind, status: 200, html };
};

test('canonicalOf: im Kopf, im Body, fehlt', () => {
  assert.deepEqual(canonicalOf(page('/a', '/a').html), { href: 'https://www.metastats.gg/a', inHead: true, titleInHead: true });
  const body = canonicalOf(page('/a', '/a', { inBody: true }).html);
  assert.equal(body.inHead, false);
  assert.equal(body.titleInHead, false);
  assert.equal(canonicalOf('<html><head></head><body></body></html>').href, null);
});

test('evaluateCanonical: alles stimmig = keine Fehler', () => {
  const ev = evaluateCanonical([
    page('/tft/comps/elderwood-kennen', '/tft/comps/elderwood-kennen'),
    page('/tft/items/DA_18_Emblem%40X', '/tft/items/DA_18_Emblem@X', { kind: 'page' }),
  ], { maxMismatch: 2 });
  assert.deepEqual(ev.wrong, []);
  assert.equal(ev.mismatches, 0);
});

test('evaluateCanonical: fremde Comp bis zur Toleranz gruen, darueber rot; feste Seite sofort rot', () => {
  const two = [page('/tft/comps/a', '/tft/comps/b'), page('/tft/comps/c', '/tft/comps/d')];
  assert.deepEqual(evaluateCanonical(two, { maxMismatch: 2 }).wrong, []);
  const three = [...two, page('/tft/comps/e', '/tft/comps/f')];
  assert.match(evaluateCanonical(three, { maxMismatch: 2 }).wrong[0], /3 Comp-Seiten mit fremdem canonical/);
  const fixed = evaluateCanonical([page('/tft/items/DA_X_Augment', '/tft/items/DA_X', { kind: 'page' })], { maxMismatch: 2 });
  assert.match(fixed.wrong[0], /canonical \/tft\/items\/DA_X$/);
});

test('evaluateCanonical: canonical im Body, Trait-Kennungs-Links, Fehlerstatus = rot', () => {
  assert.match(evaluateCanonical([page('/champions/Ahri', '/champions/Ahri', { inBody: true, kind: 'page' })]).wrong.join(';'), /canonical im <body>/);
  const traitLinks = page('/tft/comps/a', '/tft/comps/a', { body: '<a href="/tft/traits/DA_18_Elderwood">x</a><a href="/en/tft/traits/Elderwood">y</a>' });
  assert.match(evaluateCanonical([traitLinks]).wrong[0], /1 Trait-Links mit Kennung \(z\.B\. DA_18_Elderwood\)/);
  assert.match(evaluateCanonical([{ path: '/tft/comps/x', kind: 'comp', status: 307, html: '' }]).wrong[0], /HTTP 307/);
  assert.match(evaluateCanonical([{ path: '/tft/comps/x', kind: 'comp', error: 'Zeitlimit' }]).wrong[0], /Zeitlimit/);
});

test('traitIdLinks: nur sichtbare Links, Namen zaehlen nicht', () => {
  const html = '<a href="/tft/traits/Elderwood"></a><a href="/ko/tft/traits/TFT17_Stargazer"></a><script>"href=\\"/tft/traits/DA_18_X\\""</script>';
  assert.deepEqual(traitIdLinks(html), ['TFT17_Stargazer']);
});

test('playerLinks: volle Adresse mit Query, &amp; aufgeloest, nur sichtbar, TFT und LoL', () => {
  const html = '<a href="/tft/player/Hide%20on%20bush--KR1?region=kr&amp;puuid=P"></a>'
    + '<a href="/player/Kaori--EUW33?region=euw1"></a><a href="/player/Kaori--EUW33?region=euw1"></a>'
    + '<a href="/en/tft/player/A--B"></a><a href="/tft/players"></a>'
    + '<script>"href=\\"/tft/player/X--Y\\""</script>';
  assert.deepEqual(playerLinks(html), [
    '/tft/player/Hide%20on%20bush--KR1?region=kr&puuid=P',
    '/player/Kaori--EUW33?region=euw1',
    '/en/tft/player/A--B',
  ]);
});

test('evaluateCanonical: Spieler-Link vergleicht nur den Pfad; andere Schreibweise weich bis maxPlayerMismatch', () => {
  const ok = { ...page('/tft/player/Hide%20on%20bush--KR1', '/tft/player/Hide%20on%20bush--KR1', { kind: 'player' }), fetchPath: '/tft/player/Hide%20on%20bush--KR1?region=kr' };
  assert.deepEqual(evaluateCanonical([ok]).wrong, []);
  const other = { ...page('/tft/player/hideonbush--kr1', '/tft/player/Hide%20on%20bush--KR1', { kind: 'player' }), fetchPath: '/tft/player/hideonbush--kr1?region=kr' };
  const soft = evaluateCanonical([ok, other], { maxPlayerMismatch: 1 });
  assert.deepEqual(soft.wrong, []);
  assert.equal(soft.playerMismatches, 1);
  assert.match(evaluateCanonical([other]).wrong[0], /1 Spieler-Links mit fremdem canonical/);
  // Fehler nennen die abgerufene Adresse samt Region.
  assert.match(evaluateCanonical([{ path: '/player/A--B', fetchPath: '/player/A--B?region=euw1', kind: 'player', status: 404, html: '' }]).wrong[0], /\?region=euw1 → HTTP 404/);
  // Kein canonical bleibt hart, auch bei Spielern.
  assert.match(evaluateCanonical([{ path: '/player/A--B', kind: 'player', status: 200, html: '<html><head><title>x</title></head></html>' }], { maxPlayerMismatch: 5 }).wrong[0], /kein canonical/);
});

test('compDetailPaths: Uebersichten raus, doppelte einmal', () => {
  assert.deepEqual(
    compDetailPaths(['/tft/comps', '/tft/comps/atlas', '/tft/comps/a', '/tft/comps/a', '/tft/comps/community', '/en/tft/comps/a', '/tft/units/X']),
    ['/tft/comps/a'],
  );
});
