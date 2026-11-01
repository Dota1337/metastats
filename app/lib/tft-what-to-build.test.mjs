import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_SCOPE, EXPLORER_ROW_CAP, VERDICT_MIN_GAMES, applyQuestion, boxRows, itemListRules, buildQuestionDict, canFix, effectiveStar, emptyBox, itemsQuery, minRowGames, normalizeBox,
  parseBuildParams, parseBuildQuestion, restOf, serializeBuildParams, splitQueries, starsQuery, targetStarOf, traitFilterFor, verdictOf,
} from './tft-what-to-build.ts';
import { buildExplorerOptions, itemFitsUnit } from '../components/tft/explorer/explorer-options.ts';
import { ROW_LIMIT } from '../../scripts/lib/explorer-query.mjs';
import { itemBucketOf } from './tft-item-bucket.ts';
import { serializeExplorerQuery } from './tft-explorer-query.ts';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const assets = read('../../public/tft-assets-18.json');
const texts = read('../../public/tft-item-texts-18.json');
const options = buildExplorerOptions(assets);
const itemNames = (id) => assets.items[id]?.names;
const unitNames = (id) => assets.champions[id]?.names;
const dict = buildQuestionDict(options, { itemNames, unitNames });
const kindOf = (id) => itemBucketOf(id, assets);
const ask = (s, lang = 'de', choices) => parseBuildQuestion(s, dict, lang, choices);

const G = 'DA_GuinsoosRageblade', K = 'DA_KrakensFury', IE = 'DA_InfinityEdge', DB = 'DA_Deathblade', D = 'DA_Draven18';

// ─── Suchleiste ───────────────────────────────────────────────────────────

test('Satz des Users: Unit, zwei feste Items, zwei Kandidaten', () => {
  const want = { units: [D], fixed: [G, K], compare: [IE, DB], ambiguous: [] };
  assert.deepEqual(ask('Draven: Guinsoo und Kraken, Infinity Edge oder Deathblade?'), want);
  assert.deepEqual(
    ask('Ich habe auf Draven Guinsos Rageblade und Kraken gebaut, ist als drittes Item Infinity Edge oder Deathblade besser?'),
    want,
  );
  assert.deepEqual(ask('draven guinsoo + kraken, IE vs DB', 'en'), want);
});

// Reviewer-Befund 01.11.: Franzoesisch verlor 21 Strahlende an der Grenze von 5
// Woertern, Chinesisch zerlegte lange Namen an kuerzeren („洛“ in 莫雷洛秘典).
test('Jeder Item-Name jeder Sprache trifft sein Item, auch im Satz', () => {
  const langs = ['de', 'ko', 'zh', 'es', 'fr'];
  const wrong = [];
  for (const lang of langs) {
    const local = buildExplorerOptions(assets, lang);
    const d = buildQuestionDict(local, { itemNames, unitNames });
    for (const it of local.items) {
      if (/Tactician|Augment|Phantom/i.test(it.id)) continue;
      const hit = parseBuildQuestion(`${it.label} `, d, lang);
      const found = hit.fixed.includes(it.id) || hit.ambiguous.some(a => a.ids.includes(it.id));
      if (!found) wrong.push(`${lang}: ${it.label} -> ${JSON.stringify(hit)}`);
    }
  }
  assert.deepEqual(wrong.slice(0, 10), []);
});

test('Satz auf Koreanisch und Chinesisch', () => {
  const name = (id, l) => assets.items[id].names[l];
  const ko = parseBuildQuestion(`드레이븐 ${name(G, 'ko')} ${name(K, 'ko')} ${name(IE, 'ko')} 또는 ${name(DB, 'ko')}`, dict, 'ko');
  assert.deepEqual(ko, { units: [D], fixed: [G, K], compare: [IE, DB], ambiguous: [] });
  const zh = parseBuildQuestion(`${assets.champions[D].names.zh}${name(G, 'zh')}和${name(K, 'zh')}，${name(IE, 'zh')}或${name(DB, 'zh')}`, dict, 'zh');
  assert.deepEqual(zh, { units: [D], fixed: [G, K], compare: [IE, DB], ambiguous: [] });
});

