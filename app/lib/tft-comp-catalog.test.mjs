import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog, assignBoard, isPerfect, compClusterKey, aliasMap, mergedAliasMap, splitFamilyKey, familyOfCluster, catalogHash } from './tft-comp-catalog.mjs';

// Familie mit `games` Spielen; units: id → [Anwesenheit 0..1, 3★-Anteil 0..1].
const fam = (key, games, units, top4ByLevel) => ({
  fam: key,
  games,
  units: Object.fromEntries(Object.entries(units).map(([id, [p, s3 = 0]]) => [id, { g: Math.round(p * games), s3: Math.round(p * games * s3) }])),
  top4ByLevel,
});

const SPELL = fam('DA_18_Spellweaver__DA_18_Veigar', 15000, {
  DA_18_Veigar: [1, 0.99], DA_18_LeBlanc: [1, 0.7], DA_18_Ornn: [1, 0.93], DA_18_RekSai: [0.99, 0.9],
  DA_18_Alistar: [0.98, 0.63], DA_Fiddlesticks18: [0.99, 0.05], DA_18_Cassiopeia: [0.8, 0.1], DA_18_Lux: [0.3],
});
// Fruehausscheider-Familie: Core steckt komplett im Spellweaver-Core.
const BLACK = fam('DA_18_Blackthorn__DA_18_Veigar', 900, {
  DA_18_Veigar: [1, 0.4], DA_18_LeBlanc: [0.9], DA_18_Ornn: [0.85], DA_18_Alistar: [0.8], DA_18_Kennen: [0.4],
});
// Core aus nur einer Unit → keine eigene Comp.
const EZ = fam('DA_18_Executioner__DA_18_Ezreal', 17000, { DA_18_Ezreal: [1], DA_18_Azir: [0.5], DA_18_Soraka: [0.4] });
const FAST = fam('DA_18_Adaptor__DA_18_Aphelios', 20000, {
  DA_18_Aphelios: [1, 0.02], DA_18_Nidalee: [0.95], DA_18_Taric: [0.9], DA_18_Ivern: [0.85], DA_18_Kennen: [0.8], DA_18_Ezreal: [0.5],
}, { 8: 300, 9: 900, 10: 50 });

test('kleiner Core ergibt keine Comp, Teilmenge wird Mitglied', () => {
  const cat = buildCatalog([SPELL, BLACK, EZ, FAST]);
  const keys = cat.comps.map(c => c.key);
  assert.deepEqual(keys.sort(), ['DA_18_Adaptor__DA_18_Aphelios', 'DA_18_Spellweaver__DA_18_Veigar']);
  const spell = cat.comps.find(c => c.key === SPELL.fam);
  assert.deepEqual(spell.members, [SPELL.fam, BLACK.fam]);
  assert.equal(spell.games, 15900);
  assert.equal(aliasMap(cat).get(BLACK.fam), SPELL.fam);
  // Executioner·Ezreal: typisches Brett nur {Ezreal} → 1 Treffer, keine Comp.
  assert.equal(aliasMap(cat).has(EZ.fam), false);
});

test('Familien ohne Mitgliedschaft werden ueber ihr typisches Brett fest zugeordnet', () => {
  // Zu kleiner Core (unter 75 %), aber typisches Brett traegt 5 Spellweaver-Units.
  const LOOSE = fam('DA_18_Arcana__DA_18_LeBlanc', 150, {
    DA_18_LeBlanc: [0.7], DA_18_Veigar: [0.65], DA_18_Ornn: [0.6], DA_18_RekSai: [0.55], DA_18_Alistar: [0.5], DA_18_Lux: [0.3],
  });
  const cat = buildCatalog([SPELL, BLACK, EZ, FAST, LOOSE]);
  const spell = cat.comps.find(c => c.key === SPELL.fam);
  assert.deepEqual(spell.adopted, [LOOSE.fam]);
  assert.equal(aliasMap(cat).get(LOOSE.fam), SPELL.fam);
  assert.equal(aliasMap(cat).get(SPELL.fam), SPELL.fam);
});

