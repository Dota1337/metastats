// URL-Form des Data Explorers: alte Links bleiben zeichengleich, jede URL ist
// nach einem Durchlauf fest (sonst leitet die API-Route mit 308 im Kreis um),
// und der Anfrage-Koerper passt durch die Pruefung des Dienstes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseExplorerParams, serializeExplorerQuery, toServiceBody, hasBoardFilters, filterCount, showTop4, showTop1, followFocus, focusApplies, barPatches,
  BOARD_COUNT_KEYS, BOARD_COUNT_MAX, BOARD_TAGS, EXPLORER_TABS,
  EXPLORER_RANK_STAGES, stageRanks, rankStageOf, legacyBucketToRanks,
} from './tft-explorer-query.ts';
import { normalizeQuery, TABS } from '../../scripts/lib/explorer-normalize.mjs';
import { COUNT_KEYS, COUNT_MAX, TAGS } from '../../scripts/lib/explorer-counts.mjs';

const parse = (qs) => parseExplorerParams(new URLSearchParams(qs));
const round = (qs, o) => serializeExplorerQuery(parse(qs), o);
// Lesbar notiert, verglichen in der Form, die URLSearchParams schreibt.
const enc = (qs) => new URLSearchParams(qs).toString();

// Mit dem bisherigen Stand erzeugte Adressen (Form vor den neuen Filtern).
const OLD = [
  '',
  'r=euw1&k=challenger,master&p=18.3',
  'p=all&u=DA_18_Diana:s2e:n2:iDA_SpearOfShojin:xDA_GuinsoosRageblade',
  'u=!DA_Amumu18:s3,DA_18_Diana:s1&tab=items&f=DA_18_Diana&c=2',
  'i=!DA_Artifact_LightshieldCrest,DA_ThiefsGloves&t=!DA_Juggernaut18,DA_18_Inferno:l2e&tab=traits&split=over',
  'u=DA_18_Diana:iDA_X:iDA_X&st=2,3',
  'tab=level',
];

test('alte Adressen bleiben zeichengleich', () => {
  for (const qs of OLD) assert.equal(round(enc(qs)), enc(qs), qs);
});

test('jede Adresse ist nach einem Durchlauf fest (Seite und API)', () => {
  const samples = [
    ...OLD,
    'lv=9,8,9&pl=1-4&u=DA_A:s1-2:n0e:c2:kemblem2:kartifact1:iDA_Y:iDA_X',
    'pl=3&u=DA_A:s2-2:n0-1',
    'pl=1-8&lv=1,2,3,4,5,6,7,8,9,10',
    'i=DA_X:n2,!DA_Y:n3&g1=none,t.DA_T&g2=any,u.DA_B:s2,i.DA_X:n2,t.DA_T:l2e',
    'g1=any,u.!DA_B,u.DA_C&g3=oder,u.DA_D',
    'u=DA_A:s3-1:n9:c4:kgold1:kemblem1:kemblem2',
  ];
  for (const qs of samples) {
    for (const o of [{}, { forApi: true }]) {
      const once = round(qs, o);
      assert.equal(round(once, o), once, `${qs} → ${once}`);
    }
  }
});

test('neue Teile: Form und Kanonisierung', () => {
  assert.equal(round('lv=9,8,9&pl=1-4'), enc('lv=8,9&pl=1-4'));
  assert.equal(round('pl=1-8&lv=1,2,3,4,5,6,7,8,9,10'), '');
  assert.equal(round('pl=4-2'), '');
  assert.equal(round('u=DA_A:s2-2'), enc('u=DA_A:s2e'));
  assert.equal(round('u=DA_A:s3-1'), 'u=DA_A');
  assert.equal(round('i=DA_X:n1'), 'i=DA_X');
  // Kaesten: Reihenfolge bleibt, Glieder sortiert, „!" im Kasten, doppelte ID
  // und unbekannte Art fallen weg, Luecken werden aufgerueckt
  assert.equal(decodeURIComponent(round('g3=none,t.DA_T&g1=any,u.DA_C,i.DA_X:n2,u.!DA_B,u.DA_C:s2&g2=oder,u.DA_D')),
    'g1=any,i.DA_X:n2,u.DA_C&g2=none,t.DA_T');
});

test('Grenzen: Kaesten nur soweit die Gesamtgrenze von 15 reicht', () => {
  const u = Array.from({ length: 9 }, (_, n) => `DA_U${n}`).join(',');
  const i = Array.from({ length: 6 }, (_, n) => `DA_I${n}`).join(',');
  const q = parse(`u=${u}&i=${i}&g1=any,u.DA_A,u.DA_B&g2=none,t.DA_T`);
  assert.equal(filterCount(q), 15);
  assert.equal(q.groups.length, 0);
  const q2 = parse('g1=any,u.DA_1,u.DA_2,u.DA_3,u.DA_4,u.DA_5,u.DA_6,u.DA_7');
  assert.equal(q2.groups[0].units.length, 6);
});

