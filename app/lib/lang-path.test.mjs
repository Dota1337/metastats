/**
 * Sprach-Adressen (lang-path.ts): Vorsatz erkennen, Links setzen, und die
 * Entscheidung der Middleware — vor allem die Negativfaelle, in denen ein
 * Vorsatz NIE umgeschrieben werden darf (/en/internal, /en/api, Dateien).
 *
 * Lauf: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  LANGS, PREFIX_LANGS, PAGE_ROOTS, HREFLANG,
  splitLangPrefix, stripLangPrefix, withLangPrefix, switchLangPath, langRoute, pathLangOf,
} from './lang-path.ts';

test('splitLangPrefix: nur ganze Pfadteile, kein /de', () => {
  assert.deepEqual(splitLangPrefix('/en/tft/comps'), { lang: 'en', rest: '/tft/comps' });
  assert.deepEqual(splitLangPrefix('/en'), { lang: 'en', rest: '/' });
  assert.deepEqual(splitLangPrefix('/en/'), { lang: 'en', rest: '/' });
  assert.deepEqual(splitLangPrefix('/zh/champions/Ahri'), { lang: 'zh', rest: '/champions/Ahri' });
  assert.deepEqual(splitLangPrefix('/enx/tft'), { lang: null, rest: '/enx/tft' });
  assert.deepEqual(splitLangPrefix('/de/tft'), { lang: null, rest: '/de/tft' });
  assert.deepEqual(splitLangPrefix('/EN/tft'), { lang: null, rest: '/EN/tft' });
  assert.deepEqual(splitLangPrefix('/tft/en'), { lang: null, rest: '/tft/en' });
  assert.equal(stripLangPrefix('/fr/tft/units'), '/tft/units');
  assert.equal(pathLangOf('/ko/tft'), 'ko');
  assert.equal(pathLangOf('/tft'), 'de');
  assert.equal(pathLangOf(null), 'de');
});

test('withLangPrefix: setzt nur Seiten-Links, idempotent', () => {
  assert.equal(withLangPrefix('en', '/tft/comps'), '/en/tft/comps');
  assert.equal(withLangPrefix('en', '/'), '/en');
  assert.equal(withLangPrefix('en', '/tft/comps?bucket=x#top'), '/en/tft/comps?bucket=x#top');
  assert.equal(withLangPrefix('en', '/?q=1'), '/en?q=1');
  assert.equal(withLangPrefix('en', '/en/tft/comps'), '/en/tft/comps');
  assert.equal(withLangPrefix('ko', '/en/tft/comps'), '/en/tft/comps');
  // Deutsch und „keine Sprache“ lassen alles stehen
  assert.equal(withLangPrefix('de', '/tft/comps'), '/tft/comps');
  assert.equal(withLangPrefix(null, '/tft/comps'), '/tft/comps');
  // Keine Seiten
  for (const href of ['/api/tft/comps', '/internal/login', '/auth/login?next=/x', '/companion/privacy',
    '/_next/static/x.js', '/robots.txt', '/sitemap.xml', '/opengraph-image', '/favicon.ico']) {
    assert.equal(withLangPrefix('en', href), href, href);
  }
  // Extern, Anker, Abfrage, Protokoll-relativ
  for (const href of ['https://x.gg/tft', '#a', '?a=1', '//evil.example/tft', 'mailto:a@b.c', '']) {
    assert.equal(withLangPrefix('en', href), href, href);
  }
});

test('switchLangPath: dieselbe Seite in anderer Sprache', () => {
  assert.equal(switchLangPath('de', '/en/tft/comps?x=1'), '/tft/comps?x=1');
  assert.equal(switchLangPath('ko', '/en/tft/comps'), '/ko/tft/comps');
  assert.equal(switchLangPath('fr', '/tft/units/TFT18_Lulu'), '/fr/tft/units/TFT18_Lulu');
  assert.equal(switchLangPath('de', '/en'), '/');
  assert.equal(switchLangPath('en', '/'), '/en');
});

test('langRoute: Vorsatz vor Seiten wird umgeschrieben', () => {
  assert.deepEqual(langRoute('/en/tft/comps'), { kind: 'rewrite', lang: 'en', rest: '/tft/comps' });
  assert.deepEqual(langRoute('/en'), { kind: 'rewrite', lang: 'en', rest: '/' });
  assert.deepEqual(langRoute('/fr/champions/Ahri'), { kind: 'rewrite', lang: 'fr', rest: '/champions/Ahri' });
  assert.deepEqual(langRoute('/tft/comps'), { kind: 'none' });
  assert.deepEqual(langRoute('/de/tft/comps'), { kind: 'none' });
  assert.deepEqual(langRoute('/enx'), { kind: 'none' });
});

test('langRoute: Vorsatz vor allem anderen ist gesperrt (nie umgeschrieben)', () => {
  for (const p of [
    '/en/internal', '/en/internal/login', '/en/api/internal/ops-snapshot', '/en/api/internal/revalidate',
    '/en/api/tft/comps', '/en/api/companion/v1/comps', '/en/auth/login', '/en/companion/privacy',
    '/en/_next/static/chunks/x.js', '/en/robots.txt', '/en/sitemap.xml', '/en/favicon.ico',
    '/en/manifest.webmanifest', '/en/opengraph-image', '/en/en/tft', '/en//tft', '/en/tftx', '/en/__not-found',
  ]) {
    assert.equal(langRoute(p).kind, 'blocked', p);
  }
});

test('PAGE_ROOTS deckt jede Seiten-Wurzel in app/ ab (und nur die)', () => {
  const appDir = join(import.meta.dirname, '..');
  const PRIVATE = new Set(['api', 'auth', 'companion', 'internal', 'components', 'lib', 'assets']);
  const hasPage = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && /^page\.tsx?$/.test(e.name)) return true;
      if (e.isDirectory() && hasPage(join(dir, e.name))) return true;
    }
    return false;
  };
  const roots = readdirSync(appDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !PRIVATE.has(e.name) && !e.name.startsWith('_') && !e.name.startsWith('('))
    .filter(e => hasPage(join(appDir, e.name)))
    .map(e => e.name)
    .sort();
  assert.deepEqual([...PAGE_ROOTS].sort(), roots);
  assert.ok(existsSync(join(appDir, 'page.tsx')), 'Startseite');
  // Der Live-Vertrag (Links ohne Vorsatz) zaehlt mit derselben Liste.
  const contracts = JSON.parse(readFileSync(join(appDir, '..', 'infra', 'contracts.json'), 'utf8'));
  const seo = (contracts.contracts || contracts).find(c => c.id === 'seo/detail-404');
  assert.deepEqual([...seo.pageRoots].sort(), roots);
});

test('Sprachlisten stimmen mit dem Woerterbuch ueberein', () => {
  assert.deepEqual([...PREFIX_LANGS], LANGS.filter(l => l !== 'de'));
  assert.deepEqual(Object.keys(HREFLANG).sort(), [...LANGS].sort());
  // i18n.tsx ist zu gross zum Importieren im Test; die Codes stehen dort als Literale.
  const src = readFileSync(join(import.meta.dirname, 'i18n.tsx'), 'utf8');
  const head = src.slice(0, src.indexOf('export const LOCALE_MAP'));
  const codes = [...head.matchAll(/\{ code: '([a-z]+)'/g)].map(m => m[1]);
  assert.deepEqual(codes, [...LANGS]);
});