test('Nachschlagen ueber zwei Patch-Kataloge: der neuere gewinnt', () => {
  const old = { version: 1, comps: [{ key: 'A__X', core: [], reroll: [], carries: [], targetLevel: null, members: ['A__X', 'B__Y'], adopted: [], games: 1 }] };
  const neu = { version: 1, comps: [{ key: 'C__Z', core: [], reroll: [], carries: [], targetLevel: null, members: ['C__Z', 'B__Y'], adopted: [], games: 1 }] };
  const m = mergedAliasMap([old, neu]);
  assert.equal(m.get('B__Y'), 'C__Z');
  assert.equal(m.get('A__X'), 'A__X');
});

test('Einfrieren: Obermenge eines eingefrorenen Cores wird Mitglied, keine neue Comp', () => {
  const prev = buildCatalog([SPELL, FAST]);
  const BIG = fam('DA_18_Arcana__DA_18_LeBlanc', 900, Object.fromEntries([
    ...Object.entries(SPELL.units).filter(([, x]) => x.g / SPELL.games >= 0.75).map(([id]) => [id, [0.95]]),
    ['DA_18_Lux', [0.9]],
  ]));
  const cat = buildCatalog([SPELL, FAST, BIG], { prev, freeze: true });
  assert.equal(cat.comps.some(c => c.key === BIG.fam), false);
  assert.ok(cat.comps.find(c => c.key === SPELL.fam).members.includes(BIG.fam));
});

test('Gleichstand bei Treffern und Anteil: Comp mit Carry auf dem Brett gewinnt vor der groesseren', () => {
  const A = { key: 'T__A', core: ['u1', 'u2', 'u3', 'u4'], reroll: [], carries: ['u1'], targetLevel: null, members: ['T__A'], adopted: [], games: 9000 };
  const B = { key: 'T__B', core: ['u5', 'u6', 'u7', 'u8'], reroll: [], carries: ['u5'], targetLevel: null, members: ['T__B'], adopted: [], games: 100 };
  const cat = { version: 1, comps: [A, B] };
  assert.equal(assignBoard(['u2', 'u3', 'u4', 'u5', 'u6', 'u7'], cat)?.key, 'T__B');
  assert.equal(assignBoard(['u1', 'u2', 'u3', 'u6', 'u7', 'u8'], cat)?.key, 'T__A');
  assert.equal(assignBoard(['u2', 'u3', 'u4', 'u6', 'u7', 'u8'], cat)?.key, 'T__A');
});

test('Zielstufe: liegen die zwei haeufigsten Stufen knapp beieinander, gilt die niedrigere', () => {
  const units = { a: [1], b: [1], c: [1], d: [1] };
  const near = buildCatalog([fam('T__a', 1000, units, { 8: 400, 9: 360, 7: 40 })], { isUnit: () => true });
  assert.equal(near.comps[0].targetLevel, 8);
  const near2 = buildCatalog([fam('T__a', 1000, units, { 8: 360, 9: 400, 7: 40 })], { isUnit: () => true });
  assert.equal(near2.comps[0].targetLevel, 8);
  const clear = buildCatalog([fam('T__a', 1000, units, { 8: 200, 9: 560, 7: 40 })], { isUnit: () => true });
  assert.equal(clear.comps[0].targetLevel, 9);
});

