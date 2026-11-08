import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateLiveStandings,
  inLiveWindow,
  liveStarted,
  liveTournamentsToCheck,
  parseBracketGrid,
  sheetTabs,
  stageName,
  staleStages,
} from './tft-live-standings.mjs';

const grid = (text) => text.trim().split('\n').map(l => l.split(','));

// Auszuege der echten Tabelle TOC 2026 Fall Regional Finals (03.11.2026).
const PI_SCORE = grid(`
,,,,,,,,,,,,,
,Flag,Bracket ID,English ID,R1,R2,R3,R4,R5,R6,Place,TOTAL,Wx2+T4,Top1
1,cn,白纸,baizhi,7,1,5,4,7,4,,28,3,0
2,cn,日月,Riyue,8,6,8,5,2,8,,37,8,3
,,,,,,,,,,,,,
,Flag,Bracket ID,English ID,R1,R2,R3,R4,R5,R6,Place,TOTAL,Wx2+T4,Top1
#1,cn,日月,Riyue,8,6,8,5,2,8,,37,8,3
#2,cn,大牙很帅,daya cool,6,6,8,6,7,4,,37,6,1
#3,cn,天龙,TianLong,6,3,2,8,8,8,,35,7,3
`);

const SS_SCORE = grid(`
,,,,,,,,,,,,,,,,,,,
,Flag,Bracket ID,English ID,R1,R2,R3,R4,R5,R6,R7,R8,R9,R10,R11,R12,R13,Place,TOTAL
10,cn,大牙很帅,daya cool,5,4,5,2,2,4,-,-,-,,,,,,22
1,cn,红莲,Lotus,8,8,2,7,6,8,6,3,8,,,,,,56
,,,,,,,,,,,,,,,,,,,
#,Flag,Bracket ID,English ID,R1,R2,R3,R4,R5,R6,R7,R8,R9,R10,R11,R12,R13,Place,TOTAL
#1,cn,红莲,Lotus,8,8,2,7,6,8,6,3,8,,,,,,56
#2,cn,白纸,baizhi,6,6,6,8,7,4,3,8,6,,,,,,54
#31,cn,大牙很帅,daya cool,5,4,5,2,2,4,-,-,-,,,,,,22
`);

// Finale: keine TOTAL-Spalte. Der gereihte Block beginnt mit „#1" ohne Kopf-Marke.
const FINAL_EMPTY = grid(`
,,,,,,,,,,,,,,,
,Flag,Bracket ID,English ID,R1,R2,R3,R4,R5,R6,R7,R8,Place,Wx2+T4,Top1,Top2
,,,,,,,,,,,,,0,0,0
,,,,,,,,,,,,,,,
,Flag,Bracket ID,English ID,R1,R2,R3,R4,R5,R6,R7,R8,Place,Wx2+T4,Top1,Top2
#1,,,,,,,,,,,,,0,0,0
#2,,,,,,,,,,,,,0,0,0
`);
const FINAL_FILLED = grid(`
,,,,,,,,,,,,,,,
,Flag,Bracket ID,English ID,R1,R2,R3,R4,R5,R6,R7,R8,Place,Wx2+T4,Top1,Top2
1,cn,红莲,Lotus,8,1,,,,,,,,0,0,0
2,cn,白纸,baizhi,3,8,,,,,,,,0,0,0
,,,,,,,,,,,,,,,
,Flag,Bracket ID,English ID,R1,R2,R3,R4,R5,R6,R7,R8,Place,Wx2+T4,Top1,Top2
#1,cn,白纸,baizhi,3,8,,,,,,,,0,0,0
#2,cn,红莲,Lotus,8,1,,,,,,,,0,0,0
`);
const FINAL_NAMES_ONLY = grid(`
,Flag,Bracket ID,English ID,R1,R2,Place,Wx2+T4
#1,cn,白纸,baizhi,,,,0
#2,cn,红莲,Lotus,,,,0
`);