test('Anfrage-Koerper geht durch die Pruefung des Dienstes und meint dasselbe', () => {
  const qs = 'lv=8,9&pl=1-4&u=DA_A:s1-2:n0e:c2:kemblem2:iDA_X:iDA_X,!DA_B:s2e&i=DA_X:n2&t=DA_T:l2e'
    + '&g1=any,u.DA_C:s2,i.DA_Y,t.DA_U:l2&g2=none,i.DA_Z&tab=items&f=DA_A&c=2';
  const n = normalizeQuery(toServiceBody(parse(qs)));
  assert.deepEqual(n.levels, [8, 9]);
  assert.deepEqual(n.place, [1, 4]);
  const a = n.units.find(u => u.id === 'DA_A');
  assert.deepEqual(a, { id: 'DA_A', x: false, s: null, sx: 2, n: 0, nx: 0, c: 2, it: ['DA_X', 'DA_X'], nit: [], k: [{ b: 'emblem', n: 2 }] });
  assert.deepEqual(n.units.find(u => u.id === 'DA_B'), { id: 'DA_B', x: true, s: 2, sx: 2, n: null, nx: null, c: null, it: [], nit: [], k: [] });
  assert.deepEqual(n.items, [{ id: 'DA_X', x: false, n: 2 }]);
  assert.equal(n.groups.length, 2);
  assert.equal(n.combo, 2);
  // alte Form ergibt dieselbe Dienst-Anfrage wie bisher (s2e = genau 2)
  const old = normalizeQuery(toServiceBody(parse('u=DA_18_Diana:s2e:n2')));
  assert.deepEqual(old.units[0], { id: 'DA_18_Diana', x: false, s: 2, sx: 2, n: 2, nx: null, c: null, it: [], nit: [], k: [] });
  assert.deepEqual(normalizeQuery(toServiceBody(parse(''))).groups, []);
  // Item-Anzahl nur 2–3 (Masken m2/m3): n4 faellt auf der Seite weg, der Dienst lehnt sie ab.
  assert.deepEqual(normalizeQuery(toServiceBody(parse('i=DA_X:n4'))).items, [{ id: 'DA_X', x: false, n: null }]);
  assert.deepEqual(normalizeQuery(toServiceBody(parse('i=DA_X:n3'))).items, [{ id: 'DA_X', x: false, n: 3 }]);
  assert.throws(() => normalizeQuery({ items: [{ id: 'DA_X', n: 4 }] }), /item_count/);
});

test('Brett-Zaehler und Tags: gleiche Listen wie der Dienst, Form, Kanonisierung', () => {
  assert.deepEqual([...BOARD_COUNT_KEYS], COUNT_KEYS);
  assert.equal(BOARD_COUNT_MAX, COUNT_MAX);
  assert.deepEqual([...BOARD_TAGS], TAGS);
  for (const t of EXPLORER_TABS) assert.ok(TABS.includes(t), t);
  assert.equal(decodeURIComponent(round('bc=tr:0,k5:2-3,emb:2-,rad:0-,dup:-15,norm:-4,s3:15-15&tg=wound,shred,burn')),
    'bc=emb:2-,norm:-4,s3:15-,k5:2-3,tr:0&tg=shred,wound');
  // doppelt, verkehrt, unbekannt, ohne Wert → weg
  assert.equal(round('bc=emb:2-,emb:3-,k1:4-2,gold:1-,k2:-,k3:16-'), enc('bc=emb:2-'));
  for (const qs of ['bc=emb:2-,k5:2-3,tr:0&tg=sunder', 'bc=k1:0-2,extra:1&tab=games', 'tab=builds&f=DA_A&c=2']) {
    for (const o of [{}, { forApi: true }]) { const once = round(qs, o); assert.equal(round(once, o), once, qs); }
  }
  // c gilt nur bei Items, f auch bei Builds
  assert.equal(decodeURIComponent(round('tab=builds&f=DA_A&c=2')), 'tab=builds&f=DA_A');
  const n = normalizeQuery(toServiceBody(parse('bc=emb:2-,k5:2-3,tr:0,norm:-4&tg=wound,shred&tab=builds&f=DA_A')));
  assert.deepEqual(n.bc, [{ k: 'emb', n: 2, nx: null }, { k: 'norm', n: null, nx: 4 }, { k: 'k5', n: 2, nx: 3 }, { k: 'tr', n: 0, nx: 0 }]);
  assert.deepEqual(n.tags, ['shred', 'wound']);
  assert.equal(n.focus, 'DA_A');
  assert.equal(n.tab, 'builds');
  assert.equal(normalizeQuery(toServiceBody(parse('tab=games&f=DA_A'))).focus, null);
  // zaehlen nicht zur Grenze, sind aber Brett-Filter
  assert.equal(filterCount(parse('bc=emb:2-&tg=shred')), 0);
  assert.equal(hasBoardFilters(parse('bc=emb:2-')), true);
  assert.equal(hasBoardFilters(parse('tg=shred')), true);
});