test('Teilen-Links und Listen sind in jeder Sprache dieselben Items', () => {
  const ids = (l) => buildExplorerOptions(assets, l).items.map(i => i.id).sort();
  for (const lang of ['de', 'ko', 'zh', 'es', 'fr']) assert.deepEqual(ids(lang), ids('en'), lang);
  // Emblem-Regel haengt am englischen Namen und gilt auf jeder Sprache.
  const emblem = Object.keys(assets.items).find(id => assets.items[id].name === 'Elderwood Emblem');
  const elder = options.units.find(u => u.traits.includes('Elderwood'));
  for (const lang of ['en', 'ko', 'zh']) {
    const o = buildExplorerOptions(assets, lang);
    if (o.itemById.has(emblem)) assert.equal(itemFitsUnit(o, elder.id, emblem, []), false, lang);
  }
});

test('Satz ohne Unit: nichts wird geraten', () => {
  const q = ask('Guinsoo und Kraken, Infinity Edge oder Deathblade?');
  assert.deepEqual(q.units, []);
  assert.deepEqual(q.fixed, [G, K]);
  assert.deepEqual(q.compare, [IE, DB]);
});

test('Nur Unit, nur Vergleich, unbekannte Woerter', () => {
  assert.deepEqual(ask('best items on Draven', 'en'), { units: [D], fixed: [], compare: [], ambiguous: [] });
  assert.deepEqual(ask('Draven IE oder DB').compare, [IE, DB]);
  assert.deepEqual(ask('foo bar baz'), { units: [], fixed: [], compare: [], ambiguous: [] });
});

test('Laengster Name gewinnt: Infinity Edge ist nicht Edge of Night', () => {
  assert.deepEqual(ask('Draven Infinity Edge').fixed, [IE]);
  assert.deepEqual(ask('Draven Edge of Night').fixed, ['DA_EdgeOfNight']);
});

test('Mehrdeutige Kurzform wird nachgefragt, die Wahl setzt sie ein', () => {
  const q = ask('Draven GS oder DB');
  assert.equal(q.ambiguous.length, 1);
  assert.deepEqual([...q.ambiguous[0].ids].sort(), ['DA_GargoyleStoneplate', 'DA_GiantSlayer']);
  const done = ask('Draven GS oder DB', 'de', { gs: 'DA_GiantSlayer' });
  assert.deepEqual(done.ambiguous, []);
  assert.deepEqual(done.compare, ['DA_GiantSlayer', DB]);
});

test('Name in anderer Sprache und Vorsilbe', () => {
  assert.deepEqual(ask('Draven Klinge des Todes').fixed, [DB]);
  assert.deepEqual(ask('Draven 死亡之刃', 'zh').fixed, [DB]);
  assert.deepEqual(ask('Draven 죽음의 검', 'ko').fixed, [DB]);
  assert.deepEqual(ask('Draven Rabad').fixed, ['DA_RabadonsDeathcap']);
});

test('Chinesisch ohne Leerzeichen: 和 trennt, 或 vergleicht', () => {
  const q = ask('Draven:鬼索的狂暴之刃和海妖之怒,无尽之刃或死亡之刃', 'zh');
  assert.deepEqual(q.fixed, [G, K]);
  assert.deepEqual(q.compare, [IE, DB]);
});

test('Bindewort aus einer Buchstabe gilt nur in seiner Sprache', () => {
  // „o" ist nur auf Spanisch „oder": auf Deutsch waere es ein unbekanntes Wort.
  assert.deepEqual(ask('Draven IE o DB', 'es').compare, [IE, DB]);
  assert.deepEqual(ask('Draven IE o DB', 'de').fixed, [IE, DB]);
});

test('Drei Items ohne oder: das dritte ist die gesuchte Zeile', () => {
  const q = ask('Draven Guinsoo Kraken Deathblade');
  assert.deepEqual(q.fixed, [G, K]);
  assert.deepEqual(q.compare, [DB]);
});

test('Jede Kurzform zeigt auf ein Item des Sets', () => {
  for (const alias of ['ie', 'db', 'jg', 'bt', 'lw', 'hoj', 'eon', 'qss', 'hgb', 'rageblade', 'kraken', 'rabadon', 'cap', 'aa', 'shojin', 'nashor', 'morello', 'bb', 'red', 'ionic', 'sunfire', 'warmog', 'titans', 'garg', 'bramble', 'claw', 'sfh', 'cg', 'steraks', 'flail']) {
    assert.ok(dict.itemsByName.get(alias)?.length, alias);
  }
});

