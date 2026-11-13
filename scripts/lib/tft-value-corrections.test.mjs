import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyValueTable, binHash, changesFingerprint, correctFromNotes, correctItemText,
  livePatchOf, loadSetChanges, patchesUpTo, pbeFromCorrections, replaySeries,
} from './tft-value-corrections.mjs';

const riftbeast = value => ({ apiName: 'T', name: 'Riftbeast', effects: [{ minUnits: 7, variables: { AD: value } }] });
const LINE = { entity: 'Riftbeast (7)', label: 'AD/AP', old: '6%', new: '5%', patch: '18.5' };
const run = (live, pbe, changes) => {
  const activeSet = { traits: [riftbeast(live)] };
  const out = correctFromNotes({ activeSet, pbeSet: { traits: [riftbeast(pbe)] }, items: [], pbeItems: [], localeItems: {}, changes });
  return { ...out, value: activeSet.traits[0].effects[0].variables.AD };
};

test('Rohwert hinter pbe und passende Zeile: nachgezogen', () => {
  const r = run(0.06, 0.05, [LINE]);
  assert.equal(r.value, 0.05);
  assert.equal(r.applied.length, 1);
});

test('CDragon hat nachgezogen: keine Korrektur mehr', () => {
  const r = run(0.05, 0.05, [LINE]);
  assert.equal(r.value, 0.05);
  assert.deepEqual([r.applied.length, r.unmatched.length], [0, 0]);
});

test('dritter Wert passt nicht zur Zeile: bleibt und wird gemeldet', () => {
  const r = run(0.07, 0.05, [LINE]);
  assert.equal(r.value, 0.07);
  assert.equal(r.unmatched.length, 1);
});

test('Unterschied ohne Notes-Zeile (Testserver voraus): bleibt', () => {
  const r = run(0.06, 0.05, []);
  assert.equal(r.value, 0.06);
  assert.equal(r.unmatched.length, 1);
});

test('fremde Zeile mit gleichen Zahlen zaehlt nicht', () => {
  const r = run(0.06, 0.05, [{ ...LINE, entity: 'Fae' }]);
  assert.equal(r.value, 0.06);
});

test('Synergie fehlt im Testserver: nichts passiert', () => {
  const activeSet = { traits: [riftbeast(0.06)] };
  const r = correctFromNotes({ activeSet, pbeSet: { traits: [] }, items: [], pbeItems: [], localeItems: {}, changes: [LINE] });
  assert.deepEqual([r.applied.length, r.unmatched.length], [0, 0]);
});

test('Item: Sprachen bekommen denselben Wert', () => {
  const items = [{ apiName: 'A', name: 'Nesting Anvils', effects: { Gold: 4 } }];
  const de = { apiName: 'A', effects: { Gold: 4 } };
  const r = correctFromNotes({
    activeSet: { traits: [] }, pbeSet: null, items,
    pbeItems: [{ apiName: 'A', effects: { Gold: 6 } }],
    localeItems: { de: new Map([['A', de]]) },
    changes: [{ entity: 'Nesting Anvils', label: 'Gold Granted', old: '4', new: '6', patch: '18.5' }],
  });
  assert.deepEqual([items[0].effects.Gold, de.effects.Gold, r.applied.length], [6, 6, 1]);
});