test('Brett-Filter und Top-4-/Sieg-Spalten', () => {
  assert.equal(hasBoardFilters(parse('lv=9&pl=1-4')), false);
  assert.equal(hasBoardFilters(parse('g1=none,t.DA_T')), true);
  assert.equal(showTop4(null), true);
  assert.equal(showTop4([1, 4]), false);
  assert.equal(showTop4([3, 6]), true);
  assert.equal(showTop1([1, 4]), true);
  assert.equal(showTop1([2, 8]), false);
  assert.equal(showTop1([1, 1]), false);
});

test('Rang-Stufen: Hin und zurueck, Adresse, alte Links', () => {
  assert.deepEqual(stageRanks('challenger'), ['CHALLENGER']);
  assert.deepEqual(stageRanks('master_plus'), ['CHALLENGER', 'GRANDMASTER', 'MASTER']);
  for (const s of EXPLORER_RANK_STAGES) {
    assert.equal(rankStageOf(stageRanks(s)), s, s);
    assert.deepEqual(legacyBucketToRanks(s), stageRanks(s), s);
    // Ueber die Adresse: gespeichert wird alphabetisch, die Stufe bleibt erkennbar.
    const qs = serializeExplorerQuery({ ...parse(''), ranks: stageRanks(s) });
    assert.equal(rankStageOf(parse(qs).ranks), s, qs);
  }
  assert.equal(new URLSearchParams(serializeExplorerQuery({ ...parse(''), ranks: stageRanks('master_plus') })).get('k'),
    'challenger,grandmaster,master');
  // Emerald+ bleibt fuenf Raenge und faellt nicht auf „Alle" zurueck.
  assert.equal(rankStageOf(parse(serializeExplorerQuery({ ...parse(''), ranks: stageRanks('emerald_plus') })).ranks), 'emerald_plus');
  assert.equal(rankStageOf([]), 'all');
  assert.equal(rankStageOf(['DIAMOND']), null);
  assert.equal(rankStageOf(['CHALLENGER', 'MASTER']), null);
  assert.equal(rankStageOf(parse('k=diamond').ranks), null);
  assert.equal(rankStageOf(parse('bucket=master_plus').ranks), 'master_plus');
  assert.equal(rankStageOf(parse('bucket=platinum_plus').ranks), 'emerald_plus');
  assert.equal(rankStageOf(parse('bucket=gold').ranks), 'all');
});

test('Traeger: Seiten-Adresse auf jedem Reiter, API-Form nur bei Items/Builds (sonst 308 je Anfrage)', () => {
  for (const tab of EXPLORER_TABS) {
    const q = { ...parse('u=DA_A'), tab, focus: 'DA_A' };
    const page = new URLSearchParams(serializeExplorerQuery(q));
    assert.equal(page.get('f'), 'DA_A', tab);
    assert.equal(parse(page.toString()).focus, 'DA_A', `${tab} Rundweg`);
    const api = serializeExplorerQuery(q, { forApi: true });
    const want = focusApplies(tab);
    assert.equal(new URLSearchParams(api).get('f'), want ? 'DA_A' : null, `${tab} API`);
    if (!want) {
      assert.equal(api, serializeExplorerQuery({ ...q, focus: null }, { forApi: true }), `${tab} Cache-Schluessel`);
      assert.equal(toServiceBody(q).focus, null, `${tab} Dienst`);
    }
  }
  // c bleibt an Items + Traeger gebunden.
  assert.equal(new URLSearchParams(serializeExplorerQuery({ ...parse('u=DA_A'), focus: 'DA_A', combo: 2 })).get('c'), null);
});

