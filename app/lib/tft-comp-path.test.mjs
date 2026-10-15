/**
 * Lesbare Comp-Adressen (tft-comp-path.ts): Schreibweise, Zwillinge, Rundlauf,
 * Set-Reihenfolge und die Entscheidung der Middleware — vor allem die Faelle,
 * in denen NICHT umgeleitet werden darf.
 *
 * Lauf: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  compSlugName, resolveReadable, readableForKey, compPath, compRouteKey, compDetailTarget,
  compRedirect, isKnownReadable, familyKeyOf, COMP_PERMANENT_FROM,
} from './tft-comp-path.ts';
import { compNames, FIRST_READABLE_SET } from '../../scripts/build-known-ids.mjs';

const ROOT = new URL('../../', import.meta.url);
const readJson = p => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));
const CURRENT = readJson('public/tft-set.json').setNumber;
const BUNDLE_SETS = readdirSync(new URL('public/', ROOT))
  .map(f => /^tft-assets-(\d+)\.json$/.exec(f)?.[1]).filter(Boolean).map(Number);
const bundles = Object.fromEntries(BUNDLE_SETS.map(s => [s, readJson(`public/tft-assets-${s}.json`)]));
// Echte Tabelle wie der Erzeuger sie baut (nicht die generierte Datei: die
// kann aelter sein als die Bundles im Arbeitsstand).
const REAL = compNames(CURRENT, bundles);

const BEFORE = Date.parse('2026-10-20T12:00:00+02:00');
const AFTER = COMP_PERMANENT_FROM;
const redirect = (path, query = '', opts = {}, table = REAL) =>
  compRedirect(path, new URLSearchParams(query), { now: BEFORE, ...opts }, table);

test('Schreibweise', () => {
  assert.equal(compSlugName("Kha'Zix"), 'khazix');
  assert.equal(compSlugName('Rek’Sai'), 'reksai');
  assert.equal(compSlugName('Dr. Mundo'), 'dr-mundo');
  assert.equal(compSlugName('Lux (Lunar)'), 'lux-lunar');
  assert.equal(compSlugName('Flora Fatalis'), 'flora-fatalis');
  assert.equal(compSlugName('Señor  Élan'), 'senor-elan');
});

test('keine Kennung enthaelt "__" oder endet auf "_" (Familien-Kennung bleibt eindeutig)', () => {
  for (const [set, b] of Object.entries(bundles)) {
    for (const id of [...Object.keys(b.traits || {}), ...Object.keys(b.champions || {})]) {
      assert.ok(!id.includes('__') && !id.endsWith('_'), `Set ${set}: ${id}`);
    }
  }
});

test(`Set ${CURRENT}: Rundlauf fuer alle Trait×Carry-Paare, keine Mehrdeutigkeit`, () => {
  const raw = REAL.sets[CURRENT];
  assert.ok(raw, 'Bundle des laufenden Sets fehlt');
  let named = 0;
  for (const trait of Object.keys(raw.traits)) {
    for (const unit of Object.keys(raw.units)) {
      const fk = `${trait}__${unit}`;
      const name = readableForKey(fk, REAL);
      if (name == null) continue;
      named++;
      assert.equal(resolveReadable(name, REAL)?.familyKey, fk, `${fk} → ${name}`);
    }
  }
  // Nur die Zwillings-Verlierer bleiben technisch.
  const traits = Object.keys(raw.traits).length;
  const units = Object.keys(raw.units).length;
  assert.ok(named >= traits * (units - 2), `${named} von ${traits * units} Paaren lesbar`);
});

test('Beispiel des Users und Zwillinge (Akali, Master Yi → DA_)', () => {
  if (CURRENT !== 18) return; // Kennungen von Set 18
  assert.equal(readableForKey('DA_18_Lunar@4_DA_18_Aphelios', REAL), 'lunar-aphelios');
  assert.equal(readableForKey('DA_18_Lunar__DA_18_Aphelios', REAL), 'lunar-aphelios');
  assert.equal(resolveReadable('lunar-aphelios', REAL)?.familyKey, 'DA_18_Lunar__DA_18_Aphelios');
  const akali = Object.keys(REAL.sets[18].traits).find(t => readableForKey(`${t}__DA_18_Akali_AD`, REAL));
  assert.ok(akali);
  assert.match(readableForKey(`${akali}__DA_18_Akali_AD`, REAL), /-akali$/);
  assert.equal(readableForKey(`${akali}__TFT18_Akali`, REAL), null, 'Verlierer bleibt technisch');
  assert.match(readableForKey(`${akali}__DA_18_MasterYi_AD`, REAL), /-master-yi$/);
  assert.equal(readableForKey(`${akali}__TFT18_MasterYi`, REAL), null);
});

test('alte Sets bekommen keine Links, Set 17 steht nicht in der Tabelle', () => {
  assert.ok(FIRST_READABLE_SET >= 18);
  assert.equal(REAL.sets[17], undefined);
  assert.equal(readableForKey('TFT17_Stargazer_Mountain@6_TFT17_Lulu', REAL), null);
  assert.equal(compPath('TFT17_Stargazer_Mountain@6_TFT17_Lulu*3', REAL), '/tft/comps/TFT17_Stargazer_Mountain%406_TFT17_Lulu*3');
});

// Kuenstliche Tabelle: Set 19 kommt, Namen ueberschneiden sich mit Set 18.
const T = (currentSet) => ({
  currentSet,
  sets: {
    18: { traits: { S18_Brawler: 'Brawler', S18_Star: 'Star', S18_Star2: 'Star' }, units: { S18_Vi: 'Vi', S18_Ahri: 'Ahri' } },
    19: { traits: { S19_Brawler: 'Brawler' }, units: { S19_Vi: 'Vi', X19_Vi: 'Vi', S19_Jinx: 'Jinx' } },
  },
});

test('Aufloesung: laufendes Set zuerst, dann die uebrigen', () => {
  assert.equal(resolveReadable('brawler-vi', T(19))?.familyKey, 'S19_Brawler__S19_Vi');
  assert.equal(resolveReadable('brawler-vi', T(19))?.current, true);
  assert.equal(resolveReadable('brawler-ahri', T(19))?.familyKey, 'S18_Brawler__S18_Ahri');
  assert.equal(resolveReadable('brawler-ahri', T(19))?.current, false);
  // Bundle 19 schon da, Set-Wechsel noch nicht: Set 18 bleibt vorn.
  assert.equal(resolveReadable('brawler-vi', T(18))?.familyKey, 'S18_Brawler__S18_Vi');
  // Alte Kennung bekommt nach dem Wechsel keinen Link mehr.
  assert.equal(readableForKey('S18_Brawler__S18_Ahri', T(19)), null);
});

test('Trait-Doppel: keiner bekommt einen Namen; Unit-Zwilling: Mehrheits-Praefix', () => {
  assert.equal(readableForKey('S18_Star__S18_Vi', T(18)), null);
  assert.equal(readableForKey('S18_Star2__S18_Vi', T(18)), null);
  assert.equal(resolveReadable('star-vi', T(18)), null);
  assert.equal(readableForKey('S19_Brawler__S19_Vi', T(19)), 'brawler-vi');
  assert.equal(readableForKey('S19_Brawler__X19_Vi', T(19)), null);
});

test('Form und Kennungen', () => {
  assert.equal(resolveReadable('Brawler-Vi', T(19)), null, 'nur Kleinschreibung');
  assert.equal(resolveReadable('brawler', T(19)), null);
  assert.equal(resolveReadable('brawler-', T(19)), null);
  assert.equal(familyKeyOf('S19_Brawler@4_S19_Vi*3~TwoTanky#S19_Jinx'), 'S19_Brawler__S19_Vi');
  assert.equal(familyKeyOf('S19_Brawler__S19_Vi'), 'S19_Brawler__S19_Vi');
  assert.equal(familyKeyOf('quatsch'), null);
  assert.equal(compRouteKey('brawler-vi', T(19)), 'S19_Brawler__S19_Vi');
  assert.equal(compRouteKey('Brawler-Vi', T(19)), 'S19_Brawler__S19_Vi');
  assert.equal(compRouteKey('S19_Brawler@4_S19_Vi', T(19)), 'S19_Brawler@4_S19_Vi');
  assert.equal(compPath('S19_Brawler@4_S19_Vi*3', T(19)), '/tft/comps/brawler-vi');
  assert.equal(compPath('S19_Brawler@4_X19_Vi', T(19)), '/tft/comps/S19_Brawler%404_X19_Vi');
});

test('404-Pruefung: bekannte lesbare Namen, leere Tabelle laesst durch', () => {
  assert.equal(isKnownReadable('brawler-vi', T(19)), true);
  assert.equal(isKnownReadable('brawler-ahri', T(19)), true, 'altes Set: 200 + noindex, keine 404');
  assert.equal(isKnownReadable('Brawler-Vi', T(19)), true);
  assert.equal(isKnownReadable('fake-nosuchunit', T(19)), false);
  assert.equal(isKnownReadable('fake-nosuchunit', { currentSet: 19, sets: {} }), true);
  assert.equal(isKnownReadable('S19_Brawler@4_S19_Vi', T(19)), false, 'keine lesbare Form');
});

test('Notschalter: Links wieder technisch', () => {
  const prev = process.env.NEXT_PUBLIC_COMP_READABLE;
  process.env.NEXT_PUBLIC_COMP_READABLE = '0';
  try {
    assert.equal(compPath('S19_Brawler@4_S19_Vi', T(19)), '/tft/comps/S19_Brawler%404_S19_Vi');
    assert.equal(compRouteKey('brawler-vi', T(19)), 'S19_Brawler__S19_Vi', 'Aufloesung bleibt an');
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_COMP_READABLE; else process.env.NEXT_PUBLIC_COMP_READABLE = prev;
  }
});

test('Auslese der Detailseite (Server und Browser gleich)', () => {
  const fk = 'S19_Brawler__S19_Vi';
  assert.deepEqual(compDetailTarget(fk, null), { apiSlug: fk, mode: 'family' });
  assert.deepEqual(compDetailTarget(fk, 'exact'), { apiSlug: fk, mode: 'exact' });
  assert.deepEqual(compDetailTarget(fk, 'S19_Brawler@4_S19_Vi*3'), { apiSlug: 'S19_Brawler@4_S19_Vi*3', mode: 'exact' });
  assert.deepEqual(compDetailTarget(fk, 'S19_Brawler@4_S19_Jinx'), { apiSlug: fk, mode: 'family' }, 'fremde Familie');
  assert.deepEqual(compDetailTarget(fk, 'family'), { apiSlug: fk, mode: 'family' });
  assert.deepEqual(compDetailTarget('S19_Brawler@4_S19_Vi', 'exact'), { apiSlug: 'S19_Brawler@4_S19_Vi', mode: 'exact' });
});

test('Weiterleitung: Kennung → lesbarer Name, Abfrage bleibt', () => {
  const key = encodeURIComponent('S19_Brawler@4_S19_Vi');
  const r = redirect(`/tft/comps/${key}`, 'bucket=diamond_plus&region=euw1&_rsc=abc', {}, T(19));
  assert.deepEqual(r, { pathname: '/tft/comps/brawler-vi', search: '?bucket=diamond_plus&region=euw1&_rsc=abc', status: 307 });
  const ex = redirect(`/tft/comps/${key}`, 'variant=exact', {}, T(19));
  assert.equal(new URLSearchParams(ex.search).get('variant'), 'S19_Brawler@4_S19_Vi');
  assert.equal(redirect('/tft/comps/S19_Brawler__S19_Vi', 'variant=exact', {}, T(19)).search, '?variant=exact');
  assert.equal(redirect('/tft/comps/Brawler-Vi', '', {}, T(19)).pathname, '/tft/comps/brawler-vi');
});

test('Weiterleitung: 307 bis 28.10., danach 308, Override', () => {
  const key = encodeURIComponent('S19_Brawler@4_S19_Vi');
  assert.equal(redirect(`/tft/comps/${key}`, '', { now: AFTER - 1 }, T(19)).status, 307);
  assert.equal(redirect(`/tft/comps/${key}`, '', { now: AFTER }, T(19)).status, 308);
  assert.equal(redirect(`/tft/comps/${key}`, '', { now: AFTER, status: '307' }, T(19)).status, 307);
  assert.equal(redirect(`/tft/comps/${key}`, '', { now: BEFORE, status: '308' }, T(19)).status, 308);
  assert.equal(redirect(`/tft/comps/${key}`, '', { now: BEFORE, status: '301' }, T(19)).status, 307, 'nur 307/308');
  assert.equal(AFTER, Date.parse('2026-10-28T23:00:00Z'));
});

test('Weiterleitung: Negativfaelle', () => {
  const t = T(19);
  for (const [path, why] of [
    ['/tft/comps/brawler-vi', 'schon lesbar'],
    ['/tft/comps/atlas', 'feste Unterseite'],
    ['/tft/comps/fake-nosuchunit', 'unbekannt → 404-Pruefung'],
    ['/tft/comps/Fake-NoSuch', 'Grossschreibung unbekannt'],
    [`/tft/comps/${encodeURIComponent('S19_Brawler@4_X19_Vi')}`, 'Zwillings-Verlierer'],
    [`/tft/comps/${encodeURIComponent('S18_Brawler@4_S18_Ahri')}`, 'altes Set'],
    [`/tft/comps/${encodeURIComponent('S19_Nope@4_S19_Vi')}`, 'Trait unbekannt'],
    ['/tft/comps/%E0%A4%A', 'kaputtes %'],
    ['/tft/comps/brawler-vi/opengraph-image', 'tiefer Pfad'],
    ['/tft/comps', 'Liste'],
    ['/tft/units/brawler-vi', 'andere Route'],
  ]) {
    assert.equal(redirect(path, '', {}, t), null, `${path} (${why})`);
  }
  assert.equal(redirect(`/tft/comps/${encodeURIComponent('S19_Brawler@4_S19_Vi')}`, '', { enabled: false }, t), null, 'Notschalter');
});