test('Namen bleiben ueber Kataloge, wenn die Kerne zu mindestens 70 % gleich sind', () => {
  const old = buildCatalog([SPELL, FAST]);
  // Neuer Patch: dieselbe Comp heisst klassisch anders (anderer Trait), Kern fast gleich.
  const SPELL2 = fam('DA_18_Arcana__DA_18_Veigar', 15000, Object.fromEntries(Object.entries(SPELL.units).map(([id, x]) => [id, [x.g / SPELL.games, x.s3 / Math.max(1, x.g)]])));
  const OTHER = fam('DA_18_Sniper__DA_18_Jhin', 800, { DA_18_Jhin: [1], DA_18_A: [0.9], DA_18_B: [0.9], DA_18_C: [0.8] });
  // Ohne die alte Familie im neuen Patch: kein fremder Trait im Namen.
  const plain = buildCatalog([SPELL2, OTHER], { names: old });
  assert.deepEqual(plain.comps.map(c => c.key).sort(), ['DA_18_Arcana__DA_18_Veigar', 'DA_18_Sniper__DA_18_Jhin']);
  // Steckt die alte Familie (als Teilmenge) in der neuen Comp, bleibt ihr Name.
  const cat = buildCatalog([SPELL2, OTHER, BLACK, { ...SPELL, games: 300 }], { names: old });
  const keys = cat.comps.map(c => c.key).sort();
  assert.deepEqual(keys, ['DA_18_Sniper__DA_18_Jhin', 'DA_18_Spellweaver__DA_18_Veigar']);
  assert.equal(aliasMap(cat).get(SPELL2.fam), SPELL.fam);
});

test('Pruefsumme haengt nicht an der Reihenfolge, wohl aber am Inhalt', () => {
  const cat = buildCatalog([SPELL, BLACK, FAST]);
  const shuffled = { ...cat, comps: [...cat.comps].reverse().map(c => ({ ...c, core: [...c.core].reverse() })) };
  assert.equal(catalogHash(cat), catalogHash(shuffled));
  const changed = { ...cat, comps: cat.comps.map((c, i) => (i === 0 ? { ...c, core: c.core.slice(1) } : c)) };
  assert.notEqual(catalogHash(cat), catalogHash(changed));
  assert.match(catalogHash(cat), /^[0-9a-f]{16}$/);
});

test('Familien unter 200 Spielen zaehlen nicht', () => {
  const cat = buildCatalog([fam('A__X', 199, { A1: [1], A2: [1], A3: [1], A4: [1] })], { isUnit: () => true });
  assert.equal(cat.comps.length, 0);
});

test('Reroll-Units = Core-Units mit 3★-Anteil ab 55 %; Zielstufe aus Top-4-Brettern', () => {
  const cat = buildCatalog([SPELL, FAST]);
  const spell = cat.comps.find(c => c.key === SPELL.fam);
  assert.deepEqual(spell.reroll.sort(), ['DA_18_Alistar', 'DA_18_LeBlanc', 'DA_18_Ornn', 'DA_18_RekSai', 'DA_18_Veigar']);
  const fast = cat.comps.find(c => c.key === FAST.fam);
  assert.deepEqual(fast.reroll, []);
  assert.equal(fast.targetLevel, 9);
});

test('Brett geht an die Comp mit den meisten Core-Treffern', () => {
  const cat = buildCatalog([SPELL, FAST]);
  // Fruehes Brett mit 4 von 7 Spellweaver-Units
  assert.equal(assignBoard(['DA_18_Veigar', 'DA_18_LeBlanc', 'DA_18_Ornn', 'DA_18_RekSai', 'DA_18_Kennen'], cat)?.key, SPELL.fam);
  // 3 von 7 sind weniger als die Haelfte des Cores
  assert.equal(assignBoard(['DA_18_Veigar', 'DA_18_LeBlanc', 'DA_18_Ornn', 'DA_18_Kennen'], cat), null);
  // 3 von 5 Aphelios-Units gegen 2 von 7 Spellweaver
  assert.equal(assignBoard(['DA_18_Aphelios', 'DA_18_Nidalee', 'DA_18_Taric', 'DA_18_Veigar', 'DA_18_LeBlanc'], cat)?.key, FAST.fam);
});