test('followFocus: die gesuchte Unit wird Traeger und bleibt es', () => {
  const add = (q, id) => ({ ...q, units: [...q.units, { id }] });
  const empty = parse('');
  const a = followFocus(empty, add(empty, 'DA_Ahri'));
  assert.equal(a.focus, 'DA_Ahri', 'R1 erste gesuchte');
  const b = followFocus(a, add(a, 'DA_Amumu'));
  assert.equal(b.focus, 'DA_Ahri', 'R2 bleibt, auch wenn alphabetisch spaeter');
  const c = followFocus(b, { ...b, units: b.units.filter(u => u.id !== 'DA_Ahri') });
  assert.equal(c.focus, 'DA_Amumu', 'R3 naechste Unit rueckt nach');
  const d = followFocus(c, { ...c, units: [] });
  assert.equal(d.focus, null, 'R3 keine Unit mehr');
  // Explizit gesetzt (Auswahlfeld, Zuruecksetzen) gewinnt.
  assert.equal(followFocus(b, { ...b, focus: null }).focus, null);
  assert.equal(followFocus(b, { ...b, focus: 'DA_X' }).focus, 'DA_X');
  // „—" gewaehlt: Reiterwechsel nach Items laesst es stehen, die naechste gesuchte Unit nicht.
  const none = { ...b, focus: null };
  assert.equal(followFocus(none, { ...none, tab: 'items' }, { cleared: true }).focus, null);
  assert.equal(followFocus(none, { ...none, tab: 'builds' }, { cleared: true }).focus, 'DA_Ahri', 'Builds brauchen einen');
  assert.equal(followFocus(none, add(none, 'DA_Lux'), { cleared: true }).focus, 'DA_Lux');
});

test('followFocus: alte Links, Kaesten, ohne-Units, Synergien', () => {
  // Alter Link / Unit-Seite: Unit ohne Traeger; Reiterwechsel oder neue Unit → die schon stehende.
  const old = parse('u=DA_Zed');
  assert.equal(followFocus(old, { ...old, tab: 'items' }).focus, 'DA_Zed');
  assert.equal(followFocus(old, { ...old, tab: 'traits' }).focus, null, 'nur Items/Builds');
  assert.equal(followFocus(old, { ...old, units: [...old.units, { id: 'DA_Ahri' }] }).focus, 'DA_Zed');
  // In einen oder-Kasten verschoben (applyPick „oder", Ziehen): Traeger bleibt.
  const q = { ...parse('u=DA_Ahri'), focus: 'DA_Ahri' };
  const boxed = { ...q, units: [], groups: [{ m: 'any', units: [{ id: 'DA_Ahri' }, { id: 'DA_Jinx' }], items: [], traits: [] }] };
  assert.equal(followFocus(q, boxed).focus, 'DA_Ahri');
  // Kasten-Units, ohne-Units, Items, Synergien setzen keinen Traeger.
  const e = parse('');
  assert.equal(followFocus(e, { ...e, groups: boxed.groups }).focus, null);
  assert.equal(followFocus(e, { ...e, units: [{ id: 'DA_A', x: true }] }).focus, null);
  assert.equal(followFocus(e, { ...e, items: [{ id: 'DA_I' }], traits: [{ id: 'DA_T' }] }).focus, null);
  // Traeger ausserhalb aller Bausteine (Auswahlfeld) bleibt stehen.
  const outside = { ...parse('u=DA_A'), focus: 'DA_X' };
  assert.equal(followFocus(outside, { ...outside, units: [{ id: 'DA_A' }, { id: 'DA_B' }] }).focus, 'DA_X');
  assert.equal(followFocus(outside, { ...outside, units: [] }).focus, 'DA_X');
  // Traeger-Wechsel durch Entfernen setzt die Kombi-Groesse zurueck.
  const combo = { ...parse('u=DA_A,DA_B&tab=items&f=DA_A&c=2') };
  assert.equal(combo.combo, 2);
  const r = followFocus(combo, { ...combo, units: [{ id: 'DA_B' }] });
  assert.equal(r.focus, 'DA_B');
  assert.equal(r.combo, 1);
});

test('Patch-Leiste: aktuelle Familie + vorige Familie, keine festen Nummern', () => {
  const today = ['18.5b', '18.5', '18.4', '18.3b', '18.3', '18.2b', '18.2', '18.1b'];
  assert.deepEqual(barPatches(today), ['18.5b', '18.5', '18.4']);
  assert.deepEqual(barPatches(['18.6', ...today]), ['18.6', '18.5b', '18.5'], 'Patchwechsel: vorige Familie ganz');
  assert.deepEqual(barPatches(['18.5c', '18.5b', '18.5', '18.4']), ['18.5c', '18.5b', '18.5', '18.4'], 'c-Patch gehoert zur Familie');
  assert.deepEqual(barPatches(['19.1']), ['19.1'], 'Set-Start');
  assert.deepEqual(barPatches([]), []);
  // Familie wie ueberall (snapshot-matrix patchFamily): 18.5b und 18.5 eine Familie.
  assert.deepEqual(barPatches(['18.4b', '18.4', '18.3']), ['18.4b', '18.4', '18.3']);
});