const PLAYER_LIST = grid(`
,,,,,,,,
,#,Flag,Bracket ID,English ID,Qualifications,Qual #,Starting Stage
,1,cn,小蜜蜂电竞丶C,Circle,Netcafe-Wanyoo,2,Play-ins
,10,cn,初七,Chuqi,Platform-Yunyi,5,Play-ins
`);
const PI_LOBBY = grid(`
,English ID,G1,G2
#1,Riyue,3,4
`);

test('Bracket: nimmt den gereihten Block, Platz aus #n, Gleichstand bleibt', () => {
  const rows = parseBracketGrid(PI_SCORE);
  assert.deepEqual(rows.map(r => [r.placement, r.raw, r.points]), [[1, 'Riyue', 37], [2, 'daya cool', 37], [3, 'TianLong', 35]]);
  assert.equal(rows[0].games, 6);
  assert.equal(rows[0].region, null);   // Flag ist keine Region
});

test('Bracket: ausgeschiedene Spieler zaehlen nur ihre gespielten Runden', () => {
  const rows = parseBracketGrid(SS_SCORE);
  assert.equal(rows[0].raw, 'Lotus');
  const out = rows.find(r => r.raw === 'daya cool');
  assert.deepEqual([out.placement, out.points, out.games], [31, 22, 6]);
});

test('Bracket: Finale ohne TOTAL rechnet die Runden zusammen', () => {
  assert.equal(parseBracketGrid(FINAL_EMPTY), null);
  assert.equal(parseBracketGrid(FINAL_NAMES_ONLY), null);   // Namen da, noch keine Runde
  assert.deepEqual(parseBracketGrid(FINAL_FILLED).map(r => [r.placement, r.raw, r.points]), [[1, 'baizhi', 11], [2, 'Lotus', 9]]);
});

test('Bracket: Name faellt auf Bracket ID zurueck', () => {
  const rows = parseBracketGrid(grid(`
,Flag,Bracket ID,English ID,R1,TOTAL
#1,cn,日月,,8,8
`));
  assert.equal(rows[0].raw, '日月');
});

test('Bracket: Spieler-Liste und Lobby-Reiter sind keine Rangliste', () => {
  assert.equal(parseBracketGrid(PLAYER_LIST), null);
  assert.equal(parseBracketGrid(PI_LOBBY), null);
  // Andere Formate bleiben beim alten Leser.
  assert.equal(parseBracketGrid(grid('Name,Points\nAlice,12')), null);
});

test('Bracket: ein Block mit laufender Nummer wird nie genommen', () => {
  assert.equal(parseBracketGrid(grid(`
,Flag,Bracket ID,English ID,R1,TOTAL
1,cn,日月,Riyue,8,8
2,cn,白纸,baizhi,7,7
`)), null);
});

test('Reiter-Liste aus dem Seitenquelltext, Stufennamen', () => {
  const html = 'var items = [];items.push({name: "Player List", pageUrl: "https:\\/\\/x", gid: "1414310532",initialSheet: true});'
    + 'items.push({name: "Days 1 \\x26 2", pageUrl: "https:\\/\\/y", gid: "7"});';
  assert.deepEqual(sheetTabs(html), [
    { name: 'Player List', gid: '1414310532', order: 0 },
    { name: 'Days 1 & 2', gid: '7', order: 1 },
  ]);
  assert.equal(stageName('PI-Score'), 'Play-ins');
  assert.equal(stageName('SS-Score'), 'Swiss Stage');
  assert.equal(stageName('TOC-Final'), 'TOC-Final');
  assert.equal(stageName('constructor'), 'constructor');
});

const at = (s) => Date.parse(s);
const TOUR = { id: 'toc', start_date: '2026-10-23', end_date: '2026-11-07' };

