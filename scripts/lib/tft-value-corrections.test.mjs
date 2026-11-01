import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyValueTable, binHash, changesFingerprint, correctFromNotes, correctItemText,
  livePatchOf, loadSetChanges, patchesUpTo, replaySeries,
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