test('Satz in Boxen: gleiche Unit ersetzt, zweite Unit neue leere Box, Grenze haelt', () => {
  const q = { units: [D, 'DA_18_Ezreal'], fixed: [G], compare: [], ambiguous: [] };
  const boxes = applyQuestion([{ ...emptyBox(D), fixed: [K] }], q, kindOf);
  assert.equal(boxes.length, 2);
  assert.deepEqual(boxes[0].fixed, [G]);
  assert.deepEqual(boxes[1].fixed, []);
  const full = Array.from({ length: 6 }, (_, i) => emptyBox(`U${i}`));
  const after = applyQuestion(full, { units: [D], fixed: [], compare: [], ambiguous: [] }, kindOf);
  assert.equal(after.length, 6);
  assert.equal(after[5].unit, D);
});

// ─── Adresse ──────────────────────────────────────────────────────────────

const params = (qs) => new URLSearchParams(qs);

test('Adresse hin und zurueck', () => {
  const boxes = [
    normalizeBox({ ...emptyBox(D), fixed: [K, G], compare: [IE, DB], star: 2, trait: 'DA_18_Elderwood' }),
    normalizeBox({ ...emptyBox('DA_18_Ezreal'), combo: 2, star: 'all', kind: 'artifact' }),
  ];
  const scope = { region: 'euw1', ranks: [], patches: ['18.5c'] };
  const back = parseBuildParams(params(serializeBuildParams(boxes, scope)));
  assert.deepEqual(back.boxes, boxes);
  assert.deepEqual(back.scope, scope);
});

test('Ohne Angaben: Master+, alle Regionen, neuester Patch, kein Parameter', () => {
  assert.equal(serializeBuildParams([], DEFAULT_SCOPE), '');
  assert.deepEqual(parseBuildParams(params('')).scope, DEFAULT_SCOPE);
});

test('Ungueltige und doppelte Boxen fallen still weg', () => {
  const { boxes } = parseBuildParams(params(`b1=${D}&b2=${D}:c2&b3=not%20valid&b4=DA_18_Ezreal:iX!`));
  assert.deepEqual(boxes.map(b => b.unit), [D, 'DA_18_Ezreal']);
  assert.deepEqual(boxes[1].fixed, []);
});

test('Feste Items in beliebiger Reihenfolge ergeben dieselbe Abfrage', () => {
  const a = itemsQuery({ ...emptyBox(D), fixed: [G, K] }, DEFAULT_SCOPE, 2, null);
  const b = itemsQuery({ ...emptyBox(D), fixed: [K, G] }, DEFAULT_SCOPE, 2, null);
  assert.equal(serializeExplorerQuery(a, { forApi: true }), serializeExplorerQuery(b, { forApi: true }));
  assert.equal(a.combo, 3);
});

test('Abfrage hat genau 3 Items an der Unit, Stern und Trait nur wenn gewaehlt', () => {
  const qs = (q) => decodeURIComponent(serializeExplorerQuery(q, { forApi: true }));
  assert.match(qs(itemsQuery(emptyBox(D), DEFAULT_SCOPE, null, null)), new RegExp(`u=${D}:n3e&tab=items&f=${D}$`));
  assert.match(qs(itemsQuery(emptyBox(D), DEFAULT_SCOPE, 2, traitFilterFor('DA_18_Elderwood', [3, 5, 7]))), /u=DA_Draven18:s2e:n3e&t=DA_18_Elderwood:l2/);
  assert.deepEqual(traitFilterFor('DA_18_LuxUniqueTrait', [1]), { id: 'DA_18_LuxUniqueTrait' });
  assert.match(qs(starsQuery(D, DEFAULT_SCOPE)), /tab=units&split=star/);
});

test('1★: Link haelt den Stern, Abfrage filtert genau 1★, Voreinstellung bleibt ab 2★', () => {
  const box = { ...emptyBox(D), star: 1 };
  const back = parseBuildParams(params(serializeBuildParams([box], DEFAULT_SCOPE)));
  assert.equal(back.boxes[0].star, 1);
  assert.equal(effectiveStar(box, 2), 1);
  const qs = decodeURIComponent(serializeExplorerQuery(itemsQuery(box, DEFAULT_SCOPE, effectiveStar(box, 2), null), { forApi: true }));
  assert.match(qs, new RegExp(`u=${D}:s1e:n3e&tab=items`));
  assert.equal(targetStarOf([{ key: D, sub: 1, games: 900 }, { key: D, sub: 2, games: 300 }], D), 2);
  assert.equal(parseBuildParams(params(`b1=${D}:s4`)).boxes[0].star, 'auto');
});

