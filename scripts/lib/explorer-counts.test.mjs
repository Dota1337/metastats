import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  COUNT_COLS, COUNT_KEYS, COUNTS_HASH, TAG_BITS, boardCounts, buildKeyJs, buildKeySql, countsLists, countsSelectSql, itemClasses,
} from './explorer-counts.mjs';
import { componentsFromBundle } from './explorer-components.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..');
const setNumber = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/tft-set.json'), 'utf8')).setNumber;
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, `public/tft-assets-${setNumber}.json`), 'utf8'));
const L = countsLists(bundle);

test('Itemklassen gegen alle Bundle-Items: MetaTFT-Regeln (gemessen 18.10.2026)', () => {
  const ids = Object.keys(bundle.items);
  for (const id of ids) {
    const c = itemClasses(id);
    assert.equal(c.emblem, /Emblem/.test(id), id);
    assert.equal(c.radiant, /Radiant/.test(id), id);
    assert.equal(c.artifact, /_Artifact_/.test(id), id);
    assert.equal(c.normal, !/Emblem|Radiant|_Artifact_|_Component_/.test(id) && !/Potion18$/.test(id), id);
  }
  // Stichproben der Messung: Krone normal, Radiant-Trank radiant und nicht normal,
  // Augment-Emblem zaehlt als Emblem (anders als die Itemsorte an der Kopie).
  if (bundle.items.DA_TacticiansCrown) assert.equal(itemClasses('DA_TacticiansCrown').normal, true);
  if (bundle.items.DA_BlastPotion18_Radiant) {
    assert.deepEqual(itemClasses('DA_BlastPotion18_Radiant'), { emblem: false, radiant: true, artifact: false, normal: false });
  }
  if (bundle.items.DA_BlastPotion18) assert.equal(itemClasses('DA_BlastPotion18').normal, false);
  for (const comp of componentsFromBundle(bundle)) assert.equal(itemClasses(comp).normal, false, comp);
});

test('Bundle-Listen: Kosten 1–5 belegt, Lux-Formen erkannt, Tags mit Radiant-Formen', () => {
  for (const k of [1, 2, 3, 4, 5]) assert.ok(L.costIds[k].length > 0, `Kosten ${k}`);
  const lux = L.forms.find(f => f.base === 'DA_Lux18_Base');
  if (setNumber === 18) {
    assert.ok(lux, 'Lux-Basis');
    assert.ok(lux.traits.includes('DA_18_Coven') || lux.traits.length >= 5, JSON.stringify(lux));
    assert.ok(!lux.traits.some(t => (L.native.DA_Lux18_Base || []).includes(t)), 'Basis-Trait nicht als Form-Trait');
    assert.ok(L.tags.sunder.includes('DA_EvenshroudRadiant'));
    assert.ok(L.tags.wound.includes('DA_SunfireCape_Radiant'));
    assert.ok(L.tags.shred.includes('DA_Artifact_BlightingJewel'));
  }
  for (const [id, src] of L.aliases) assert.deepEqual(L.native[id] ?? [], L.native[src] ?? [], id);
});

test('boardCounts: Handschuh-Items zaehlen nach eigener Klasse, kein Faktor', () => {
  const units = [
    { characterId: 'X', tier: 3, items: ['DA_ThiefsGlovesRadiant', 'DA_BloodthirsterRadiant', 'DA_InfinityEdgeRadiant'] },
    { characterId: 'X', tier: 2, items: ['DA_18_EmblemBrawler'] },
    { characterId: 'Y', tier: 4, items: ['DA_Artifact_Mittens', 'DA_BlastPotion18', 'DA_Component_Sword'] },
  ];
  const r = boardCounts(units, [], L);
  assert.equal(r.rad, 3);
  assert.equal(r.emb, 1);
  assert.equal(r.art, 1);
  assert.equal(r.norm, 0);
  assert.equal(r.s3, 1);
  assert.equal(r.s4, 1);
  assert.equal(r.dup, 1);
  assert.equal(r.tags & TAG_BITS.wound, TAG_BITS.wound);
});

test('boardCounts: +1 Traits ueber alle Zeilen, geklemmt, Lux-Form zaehlt nicht', () => {
  const nat = Object.entries(L.native).find(([, t]) => t.length === 1);
  assert.ok(nat);
  const [uid, [tid]] = nat;
  // eigene Unit traegt den Trait, num_units 2 → ein Plus (z. B. Emblem).
  assert.equal(boardCounts([{ characterId: uid, tier: 1, items: [] }],
    [{ name: tid, style: 1, num_units: 2, tier_current: 1 }], L).extra, 1);
  // inaktive Zeile zaehlt mit, negative Abweichung wird 0.
  assert.equal(boardCounts([{ characterId: uid, tier: 1, items: [] }],
    [{ name: tid, style: 0, num_units: 0, tier_current: 0 }, { name: 'Z_Fremd', style: 0, num_units: 1, tier_current: 0 }], L).extra, 1);
  if (setNumber === 18) {
    const units = [{ characterId: 'DA_Lux18_Base', tier: 1, items: [] }];
    const traits = [{ name: 'DA_18_LuxUniqueTrait', style: 3, num_units: 1, tier_current: 1 }, { name: 'DA_18_Coven', style: 0, num_units: 1, tier_current: 0 }];
    assert.equal(boardCounts(units, traits, L).extra, 0);
    traits[1].num_units = 2;
    assert.equal(boardCounts(units, traits, L).extra, 1);
  }
  assert.equal(boardCounts(null, null, L).extra, 0);
  assert.deepEqual(Object.keys(boardCounts([], [], L)).sort(), [...COUNT_KEYS, 'tags'].sort());
});

test('SQL: eine Spalte je Zaehler, nur gepruefte Kennungen, Hilfsspalten fallen weg', () => {
  const sql = countsSelectSql('(SELECT 1)', L);
  for (const col of Object.values(COUNT_COLS)) assert.match(sql, new RegExp(`AS ${col}\\b`));
  assert.match(sql, /AS tags\b/);
  assert.match(sql, /EXCLUDE \(cx_ul, cx_its, cx_raw, cx_uh, cx_shs, cx_dh, cx_pl, cx_natl, cx_tl2, cx_tl3\)/);
  assert.throws(() => countsSelectSql('(SELECT 1)', { ...L, costIds: { ...L.costIds, 1: ["X'; DROP"] } }), /ungueltig/);
  assert.match(COUNTS_HASH, /^[0-9a-f]{16}$/);
});

test('Build-Schluessel: ohne Bauteile, sortiert, NULL ohne Item', () => {
  assert.equal(buildKeyJs(['B', 'C_Sword', 'A'], ['C_Sword']), 'A|B');
  assert.equal(buildKeyJs(['C_Sword'], ['C_Sword']), null);
  assert.equal(buildKeyJs([], []), null);
  assert.equal(buildKeyJs(['C', 'B', 'A', 'D'], []), 'A|B|C');
  assert.match(buildKeySql('i1', 'i2', 'i3', "['C']::VARCHAR[]"), /concat_ws/);
});
