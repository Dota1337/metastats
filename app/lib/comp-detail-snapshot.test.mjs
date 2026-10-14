// Tests fuer das Lesen des Comp-Detail-Vorrats (comp-detail-snapshot.ts).
//
// Warum: Detail-Route, OG-Bild und Startdaten der Seite lesen alle hier. Wer
// einen Familien-Stand an einen Slug ausliefert, der kein Mitglied ist, zeigt
// fremde Zahlen; wer anchorSlug nicht umschreibt, verlinkt die Seite auf die
// falsche Variante.
//
// Lauf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { familyPayloadFor, lookupCompDetailSnapshot } from './comp-detail-snapshot.ts';
import { compFamilySnapshotKey } from './snapshot-matrix.ts';

const A = 'TFT18_Solar@5_TFT18_Xayah';
const B = 'TFT18_Solar@7_TFT18_Xayah';
const FOREIGN = 'TFT18_Solar@9_TFT18_Xayah';

const familyPayload = () => ({
  hasData: true,
  comp: {
    clusterKey: A,
    games: 900,
    aliasedFromFamily: { anchorSlug: A, mergedFrom: [A, B] },
  },
});

test('Mitglied bekommt eine Kopie mit seinem anchorSlug, das Original bleibt', () => {
  const orig = familyPayload();
  const out = familyPayloadFor(orig, B);
  assert.equal(out.comp.aliasedFromFamily.anchorSlug, B);
  assert.deepEqual(out.comp.aliasedFromFamily.mergedFrom, [A, B]);
  assert.equal(out.comp.games, 900);
  assert.equal(orig.comp.aliasedFromFamily.anchorSlug, A);
});

test('kein Mitglied → null; Ein-Zeilen-Familie nur fuer ihren clusterKey', () => {
  assert.equal(familyPayloadFor(familyPayload(), FOREIGN), null);
  const single = { comp: { clusterKey: A, aliasedFromFamily: null } };
  assert.equal(familyPayloadFor(single, A), single);
  assert.equal(familyPayloadFor(single, B), null);
  assert.equal(familyPayloadFor({}, A), null);
  assert.equal(familyPayloadFor(null, A), null);
});

function fakeLookup(byFamily, bySlug) {
  const calls = [];
  const fn = async (endpoint, opts) => {
    calls.push({ endpoint, family: opts.family ?? null, slug: opts.slug });
    const payload = opts.family ? byFamily[opts.family] : bySlug[opts.slug];
    return payload ? { payload, tag: `${endpoint}-v2`, blobUrl: 'u', blobBytes: 1, builtAt: 'x' } : null;
  };
  return { fn, calls };
}
const OPTS = { patch: null, region: 'all', days: 3, bucket: 'master_plus', minGames: 30, setNumber: 18 };

test('Familien-Stand zuerst, mit eigenem Tag', async () => {
  const { fn, calls } = fakeLookup({ TFT18_Solar__TFT18_Xayah: familyPayload() }, {});
  const hit = await lookupCompDetailSnapshot({ ...OPTS, slug: B }, fn);
  assert.equal(hit.tag, 'comps-detail-family');
  assert.equal(hit.payload.comp.aliasedFromFamily.anchorSlug, B);
  assert.deepEqual(calls.map(c => c.family), ['TFT18_Solar__TFT18_Xayah']);
});

test('Slug ohne eigene Zeile in der Familie → Slug-Schluessel', async () => {
  const slugPayload = { comp: { clusterKey: FOREIGN } };
  const { fn, calls } = fakeLookup({ TFT18_Solar__TFT18_Xayah: familyPayload() }, { [FOREIGN]: slugPayload });
  const hit = await lookupCompDetailSnapshot({ ...OPTS, slug: FOREIGN }, fn);
  assert.equal(hit.payload, slugPayload);
  assert.deepEqual(calls.map(c => c.family), ['TFT18_Solar__TFT18_Xayah', null]);
});

test('andere Schwelle als 30 oder skip → kein Vorrat (live)', async () => {
  const { fn, calls } = fakeLookup({ TFT18_Solar__TFT18_Xayah: familyPayload() }, { [A]: {} });
  assert.equal(await lookupCompDetailSnapshot({ ...OPTS, minGames: 0, slug: A }, fn), null);
  assert.equal(await lookupCompDetailSnapshot({ ...OPTS, skip: true, slug: A }, fn), null);
  assert.equal(calls.length, 0);
});

test('Familien-Schluessel: eigener Unterordner, __ der Familie wird zu .', () => {
  assert.equal(
    compFamilySnapshotKey({ patch: '18.3', region: 'all', days: 3, bucket: 'master_plus', family: 'TFT18_Solar__TFT18_Xayah' }),
    'comps-detail/18.3/family/TFT18_Solar.TFT18_Xayah__all__3d__master_plus.json',
  );
});