test('Getrennte Seiten: A ohne B gegen B ohne A', () => {
  const qs = (q) => decodeURIComponent(serializeExplorerQuery(q, { forApi: true }));
  const [a, b] = splitQueries(emptyBox(D), DEFAULT_SCOPE, null, null, IE, DB);
  assert.match(qs(a), new RegExp(`:i${IE}:x${DB}`));
  assert.match(qs(b), new RegExp(`:i${DB}:x${IE}`));
  // Kandidat gleich festem Item: 2. Exemplar, das feste Item nicht ausschliessen.
  const [c, d] = splitQueries({ ...emptyBox(D), fixed: [K] }, DEFAULT_SCOPE, null, null, K, DB);
  assert.match(qs(c), new RegExp(`:i${K}:i${K}:x${DB}`));
  assert.ok(!qs(d).includes(`:x${K}`));
});

// ─── Stern ────────────────────────────────────────────────────────────────

test('Zielstern: haeufigster ab 2★, darunter alle', () => {
  const rows = [
    { key: D, sub: null, games: 50000 }, { key: D, sub: 1, games: 30000 },
    { key: D, sub: 2, games: 15000 }, { key: D, sub: 3, games: 200 },
    { key: 'X', sub: 3, games: 99999 },
  ];
  assert.equal(targetStarOf(rows, D), 2);
  assert.equal(targetStarOf([{ key: D, sub: 2, games: 300 }, { key: D, sub: 3, games: 900 }], D), 3);
  assert.equal(targetStarOf([{ key: D, sub: 2, games: 99 }], D), null);
  assert.equal(targetStarOf(null, D), null);
});

// ─── Zeilen ───────────────────────────────────────────────────────────────

const rowOpts = (boxGames) => ({
  boxGames, kindOf,
  known: (id) => options.itemById.has(id),
  fits: () => true,
});
const row = (key, games, avg, half = 0.1) => ({ key, sub: null, sub2: null, games, matches: games, avg, top4: 0.5, top1: 0.1, half, dOut: null, dOutHalf: null, dBase: null, dBaseHalf: null });

test('restOf zieht jedes feste Item nur einmal ab', () => {
  assert.deepEqual(restOf(`${G}|${K}|${K}`, [G, K]), [K]);
  assert.deepEqual(restOf(`${G}|${K}|${DB}`, [G, K]), [DB]);
  assert.equal(restOf(`${DB}|${K}|${IE}`, [G, K]), null);
});

test('Zwei feste Items: drittes Item nach Ø, doppeltes Exemplar sichtbar, fremde Trios raus', () => {
  const b = { ...emptyBox(D), fixed: [G, K], combo: 3 };
  const rows = boxRows([
    row(`${DB}|${G}|${K}`, 6200, 3.67), row(`${G}|${IE}|${K}`, 5848, 3.82),
    row(`${G}|${K}|${K}`, 1801, 3.42), row(`${DB}|${IE}|${K}`, 9000, 3.0),
  ], b, rowOpts(25169));
  assert.deepEqual(rows.map(r => r.restKey), [K, DB, IE]);
  assert.deepEqual(rows[0].doubled, [K]);
});

test('Ein festes Item, Duo: nur Paare mit dem festen Item', () => {
  const b = normalizeBox({ ...emptyBox(D), fixed: [K], combo: 2 });
  const rows = boxRows([row(`${DB}|${K}`, 6200, 3.67), row(`${DB}|${IE}`, 7000, 3.2)], b, rowOpts(25169));
  assert.deepEqual(rows.map(r => r.restKey), [DB]);
});

test('Mindestspiele: 30, in grossen Boxen 1 %; seltene Zeilen bleiben, stehen aber unten', () => {
  assert.equal(minRowGames(1000), 30);
  assert.equal(minRowGames(25169), 252);
  const rows = boxRows([row(DB, 200, 1.0), row('DA_LastWhisper', 240, 3.1), row(IE, 300, 3.5)], emptyBox(D), rowOpts(25169));
  assert.deepEqual(rows.map(r => r.restKey), [IE, 'DA_LastWhisper', DB]);
  assert.deepEqual(rows.map(r => r.thin), [false, true, true]);
});

