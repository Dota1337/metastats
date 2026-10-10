import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  jsonish, parseBoardPieces, parseShop, parseLevel, parseStage, stageToRound,
  parseOpponent, gameTimeToRound, isTftMode,
  TFT_GAME_IDS, LAUNCHER_IDS, gameClassId, isTftGame, tftFromGame, featuresFor, parseLocalPlayer, parseRoster, wonMatch,
  parseRoundKind, parseItemSelect, parseLauncherInfo, isTftOnlyGame,
  fightToRound, fightsLowerBound, regionFromHandle,
} from './gep.ts';

test('jsonish nimmt Objekt und JSON-Text, kaputter Text wird null', () => {
  assert.deepEqual(jsonish('{"a":1}'), { a: 1 });
  assert.deepEqual(jsonish({ a: 1 }), { a: 1 });
  assert.equal(jsonish('{kaputt'), null);
  assert.equal(jsonish(''), null);
});

test('parseBoardPieces liest cell_N mit Items und ueberspringt Fremdschluessel', () => {
  const raw = JSON.stringify({
    cell_3: { name: 'DA_18_Tristana', level: '2', item_1: 'A', item_2: '', item_3: 'C' },
    bench_1: { name: 'X' },
    cell_x: { name: 'Y' },
  });
  assert.deepEqual(parseBoardPieces(raw), [{ cell: 3, unit: 'DA_18_Tristana', level: 2, items: ['A', 'C'] }]);
  assert.deepEqual(parseBoardPieces(null), []);
});

test('parseShop liefert immer 5 Plaetze, gekaufte sind leer', () => {
  const shop = parseShop('{"slot_1":{"name":"A"},"slot_3":{"name":""},"slot_5":{"name":"E"},"slot_9":{"name":"Z"}}');
  assert.deepEqual(shop, ['A', null, null, null, 'E']);
  assert.deepEqual(parseShop('nicht json'), [null, null, null, null, null]);
});

test('parseLevel prueft den Bereich', () => {
  assert.equal(parseLevel('{"level":7}'), 7);
  assert.equal(parseLevel({ level: '9' }), 9);
  assert.equal(parseLevel({ level: 0 }), null);
  assert.equal(parseLevel({ level: 11 }), null);
  assert.equal(parseLevel(null), null);
});

test('Stufe und Runde', () => {
  assert.equal(parseStage('{"stage":"3-2","type":"PVP"}'), '3-2');
  assert.equal(parseStage({ stage: 'Carousel' }), null);
  assert.equal(stageToRound('3-2'), 32);
  assert.ok(stageToRound('4-1')! > stageToRound('3-7')!);
  assert.equal(stageToRound(null), null);
});

test('parseOpponent mit und ohne Tag', () => {
  assert.equal(parseOpponent('{"name":"Foo","tag_line":"EUW"}'), 'Foo#EUW');
  assert.equal(parseOpponent({ name: 'Bar' }), 'Bar');
  assert.equal(parseOpponent({}), null);
});

test('gameTimeToRound ist begrenzt und steigt', () => {
  assert.equal(gameTimeToRound(-5), 0);
  assert.equal(gameTimeToRound(NaN), 0);
  assert.equal(gameTimeToRound(70), 2);
  assert.equal(gameTimeToRound(99999), 60);
});

test('isTftMode unterscheidet TFT von Kluft', () => {
  assert.equal(isTftMode('TFT'), true);
  assert.equal(isTftMode('tft'), true);
  assert.equal(isTftMode('LOL'), false);
  assert.equal(isTftMode(''), null);
  assert.equal(isTftMode(undefined), null);
});