test('Perfekt: Reroll braucht alle Reroll-Units auf 3★, sonst Zielstufe + Core + Carries 2★', () => {
  const cat = buildCatalog([SPELL, FAST]);
  const spell = cat.comps.find(c => c.key === SPELL.fam);
  const three = new Map(spell.reroll.map(id => [id, 3]));
  assert.equal(isPerfect(three, 6, spell), true);
  three.set('DA_18_Alistar', 2);
  assert.equal(isPerfect(three, 6, spell), false);
  const fast = cat.comps.find(c => c.key === FAST.fam);
  const board = new Map(fast.core.map(id => [id, 2]));
  assert.equal(isPerfect(board, 9, fast), true);
  assert.equal(isPerfect(board, 8, fast), false);
  board.set('DA_18_Aphelios', 1);
  assert.equal(isPerfect(board, 9, fast), false);
});

test('Einfrieren: vorhandene Comps bleiben, neue Familien kommen dazu', () => {
  const prev = buildCatalog([SPELL, FAST]);
  // Am naechsten Tag rutscht Cassiopeia unter 75 % — eingefroren bleibt der Core gleich.
  const spell2 = fam(SPELL.fam, 14000, { ...Object.fromEntries(Object.entries(SPELL.units).map(([id, x]) => [id, [x.g / SPELL.games]])), DA_18_Cassiopeia: [0.6] });
  const NEW = fam('DA_18_Sniper__DA_18_Jhin', 800, { DA_18_Jhin: [1], DA_18_A: [0.9], DA_18_B: [0.9], DA_18_C: [0.8] });
  const cat = buildCatalog([spell2, FAST, BLACK, NEW], { prev, freeze: true });
  const spell = cat.comps.find(c => c.key === SPELL.fam);
  assert.ok(spell.core.includes('DA_18_Cassiopeia'));
  assert.ok(spell.members.includes(BLACK.fam));
  assert.ok(cat.comps.some(c => c.key === NEW.fam));
  // Zielstufe darf nachgefuellt werden, wenn der Vortag keine hatte.
  assert.equal(prev.comps.find(c => c.key === SPELL.fam).targetLevel, null);
  const spell3 = fam(SPELL.fam, 14000, Object.fromEntries(Object.entries(SPELL.units).map(([id, x]) => [id, [x.g / SPELL.games]])), { 6: 900, 7: 100 });
  const cat3 = buildCatalog([spell3, FAST], { prev, freeze: true });
  assert.equal(cat3.comps.find(c => c.key === SPELL.fam).targetLevel, 6);
});

test('Schluessel nutzt Trait und Carry der Comp mit der Stufe auf diesem Brett', () => {
  const comp = { key: 'DA_FloraFatalis18__DA_18_Azir', core: [], reroll: [], carries: [], targetLevel: null, members: [], games: 0 };
  assert.equal(compClusterKey(comp, [{ name: 'DA_FloraFatalis18', tier_current: 2, style: 2 }, { name: 'DA_18_Executioner', tier_current: 3, style: 3 }]), 'DA_FloraFatalis18@2_DA_18_Azir');
  assert.equal(compClusterKey(comp, [{ name: 'DA_18_Executioner', tier_current: 3, style: 3 }]), 'DA_FloraFatalis18@0_DA_18_Azir');
  assert.deepEqual(splitFamilyKey('DA_18_Stargazer_Mountain__DA_18_Lulu'), ['DA_18_Stargazer_Mountain', 'DA_18_Lulu']);
  assert.equal(familyOfCluster('TFT17_Stargazer_Mountain@8_TFT17_Lulu*3#TFT17_Milio'), 'TFT17_Stargazer_Mountain__TFT17_Lulu');
  assert.equal(familyOfCluster('TFT17_SpaceGroove@3_TFT17_Samira~TwoTanky'), 'TFT17_SpaceGroove__TFT17_Samira');
  assert.equal(familyOfCluster('DA_18_Spellweaver__DA_18_Veigar'), 'DA_18_Spellweaver__DA_18_Veigar');
});