const fullOpts = (games, rules = { unique: new Set(), hidden: new Set() }) => ({ ...rowOpts(games), allItems: options.items, rules });
const artifacts = options.items.filter(i => i.bucket === 'artifact').map(i => i.id);

test('Ein Platz frei: jedes Artefakt steht in der Liste, auch ohne Spiele', () => {
  const b = { ...emptyBox(D), fixed: [G, K], combo: 3 };
  const rows = boxRows([row(`${DB}|${G}|${K}`, 6200, 3.67), row(`${artifacts[0]}|${G}|${K}`, 141, 3.0)], b, fullOpts(17678));
  const listed = rows.filter(r => r.kind === 'artifact');
  assert.deepEqual(listed.map(r => r.restKey).sort(), [...artifacts].sort());
  assert.equal(listed[0].restKey, artifacts[0]);
  assert.equal(listed[0].noData, false);
  assert.equal(listed[1].noData, true);
  assert.equal(listed[1].avg, null);
  assert.equal(rows[0].restKey, DB);
});

test('Zwei freie Plaetze: nur gemessene Paare, keine erfundenen', () => {
  const rows = boxRows([row(`${DB}|${IE}`, 10, 3.0)], { ...emptyBox(D), combo: 2 }, fullOpts(17678));
  assert.deepEqual(rows.map(r => r.restKey), [`${DB}|${IE}`]);
});

test('Doppelauswahl: jedes feste Item, ausser Unique und Emblem; ohne Texte keine', () => {
  const unique = 'DA_Artifact_ZhonyasParadox';
  const rules = { unique: new Set([unique]), hidden: new Set() };
  const opts = { ...fullOpts(12287, rules), fits: (id, carried) => itemFitsUnit(options, D, id, carried) };
  const double = (id) => boxRows([], normalizeBox({ ...emptyBox(D), fixed: [id] }), opts).find(r => r.restKey === id);
  assert.deepEqual(double(IE).doubled, [IE]);
  assert.equal(double(IE).noData, true);
  assert.equal(canFix(1, double(IE).rest), true);
  assert.equal(double(unique), undefined);
  const emblem = options.items.find(i => i.bucket === 'emblem').id;
  assert.equal(double(emblem), undefined);
  const noTexts = { ...opts, rules: null };
  assert.equal(boxRows([], normalizeBox({ ...emptyBox(D), fixed: [IE] }), noTexts).some(r => r.restKey === IE), false);
  // Gemessene Doppelzeile eines Unique-Items faellt ebenfalls raus.
  assert.equal(boxRows([row(`${unique}|${unique}`, 50, 3.0)], normalizeBox({ ...emptyBox(D), fixed: [unique] }), opts).some(r => r.restKey === unique), false);
});

test('Drei gleiche Items an einer Unit sind moeglich', () => {
  const rows = boxRows([row(`${K}|${K}|${K}`, 200, 3.0)], normalizeBox({ ...emptyBox(D), fixed: [K, K], combo: 3 }), fullOpts(3000));
  assert.equal(rows.find(r => r.restKey === K).noData, false);
});

test('Diebeshandschuhe: nicht festsetzbar, aus alten Links raus, sobald etwas fest ist nicht in der Liste', () => {
  const glove = 'DA_ThiefsGloves';
  assert.equal(canFix(0, [glove]), false);
  assert.deepEqual(normalizeBox({ ...emptyBox(D), fixed: [glove, DB] }).fixed, [DB]);
  assert.equal(boxRows([], normalizeBox({ ...emptyBox(D), fixed: [DB] }), fullOpts(100)).some(r => /ThiefsGloves/.test(r.restKey)), false);
  assert.equal(boxRows([], emptyBox(D), fullOpts(100)).some(r => r.restKey === glove), true);
});

test('Item-Texte: Unique und Einweg-Traenke aus der echten Datei', () => {
  const rules = itemListRules(texts);
  assert.deepEqual([...rules.unique].sort(), ['DA_Artifact_GamblersBlade', 'DA_Artifact_GoldCollector', 'DA_Artifact_MogulsMail', 'DA_Artifact_VoidGauntlet', 'DA_Artifact_ZhonyasParadox']);
  assert.equal(rules.hidden.has('DA_HealthPotion18_Radiant'), true);
  assert.equal(rules.hidden.has(DB), false);
  assert.equal(itemListRules(null), null);
  const rows = boxRows([], emptyBox(D), fullOpts(100, rules));
  assert.equal(rows.some(r => r.restKey === 'DA_HealthPotion18_Radiant'), false);
});

