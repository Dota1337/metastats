import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CompanionComp, CompanionLookups } from '../../../../app/lib/companion-types.ts';
import { matchesQuery, rankComps, boardScore } from './comp-search.ts';

const lk: CompanionLookups = {
  v: 1, set: 18,
  champions: {
    DA_18_Azir: { name: 'Azir', cost: 4, icon: null, traits: [] },
    DA_18_Zyra: { name: 'Zyra', cost: 3, icon: null, traits: [] },
    DA_18_Veigar: { name: 'Veigar', cost: 1, icon: null, traits: [] },
    DA_18_Aphelios: { name: 'Aphelios', cost: 4, icon: null, traits: [] },
    DA_18_Varus: { name: 'Varus', cost: 2, icon: null, traits: [] },
  },
  items: {},
  traits: { DA_18_Executioner: { name: 'Executioner', icon: null }, DA_18_Lunar: { name: 'Lunar', icon: null } },
  shopOdds: {}, bagSize: {},
};

const mk = (key: string, trait: string, tier: string | null, avg: number, units: string[], carries: string[]): CompanionComp => ({
  key, slug: key, name: `${lk.traits[trait]?.name ?? trait} · ${carries.map(c => lk.champions[c]?.name).join(' & ')}`, trait, carries,
  itemCarriers: carries, tier, avg, top4: 0.5, win: 0.1, pick: 0.01, games: 1000, traitLevel: 4, avgLevel: 8,
  units: units.map(id => ({ id })),
});
const exe = mk('exe', 'DA_18_Executioner', 'S', 4.0, ['DA_18_Veigar', 'DA_18_Azir', 'DA_18_Zyra'], ['DA_18_Azir', 'DA_18_Zyra']);
const lun = mk('lun', 'DA_18_Lunar', 'B', 4.4, ['DA_18_Varus', 'DA_18_Aphelios'], ['DA_18_Aphelios']);
const low = mk('low', 'DA_18_Lunar', null, 4.2, ['DA_18_Varus'], ['DA_18_Varus']);
const comps = [low, lun, exe];

test('Suche: Comp-, Trait-, Unit-Namen und Kennungen, jedes Wort muss passen', () => {
  assert.equal(matchesQuery(exe, '', lk), true);
  assert.equal(matchesQuery(exe, 'azir', lk), true);
  assert.equal(matchesQuery(exe, 'Executioner', lk), true);
  assert.equal(matchesQuery(exe, 'veigar zyra', lk), true);
  assert.equal(matchesQuery(exe, 'veigar aphelios', lk), false);
  assert.equal(matchesQuery(lun, 'DA_18_Varus', lk), true);
});

test('Ohne Brett: nach Tier, ohne Tier zuletzt', () => {
  assert.deepEqual(rankComps(comps, [], '', lk).map(r => r.comp.key), ['exe', 'lun', 'low']);
});

test('Brett-Treffer ab 2 (2★ doppelt) gehen vor das Tier', () => {
  const mine = [{ id: 'DA_18_Varus', star: 2 }];
  assert.deepEqual(boardScore(lun, mine), { score: 2, onBoard: ['DA_18_Varus'] });
  assert.deepEqual(rankComps(comps, mine, '', lk).map(r => r.comp.key), ['lun', 'low', 'exe']);
  // Nur 1 Treffer (1★): zaehlt nicht, Tier entscheidet.
  assert.deepEqual(rankComps(comps, [{ id: 'DA_18_Varus', star: 1 }], '', lk).map(r => r.comp.key), ['exe', 'lun', 'low']);
  // Mehr Treffer gewinnen.
  const many = [{ id: 'DA_18_Veigar', star: 1 }, { id: 'DA_18_Azir', star: 2 }, { id: 'DA_18_Varus', star: 2 }];
  assert.deepEqual(rankComps(comps, many, '', lk).map(r => r.comp.key), ['exe', 'lun', 'low']);
});

test('Keine Augmente in der Suche', () => {
  const src = readFileSync(new URL('./comp-search.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /augment/i);
});