test('Manifest: Overlays nur fuer TFT-Spiele, Start und Ereignisse auch mit dem League-Client', () => {
  const m = JSON.parse(readFileSync(new URL('../../public/manifest.json', import.meta.url), 'utf8'));
  const tft = [...TFT_GAME_IDS].sort();
  const all = [...TFT_GAME_IDS, ...LAUNCHER_IDS].sort();
  assert.deepEqual([...m.data.game_targeting.game_ids].sort(), tft);
  assert.deepEqual([...m.data.game_events].sort(), all);
  assert.deepEqual([...m.data.launch_events[0].event_data.game_ids].sort(), all);
  // Der Client darf nie als laufendes TFT-Spiel gelten (sonst Bug B2).
  for (const id of LAUNCHER_IDS) assert.equal(isTftGame(id), false);
});

test('parseRoundKind: PVP / PVE / Carousel, unbekannt = other', () => {
  assert.equal(parseRoundKind('{"stage":"3-2","type":"PVP"}'), 'pvp');
  assert.equal(parseRoundKind({ stage: '4-7', type: 'PVE' }), 'pve');
  assert.equal(parseRoundKind({ stage: '4-4', name: 'Carousel', type: 'Carousel' }), 'carousel');
  assert.equal(parseRoundKind({ type: 'Encounter' }), 'other');
  assert.equal(parseRoundKind(null), null);
});

test('parseItemSelect: Kartenreihenfolge, leere Auswahl', () => {
  // Echtes Angebot aus dem Log vom 09.10. 21:23 (gemischt).
  const raw = '{"item_1":{"name":"DA_Component_ChainVest"}, "item_2":{"name":"DA_ThiefsGloves"}, "item_3":{"name":"DA_18_EmblemBlossom"}, "item_4":{"name":"DA_Reforger"}}';
  assert.deepEqual(parseItemSelect(raw), ['DA_Component_ChainVest', 'DA_ThiefsGloves', 'DA_18_EmblemBlossom', 'DA_Reforger']);
  assert.deepEqual(parseItemSelect({ item_2: { name: 'B' }, item_1: { name: 'A' } }), ['A', 'B']);
  assert.deepEqual(parseItemSelect(null), []);
  assert.deepEqual(parseItemSelect('null'), []);
});

test('parseLauncherInfo: Queue, Phase, Region', () => {
  assert.deepEqual(parseLauncherInfo({ lobby_info: { queueId: '1160' } }), { queueId: 1160 });
  assert.deepEqual(parseLauncherInfo({ lobby_info: '{"queueId":"0"}' }), { queueId: null });
  assert.deepEqual(parseLauncherInfo({ game_flow: { phase: 'InProgress' }, summoner_info: { platform_id: 'EUW1' } }), { phase: 'InProgress', platform: 'euw1' });
  assert.deepEqual(parseLauncherInfo(null), {});
});

test('isTftOnlyGame: 28164/21570 ja, 5426 nein', () => {
  assert.equal(isTftOnlyGame(28164), true);
  assert.equal(isTftOnlyGame(21570), true);
  assert.equal(isTftOnlyGame(5426), false);
  assert.equal(isTftOnlyGame(null), false);
});

test('Shop: "Sold" ist ein leerer Platz', () => {
  assert.deepEqual(parseShop({ slot_1: { name: 'Sold' }, slot_2: { name: 'DA_18_X' } }), [null, 'DA_18_X', null, null, null]);
});

test('parseLocalPlayer findet den eigenen Eintrag und nimmt nur Platz 1-8', () => {
  const raw = JSON.stringify({ Other: { localplayer: false, rank: 3 }, Me: { localplayer: true, rank: '', tag_line: 'EUW' } });
  assert.deepEqual(parseLocalPlayer(raw), { name: 'Me#EUW', rank: null });
  assert.deepEqual(parseLocalPlayer({ Me: { localplayer: 'true', rank: 4 } }), { name: 'Me', rank: 4 });
  assert.deepEqual(parseLocalPlayer({ Me: { localplayer: true, rank: 0 } }), { name: 'Me', rank: null });
  assert.equal(parseLocalPlayer({ A: { localplayer: false } }), null);
  assert.equal(parseLocalPlayer('kaputt'), null);
});