test('Zeilengrenze gleich dem Dienst', () => {
  assert.equal(EXPLORER_ROW_CAP, ROW_LIMIT);
});

test('Taktiker, Augment-Items und Diebeshandschuhe', () => {
  const glove = 'DA_ThiefsGloves';
  const list = [row(glove, 500, 3.0), row('DA_TacticiansCrown', 500, 3.0), row(DB, 500, 3.5), row('DA_18_EmblemFloraFatalisAugment', 500, 3.0)];
  assert.deepEqual(boxRows(list, emptyBox(D), rowOpts(1000)).map(r => r.restKey), [glove, DB]);
  const duo = [row(`${glove}|${DB}`, 500, 3.0), row(`${DB}|${IE}`, 500, 3.5)];
  assert.deepEqual(boxRows(duo, { ...emptyBox(D), combo: 2 }, rowOpts(1000)).map(r => r.restKey), [`${DB}|${IE}`]);
});

test('Item-Sorten kommen in ihren Reiter', () => {
  const rows = boxRows([
    row(DB, 500, 3.5), row('DA_Artifact_WitsEnd', 500, 3.0), row('DA_CrownguardRadiant', 500, 3.0),
    row(options.items.find(i => i.bucket === 'emblem').id, 500, 3.0),
  ], emptyBox(D), rowOpts(1000));
  assert.deepEqual([...new Set(rows.map(r => r.kind))].sort(), ['artifact', 'emblem', 'radiant', 'standard']);
});

test('Festsetzen nur, solange etwas zu vergleichen bleibt', () => {
  assert.equal(canFix(0, [DB]), true);
  assert.equal(canFix(1, [DB]), true);
  assert.equal(canFix(2, [DB]), false);
  assert.equal(canFix(0, [DB, IE, K]), false);
});

test('Combo folgt den festen Items, verglichene Zeilen muessen passen', () => {
  assert.equal(normalizeBox({ ...emptyBox(D), fixed: [G] }).combo, 2);
  assert.equal(normalizeBox({ ...emptyBox(D), fixed: [G, K] }).combo, 3);
  assert.deepEqual(normalizeBox({ ...emptyBox(D), combo: 3, compare: [DB, `${IE}|${K}|${DB}`] }).compare, [`${IE}|${K}|${DB}`]);
});

// ─── Urteil ───────────────────────────────────────────────────────────────

const side = (avg, half, games = 5000) => ({ avg, half, games });

test('Urteil mit den Messungen vom 01.11.', () => {
  // Draven, Guinsoo + Kraken, Master+: Deathblade vor Infinity Edge.
  assert.deepEqual(verdictOf(side(3.671, 0.06), side(3.82, 0.06)), { state: 'better', winner: 0, diff: 0.15 });
  // Mit Elderwood: kein klarer Unterschied.
  assert.deepEqual(verdictOf(side(3.19, 0.19), side(3.23, 0.18)), { state: 'tie' });
  // EUW, Master+: die Bereiche ueberlappen, obwohl der Abstand reicht.
  assert.deepEqual(verdictOf(side(3.87, 0.15), side(3.73, 0.19)), { state: 'tie' });
  // Alle Raenge, 2★: Giant Slayer und Deathblade gleichauf.
  assert.deepEqual(verdictOf(side(2.73, 0.08), side(2.72, 0.04)), { state: 'tie' });
});

test('Urteil: zu wenig Spiele, Gewinner auf der anderen Seite, Grenze am angezeigten Wert', () => {
  assert.deepEqual(verdictOf(side(3.0, 0.1, VERDICT_MIN_GAMES - 1), side(4.0, 0.1)), { state: 'few' });
  assert.equal(verdictOf(side(4.0, 0.05), side(3.0, 0.05)).winner, 1);
  // Roh 0,149, angezeigt 3,67 zu 3,82: gilt als 0,15.
  assert.equal(verdictOf(side(3.6714, 0.02), side(3.8204, 0.02)).state, 'better');
  // Angezeigt 0,14: darunter.
  assert.equal(verdictOf(side(3.68, 0.02), side(3.82, 0.02)).state, 'tie');
});
