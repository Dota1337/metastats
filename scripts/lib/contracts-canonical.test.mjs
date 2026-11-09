// Tests fuer den Vertrag seo/canonical-consistency (scripts/lib/contracts.mjs).
// Nur die reine Auswertung — die Abrufe macht der Pruefer selbst.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalOf, traitIdLinks, evaluateCanonical, compDetailPaths } from './contracts.mjs';

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

test('compDetailPaths: Uebersichten raus, doppelte einmal', () => {
  assert.deepEqual(
    compDetailPaths(['/tft/comps', '/tft/comps/atlas', '/tft/comps/a', '/tft/comps/a', '/tft/comps/community', '/en/tft/comps/a', '/tft/units/X']),
    ['/tft/comps/a'],
  );
});