// ---- Ersatz, wenn der Testserver ausfaellt: Korrekturen des letzten Bundles (Format wie im Bundle)
const blossom = (a, b) => ({ apiName: 'B', name: 'Blossom', effects: [{ minUnits: 7, variables: { ADAP: a } }, { minUnits: 9, variables: { ADAP: b } }] });
const BLOSSOM_LINE = { entity: 'Blossom', label: 'AP/AD', old: '50/55%', new: '55/65%', patch: '18.6' };
const BUNDLE_CORRECTIONS = [
  { kind: 'trait', id: 'B', key: 'ADAP', tier: 7, from: 0.5, to: 0.55, via: 'notes', patch: '18.6', line: 'x' },
  { kind: 'trait', id: 'B', key: 'ADAP', tier: 9, from: 0.55, to: 0.65, via: 'notes', patch: '18.6', line: 'x' },
  { kind: 'item', id: 'S', key: 'GoldGain', tier: null, from: 6, to: 7, via: 'notes', patch: '18.6', line: 'x' },
  { kind: 'item', id: 'R', key: 'BonusHP', tier: null, from: 0.15, to: 0.08, via: 'table', source: 'x' },
];
const SPREE_LINE = { entity: 'Shopping Spree', label: 'Gold', old: '6', new: '7', patch: '18.6' };
const PREVIOUS_TRAITS = { B: { tiers: [{ minUnits: 7, variables: { ADAP: 0.550000011920929 } }, { minUnits: 9, variables: { ADAP: 0.6499999761581421 } }] } };
const fallback = ({ live = [0.5, 0.55], gold = 6, changes = [BLOSSOM_LINE, SPREE_LINE], corrections = BUNDLE_CORRECTIONS } = {}) => {
  const activeSet = { traits: [blossom(...live)] };
  const items = [{ apiName: 'S', name: 'Shopping Spree', effects: { GoldGain: gold } }, { apiName: 'R', name: 'Omega', effects: { BonusHP: 0.15 } }];
  const stand = pbeFromCorrections(corrections, { activeSet, items, changes, previousTraits: PREVIOUS_TRAITS });
  const out = correctFromNotes({ activeSet, pbeSet: stand.pbeSet, items, pbeItems: stand.pbeItems, localeItems: {}, changes });
  return { ...out, stand, adap: activeSet.traits[0].effects.map(e => e.variables.ADAP), gold: items[0].effects.GoldGain, omega: items[1].effects.BonusHP };
};

test('Ersatz: latest noch alt, Zeilen da → beide Stufen und Item wie im letzten Bundle, Rohwerte statt Rundung', () => {
  const r = fallback();
  assert.deepEqual(r.adap, [0.550000011920929, 0.6499999761581421]);
  assert.equal(r.gold, 7);
  assert.equal(r.applied.length, 3);
  assert.equal(r.stand.pbeSet.traits.length, 1, 'zwei Stufen derselben Synergie in einem Eintrag');
});

test('Ersatz: Tabellen-Eintraege bleiben aussen vor', () => {
  const r = fallback();
  assert.equal(r.omega, 0.15);
  assert.ok(!r.stand.pbeItems.some(i => i.apiName === 'R'));
});

test('Ersatz: latest hat nachgezogen → nichts zu tun', () => {
  const r = fallback({ live: [0.550000011920929, 0.6499999761581421], gold: 7 });
  assert.deepEqual([r.applied.length, r.unmatched.length, r.gold], [0, 0, 7]);
});

test('Ersatz: Notes-Zeile fehlt → Wert bleibt, gemeldet', () => {
  const r = fallback({ changes: [BLOSSOM_LINE] });
  assert.equal(r.gold, 6);
  assert.equal(r.unmatched.length, 1);
});

test('Ersatz: Riot nimmt im Mid-Patch zurueck → Korrektur entfaellt, auch wenn die alte Zeile noch steht', () => {
  const back = { entity: 'Shopping Spree', label: 'Gold', old: '7', new: '6', patch: '18.6', mid: true };
  const r = fallback({ changes: [BLOSSOM_LINE, SPREE_LINE, back] });
  assert.equal(r.gold, 6);
  assert.deepEqual(r.stand.dropped.map(c => c.id), ['S']);
  // zurueck und wieder hin: die letzte Zeile entscheidet
  const again = fallback({ changes: [BLOSSOM_LINE, SPREE_LINE, back, { ...SPREE_LINE, patch: '18.7' }] });
  assert.equal(again.gold, 7);
});