test('parseRoster liest alle Spieler mit Leben, Platz und Namen#Tag', () => {
  const raw = JSON.stringify({
    'TFT Chillout': { index: 5, health: 58, xp: 8, localplayer: true, rank: 0, tag_line: 'EUW' },
    'Gegner#X': { health: '0', rank: 7 },
    Leer: null,
  });
  assert.deepEqual(parseRoster(raw), [
    { name: 'TFT Chillout#EUW', health: 58, rank: null, local: true },
    { name: 'Gegner#X', health: 0, rank: 7, local: false },
  ]);
  assert.deepEqual(parseRoster({ A: { health: '' } }), [{ name: 'A', health: null, rank: null, local: false }]);
  assert.deepEqual(parseRoster('{}'), []);
  assert.deepEqual(parseRoster('kaputt'), []);
});

test('wonMatch: Platz 1, sobald alle sieben anderen einen Platz haben', () => {
  const others = (ranks: Array<number | null>) => ranks.map((rank, i) => ({ name: `P${i}`, health: rank ? 0 : 20, rank, local: false }));
  const me = { name: 'Me', health: 30, rank: null, local: true };
  assert.equal(wonMatch([me, ...others([2, 3, 4, 5, 6, 7, 8])]), true);
  assert.equal(wonMatch([me, ...others([null, 3, 4, 5, 6, 7, 8])]), false);   // einer lebt noch
  assert.equal(wonMatch([{ ...me, rank: 2 }, ...others([1, 3, 4, 5, 6, 7, 8])]), false);
  assert.equal(wonMatch(others([2, 3, 4, 5, 6, 7, 8])), false);              // eigener Spieler fehlt
  assert.equal(wonMatch([me, ...others([2, 3, 4])]), false);                 // Liste unvollstaendig
});

test('fightToRound folgt dem TFT-Ablauf', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 10, 11].map(fightToRound), [21, 22, 23, 25, 26, 31, 36, 41]);
  assert.equal(fightToRound(0), 21);
});

test('fightsLowerBound bleibt vorsichtig und begrenzt', () => {
  assert.equal(fightsLowerBound(100), 0);
  assert.equal(fightsLowerBound(180), 0);
  assert.equal(fightsLowerBound(180 + 75 * 4), 4);
  assert.equal(fightsLowerBound(1e6), 40);
  assert.equal(fightsLowerBound(NaN), 0);
});

test('Spiel-Kennungen: 28164 und 21570 sind sicher TFT, 5426 offen', () => {
  assert.equal(gameClassId({ classId: 28164 }), 28164);
  assert.equal(gameClassId({ id: 281641 }), 28164);
  assert.equal(gameClassId(null), null);
  assert.equal(tftFromGame(28164), true);
  assert.equal(tftFromGame(21570), true);
  assert.equal(tftFromGame(5426), null);
  assert.equal(tftFromGame(7764), false);
  assert.equal(isTftGame(5426), true);
  assert.equal(isTftGame(7764), false);
  assert.ok(!featuresFor(28164).includes('live_client_data'));
  assert.ok(featuresFor(5426).includes('live_client_data'));
  assert.ok(featuresFor(28164).includes('roster'));
  // 28164 bestaetigt game_info nie (45 Erfolgsmeldungen im Log, 07.-09.10.).
  assert.ok(!featuresFor(28164).includes('game_info'));
  assert.ok(featuresFor(5426).includes('game_info'));
  assert.ok(featuresFor(21570).includes('live_client_data'));
  for (const id of [28164, 21570, 5426]) assert.ok(!featuresFor(id).includes('bench'));
});

test('regionFromHandle nur bei bekanntem Tag', () => {
  assert.equal(regionFromHandle('X#EUW'), 'euw1');
  assert.equal(regionFromHandle('X#kr1'), null);
  assert.equal(regionFromHandle('X#1234'), null);
  assert.equal(regionFromHandle('X'), null);
  assert.equal(regionFromHandle(null), null);
});