test('Fenster: Start−2 bis Ende+1, begonnen erst ab Start+1', () => {
  assert.equal(inLiveWindow(TOUR, at('2026-10-20T23:59:00Z')), false);
  assert.equal(inLiveWindow(TOUR, at('2026-10-21T00:00:00Z')), true);
  assert.equal(inLiveWindow(TOUR, at('2026-11-09T00:00:00Z')), true);
  assert.equal(inLiveWindow(TOUR, at('2026-11-09T00:00:01Z')), false);
  assert.equal(inLiveWindow({ id: 'x', start_date: null, end_date: null }, at('2026-11-01T00:00:00Z')), false);
  assert.equal(liveStarted(TOUR, at('2026-10-23T23:00:00Z')), false);
  assert.equal(liveStarted(TOUR, at('2026-10-24T00:00:00Z')), true);
});

test('Vertrag: prueft nur laufende Turniere, Ausnahmeliste wirkt', () => {
  const now = at('2026-11-03T12:00:00Z');
  const later = { id: 'later', start_date: '2026-11-13', end_date: '2026-11-15' };
  const soon = { id: 'soon', start_date: '2026-11-03', end_date: '2026-11-04' };
  assert.deepEqual(liveTournamentsToCheck([TOUR, later, soon], now).map(t => t.id), ['toc']);
  assert.deepEqual(liveTournamentsToCheck([TOUR], now, ['toc']), []);
});

test('Vertrag: Bewertung', () => {
  const now = at('2026-11-03T12:00:00Z');
  const ago = (h) => new Date(now - h * 3_600_000).toISOString();
  const run = (rows) => evaluateLiveStandings([TOUR], new Map([['toc', rows]]), { now });

  assert.equal(evaluateLiveStandings([], new Map(), { now }).status, 'ok');
  assert.equal(run([{ stage: 'A', fetched_at: ago(1) }]).status, 'ok');
  assert.equal(run([{ stage: 'A', fetched_at: ago(2.9) }]).status, 'ok');   // Timer stuendlich + Streuung

  const never = run([]);
  assert.equal(never.status, 'warn');
  assert.match(never.detail, /noch nie Zeilen/);

  const stale = run([{ stage: 'A', fetched_at: ago(3.1) }]);
  assert.equal(stale.status, 'broken');
  assert.match(stale.detail, /3\.1 h/);

  // Eine Stufe bleibt zurueck, die neueste ist frisch → gelb, nicht rot.
  const lag = run([{ stage: 'A', fetched_at: ago(1) }, { stage: 'B', fetched_at: ago(7.5) }]);
  assert.equal(lag.status, 'warn');
  assert.match(lag.detail, /Stufe bleibt zurueck: B/);
  assert.equal(run([{ stage: 'A', fetched_at: ago(1) }, { stage: 'B', fetched_at: ago(6.5) }]).status, 'ok');

  // Mehrere Zeilen je Stufe: die neueste zaehlt.
  assert.equal(run([{ stage: 'A', fetched_at: ago(9) }, { stage: 'A', fetched_at: ago(1) }]).status, 'ok');
});

test('staleStages: umbenannte Reiter, nur je Quelle', () => {
  const db = [
    { source: 'gsheet', stage: 'TOC-Semifinal' }, { source: 'gsheet', stage: 'TOC-Semifinal' },
    { source: 'gsheet', stage: 'Semifinals' }, { source: 'gsheet', stage: 'TOC-Final' },
    { source: 'apactft', stage: 'Standings' },
  ];
  const seen = new Map([['gsheet', new Set(['Semifinals', 'Finals'])]]);
  assert.deepEqual(staleStages(db, seen), [
    { source: 'gsheet', stage: 'TOC-Semifinal' }, { source: 'gsheet', stage: 'TOC-Final' },
  ]);
  // Quelle ohne gelesene Stufen: nichts loeschen (apactft oben bleibt, leeres Set ebenso).
  assert.deepEqual(staleStages(db, new Map([['gsheet', new Set()]])), []);
  assert.deepEqual(staleStages([], seen), []);
  // Alles noch geliefert: nichts.
  assert.deepEqual(staleStages([{ source: 'gsheet', stage: 'Finals' }], seen), []);
});