test('Ersatz: Synergie ohne Stufe (Eclipse) greift ohne minUnits', () => {
  const activeSet = { traits: [{ apiName: 'E', name: 'Eclipse', effects: [{ variables: { Heal: 0.1 } }] }] };
  const changes = [{ entity: 'Eclipse', label: 'Heal', old: '10%', new: '12%', patch: '18.6' }];
  const stand = pbeFromCorrections([{ kind: 'trait', id: 'E', key: 'Heal', tier: null, from: 0.1, to: 0.12, via: 'notes' }], { activeSet, items: [], changes, previousTraits: {} });
  assert.equal('minUnits' in stand.pbeSet.traits[0].effects[0], false);
  const r = correctFromNotes({ activeSet, pbeSet: stand.pbeSet, items: [], pbeItems: stand.pbeItems, localeItems: {}, changes });
  assert.deepEqual([activeSet.traits[0].effects[0].variables.Heal, r.applied.length], [0.12, 1]);
});

test('Ersatz: zweiter Ausfall-Lauf hintereinander liefert dieselben Korrekturen', () => {
  const first = fallback();
  const round = v => Math.round(v * 1e6) / 1e6;
  const stored = first.applied.map(c => ({ kind: c.kind, id: c.id, key: c.key, tier: c.tier ?? null, from: round(c.from), to: round(c.to), via: 'notes' }));
  const second = fallback({ corrections: stored });
  assert.deepEqual([second.adap, second.gold, second.applied.length], [first.adap, first.gold, first.applied.length]);
});

test('Reihen laufen die Kette nach, in allen Sprachen, auch als Anfang einer laengeren', () => {
  const changes = [
    { entity: "Kha'Zix", label: 'Damage', old: '255/360/515', new: '250/350/530' },
    { entity: "Kha'Zix", label: 'Damage', old: '250/350/530', new: '230/310/450' },
    { entity: 'Soraka', label: 'Damage', old: '225/335', new: '235/355' },
  ];
  const kz = replaySeries({ en: 'deal 255/360/515 damage', de: 'verursacht 255/360/515' }, "Kha'Zix", changes);
  assert.deepEqual(kz.text, { en: 'deal 230/310/450 damage', de: 'verursacht 230/310/450' });
  assert.equal(kz.applied.length, 2);
  assert.equal(replaySeries({ en: 'deal 225/335/1000' }, 'Soraka', changes).text.en, 'deal 235/355/1000');
});

test('Reihe nicht mitten aus einer laengeren, einzelne Zahlen nie', () => {
  const series = [{ entity: 'X', label: 'D', old: '10/20', new: '11/22' }];
  assert.equal(replaySeries({ en: 'deal 5/10/20' }, 'X', series).text.en, 'deal 5/10/20');
  const single = [{ entity: 'X', label: 'D', old: '4%', new: '5%' }];
  assert.equal(replaySeries({ en: 'heal 4%' }, 'X', single).text.en, 'heal 4%');
});

const ENTRY = { id: 'X', from: '15%', to: '12%', patches: ['18.5'] };
const i18n = desc => ({ en: { desc, stats: '30% %i:scaleAD% 30% %i:scaleAP% 7 %i:mana%' }, de: { desc: desc.replace('Gain', 'Erhalte'), stats: '30% %i:scaleAD%' } });

test('Text-Tabelle: Treffer, schon drin, fehlt, mehrdeutig, abgelaufen', () => {
  const ok = correctItemText(i18n('Gain 15% Omnivamp'), ENTRY, '18.5');
  assert.equal(ok.status, 'applied');
  assert.equal(ok.i18n.de.desc, 'Erhalte 12% Omnivamp');
  assert.equal(correctItemText(i18n('Gain 12%'), ENTRY, '18.5').status, 'already');
  assert.equal(correctItemText(i18n('Gain 9%'), ENTRY, '18.5').status, 'missing');
  assert.equal(correctItemText(i18n('Gain 15% and 15%'), ENTRY, '18.5').status, 'ambiguous');
  assert.equal(correctItemText(i18n('Gain 15%'), ENTRY, '18.7').status, 'expired');
});

test('Text-Tabelle: Werte-Zeile mit erwarteter Trefferzahl', () => {
  const r = correctItemText(i18n('x'), { id: 'X', field: 'stats', from: '30%', to: '25%', hits: 2, patches: ['18.5'] }, '18.5');
  assert.equal(r.status, 'applied');
  assert.equal(r.i18n.en.stats, '25% %i:scaleAD% 25% %i:scaleAP% 7 %i:mana%');
  assert.equal(r.i18n.en.desc, 'x');
});

test('Riots Symbol ist kein Prozentzeichen', () => {
  const loc = { en: { desc: '', stats: '40 %i:scaleMR% 7 %i:mana%' } };
  const r = correctItemText(loc, { id: 'X', field: 'stats', from: '40%', to: '35%', patches: ['18.5'] }, '18.5');
  assert.equal(r.status, 'missing');
});

const table = [{ kind: 'item', id: 'O', key: 'HP', cdragon: '16.21', from: 0.15, to: 0.08 }];
const items = hp => [{ apiName: 'O', effects: { HP: hp } }];

test('Werte-Tabelle: greift nur bei passender Version und passendem Wert', () => {
  const hit = items(0.15);
  assert.equal(applyValueTable({ traits: [], items: hit, version: '16.21.1+x', table }).applied.length, 1);
  assert.equal(hit[0].effects.HP, 0.08);

  const other = items(0.15);
  const r = applyValueTable({ traits: [], items: other, version: '16.22.1+x', table });
  assert.equal(other[0].effects.HP, 0.15);
  assert.match(r.notes[0], /bitte loeschen/);

  const third = items(0.2);
  assert.match(applyValueTable({ traits: [], items: third, version: '16.21.1', table }).notes[0], /erwartet/);
  assert.equal(third[0].effects.HP, 0.2);

  assert.match(applyValueTable({ traits: [], items: items(0.08), version: '16.21.1', table }).notes[0], /schon/);
  assert.match(applyValueTable({ traits: [], items: [], version: '16.21.1', table }).notes[0], /fehlt/);
});

const META = {
  setNumber: 18,
  latestPatch: '18.4',
  patchStarts: {
    a: { set: 18, patch: '18.4', from_day: '2026-10-07' },
    b: { set: 18, patch: '18.5', from_day: '2026-10-21' },
    c: { set: 18, patch: '18.6', from_day: '2026-11-04' },
    d: { set: 19, patch: '19.1', from_day: '2026-12-01' },
  },
};

test('laufender Patch nach Terminplan, nicht nach latestPatch', () => {
  assert.equal(livePatchOf(META, '2026-11-01'), '18.5');
  assert.equal(livePatchOf(META, '2026-11-04'), '18.6');
  assert.equal(livePatchOf(META, '2027-01-01'), '18.6');
  assert.equal(livePatchOf({ setNumber: 18, latestPatch: '18.4' }, '2026-11-01'), '18.4');
  assert.deepEqual(patchesUpTo(META, '18.3'), ['18.1', '18.2', '18.3']);
  assert.deepEqual(patchesUpTo(META, null), []);
});

test('Notes: Seite noch nicht da ist normal, Netzfehler bricht ab', async () => {
  const fetchNotes = async patch => (patch === '18.1'
    ? { body: '<h2>U</h2><ul><li>A<ul><li>D: 1/2 ⇒ 3/4</li></ul></li></ul>' }
    : null);
  assert.equal((await loadSetChanges(['18.1', '18.2'], fetchNotes)).length, 1);
  await assert.rejects(loadSetChanges(['18.1'], async () => { throw new Error('Netz'); }), /Netz/);
});

test('Fingerabdruck haengt nur am Inhalt', () => {
  const c = [{ patch: '18.5', mid: false, entity: 'A', label: 'D', old: '1', new: '2' }];
  assert.equal(changesFingerprint(c), changesFingerprint([{ ...c[0] }]));
  assert.notEqual(changesFingerprint(c), changesFingerprint([{ ...c[0], new: '3' }]));
});

test('Hash wie bei Riot', () => {
  assert.equal(binHash('CapstoneAD'), '{1b76cfed}');
  assert.equal(binHash('CapstoneAP'), '{0776b071}');
});
