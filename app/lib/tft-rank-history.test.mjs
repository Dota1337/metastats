/**
 * Rang pro Set = Endrang + hoechste LP (User 2026-09-28).
 * Fixture-Werte sind die echten MetaTFT-Antworten vom 2026-09-28 fuer
 * TFT Chillout#EUW und Loescher#Yerba.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMetatftProfile, mergeRankSources, refreshMode, applyRankOverrides, peakFromLeagueLogs, gamesFromLeagueLogs, endFromLeagueLogs, RANK_SCHEMA_AT_MS } from './tft-rank-history.ts';
import { setRankDisplay, withLiveRank, lastRowPerSet, setMaxLp, setEndRank } from './tft-rank-kind.ts';

const START = Date.parse('2026-08-26T14:08:32.809Z');
const CHILLOUT = 'NQoWt3WdMPUlQxeianc3L4nBVz8_TXwvW8h34YNVTKs2s7DKVgydtHnLwOFrt5fT6aKxSyfPB0O2Aw';
const profile = (h) => ({ rating_history: Object.fromEntries(Object.entries(h).map(([k, v]) => [k, { 1100: v }])) });

test('Chillout Set 17: Master (Ende) mit 460 LP (Hoechstwert GM)', () => {
  const rows = parseMetatftProfile(profile({
    TFTSet17: { rating_text: 'MASTER I 0 LP', peak_rating: 'GRANDMASTER I 460 LP', timestamp: '2026-08-05T11:57:54.031' },
  }), 18, START);
  assert.deepEqual(setRankDisplay(rows[0]), { tier: 'MASTER', div: null, lp: 460 });
});

test('Loescher Set 17: Master mit 1687 LP trotz Abfall auf 0', () => {
  const rows = parseMetatftProfile(profile({
    TFTSet17: { rating_text: 'MASTER I 0 LP', peak_rating: 'CHALLENGER I 1687 LP', timestamp: '2026-08-01T23:06:21.122' },
  }), 18, START);
  assert.deepEqual(setRankDisplay(rows[0]), { tier: 'MASTER', div: null, lp: 1687 });
});

test('1970-Eintrag (Set 8.5/9) liefert keinen Endrang, dakgg fuellt ihn', () => {
  const mt = parseMetatftProfile(profile({
    TFTSet9: { rating_text: 'MASTER I 0 LP', timestamp: '1970-01-01T00:00:00' },
  }), 18, START);
  assert.equal(mt.length, 0);
  const dk = [{ set_number: 9, set_label: 'TFTSet9', end_tier: 'DIAMOND', end_division: 'II', peak_tier: null, peak_lp: null, source: 'dakgg' }];
  const [m] = mergeRankSources(mt, dk, [], 18);
  assert.deepEqual(setRankDisplay(m), { tier: 'DIAMOND', div: 'II', lp: null });
});

test('unter Master keine LP, auch wenn der Hoechstwert Master war', () => {
  assert.deepEqual(
    setRankDisplay({ set_number: 16, set_label: 'TFTSet16', end_tier: 'DIAMOND', end_division: 'I', end_lp: 80, peak_tier: 'MASTER', peak_lp: 120 }),
    { tier: 'DIAMOND', div: 'I', lp: null },
  );
});

test('Master-Ende ohne Hoechstwert (nur dakgg): keine LP', () => {
  assert.deepEqual(
    setRankDisplay({ set_number: 8, set_label: 'TFTSet8', end_tier: 'MASTER', end_division: 'I', peak_tier: null, peak_lp: null }),
    { tier: 'MASTER', div: null, lp: null },
  );
});

test('ohne Endrang wird nichts gezeigt, nie der Hoechstrang', () => {
  assert.equal(setRankDisplay({ set_number: 15, set_label: 'TFTSet15', peak_tier: 'CHALLENGER', peak_lp: 900 }), null);
});

test('Ausnahme Chillout Set 8.2 = Challenger 760 LP', () => {
  const rows = applyRankOverrides(CHILLOUT, [
    { set_number: 8, set_label: 'TFTSet8_2', end_tier: 'MASTER', end_division: 'I', peak_tier: null, peak_lp: null, source: 'dakgg' },
  ], 18);
  assert.deepEqual(setRankDisplay(rows[0]), { tier: 'CHALLENGER', div: null, lp: 760 });
  assert.equal(applyRankOverrides('anderer', [], 18).length, 0, 'gilt nur fuer Chillout');
  assert.equal(applyRankOverrides(CHILLOUT, [], 18)[0].set_label, 'TFTSet8_2', 'auch ohne gespeicherte Zeile');
});

test('Merge: MetaTFT-Ausfall behaelt Hoechstwert, dakgg fuellt nur das Ende', () => {
  const existing = [{ set_number: 17, set_label: 'TFTSet17', peak_tier: 'GRANDMASTER', peak_lp: 460, end_tier: null, source: 'metatft' }];
  const dk = [{ set_number: 17, set_label: 'TFTSet17', end_tier: 'MASTER', end_division: 'I', peak_tier: null, source: 'dakgg' }];
  const [m] = mergeRankSources([], dk, existing, 18);
  assert.equal(m.peak_lp, 460);
  assert.equal(m.end_tier, 'MASTER');
  assert.equal(m.source, 'metatft');
});

test('Merge: alte dakgg-Zeile mit Endrang in peak_* wird bereinigt', () => {
  const existing = [{ set_number: 7, set_label: 'TFTSet7', peak_tier: 'DIAMOND', peak_division: 'IV', end_tier: 'DIAMOND', source: 'dakgg' }];
  const dk = [{ set_number: 7, set_label: 'TFTSet7', end_tier: 'DIAMOND', end_division: 'IV', peak_tier: null, source: 'dakgg' }];
  const [m] = mergeRankSources([], dk, existing, 18);
  assert.equal(m.peak_tier, null);
  assert.equal(m.end_tier, 'DIAMOND');
});

test('laufendes Set: Live-Rang als Stand, LP = Maximum', () => {
  const row = { set_number: 18, set_label: 'TFTSet18', peak_tier: 'MASTER', peak_lp: 300, end_tier: 'MASTER', end_lp: 250 };
  assert.deepEqual(setRankDisplay(withLiveRank(row, 18, { tier: 'MASTER', rank: 'I', lp: 120 })), { tier: 'MASTER', div: null, lp: 300 });
  assert.deepEqual(setRankDisplay(withLiveRank(row, 18, { tier: 'DIAMOND', rank: 'I', lp: 50 })), { tier: 'DIAMOND', div: 'I', lp: null });
  assert.deepEqual(setRankDisplay(withLiveRank(undefined, 18, { tier: 'CHALLENGER', rank: 'I', lp: 900 })), { tier: 'CHALLENGER', div: null, lp: 900 });
});

test('Vergleich: je Set gewinnt das spaetere Halbset', () => {
  const m = lastRowPerSet([
    { set_number: 9, set_label: 'TFTSet9', end_tier: 'CHALLENGER', peak_tier: null, peak_lp: null },
    { set_number: 9, set_label: 'TFTSet9_2', end_tier: 'MASTER', peak_tier: null, peak_lp: null },
  ]);
  assert.equal(m.get(9).set_label, 'TFTSet9_2');
});

test('Abruf vor Einfuehrung des Endrangs wird einmal neu geholt', () => {
  const now = RANK_SCHEMA_AT_MS + 86400000;
  assert.equal(refreshMode({ metatft_fetched_at: new Date(RANK_SCHEMA_AT_MS - 1000).toISOString(), metatft_status: 'success' }, now, START), 'block');
  assert.equal(refreshMode({ metatft_fetched_at: new Date(RANK_SCHEMA_AT_MS + 1000).toISOString(), metatft_status: 'success' }, now, START), 'none');
});

// LP-Verlauf: [Zeit ms, Stufe, Division, LP, Spiele gesamt, Siege]
test('LP-Verlauf: Uebertrag aus dem Vorset wird verworfen (Set 6.5, Loescher)', () => {
  const logs = [
    [1000, 'CHALLENGER', 'I', 1165, 681, 90],
    [2000, 'CHALLENGER', 'I', 1203, 145, 20],
    [3000, 'GRANDMASTER', 'I', 700, 160, 22],
  ];
  assert.deepEqual(peakFromLeagueLogs(logs), { tier: 'CHALLENGER', lp: 1203 });
  const carry = [[1000, 'MASTER', 'I', 900, 765, 90], [2000, 'MASTER', 'I', 25, 10, 2], [3000, 'GRANDMASTER', 'I', 359, 145, 20]];
  assert.deepEqual(peakFromLeagueLogs(carry), { tier: 'GRANDMASTER', lp: 359 }, '900 LP stammen aus dem Vorset');
});

test('LP-Verlauf: doppelte Eintraege, unsortiert, nur Master+ zaehlt', () => {
  const logs = [
    [3000, 'MASTER', 'I', 0, 506, 81],
    [2000, 'MASTER', 'I', 180, 500, 80],
    [2000, 'MASTER', 'I', 180, 500, 80],
    [1000, 'DIAMOND', 'I', 99, 400, 60],
  ];
  assert.deepEqual(peakFromLeagueLogs(logs), { tier: 'MASTER', lp: 180 });
  assert.equal(peakFromLeagueLogs([[1000, 'DIAMOND', 'I', 99, 4, 1]]), null);
  assert.equal(peakFromLeagueLogs([]), null);
});

test('Merge: Verlaufs-Hoechstwert und Marker bleiben beim Neuabruf', () => {
  const existing = [
    { set_number: 8, set_label: 'TFTSet8', peak_tier: 'CHALLENGER', peak_lp: 1795, peak_rating_label: 'dakgg-log', end_tier: 'MASTER', source: 'dakgg' },
    { set_number: 7, set_label: 'TFTSet7', peak_tier: null, peak_lp: null, peak_rating_label: 'dakgg-log:none', end_tier: 'MASTER', source: 'dakgg' },
  ];
  const dk = [
    { set_number: 8, set_label: 'TFTSet8', end_tier: 'MASTER', end_division: 'I', peak_tier: null, source: 'dakgg' },
    { set_number: 7, set_label: 'TFTSet7', end_tier: 'MASTER', end_division: 'I', peak_tier: null, source: 'dakgg' },
  ];
  const out = mergeRankSources([], dk, existing, 18);
  const s8 = out.find(r => r.set_label === 'TFTSet8');
  assert.equal(s8.peak_lp, 1795);
  assert.deepEqual(setRankDisplay(s8), { tier: 'MASTER', div: null, lp: 1795 });
  assert.equal(out.find(r => r.set_label === 'TFTSet7').peak_rating_label, 'dakgg-log:none');
});

test('Merge: MetaTFT-Hoechstwert schlaegt Verlaufs-Wert', () => {
  const existing = [{ set_number: 10, set_label: 'TFTSet10', peak_tier: 'MASTER', peak_lp: 50, peak_rating_label: 'dakgg-log', end_tier: 'MASTER', source: 'dakgg' }];
  const mt = [{ set_number: 10, set_label: 'TFTSet10', peak_tier: 'MASTER', peak_lp: 88, peak_rating_label: 'MASTER I 88 LP', end_tier: 'MASTER', source: 'metatft' }];
  const [m] = mergeRankSources(mt, [], existing, 18);
  assert.equal(m.peak_lp, 88);
  assert.equal(m.source, 'metatft');
});

test('Spielzahl: letzter Eintrag, Uebertrag mit und ohne Abfall, leer → null', () => {
  const prev = [5000, 'MASTER', 'I', 900, 765, 90];
  // Uebertrag mit Abfall: 765 → 10
  const carry = [[1000, 'MASTER', 'I', 900, 765, 90], [2000, 'MASTER', 'I', 25, 10, 2], [3000, 'GRANDMASTER', 'I', 359, 145, 20]];
  assert.equal(gamesFromLeagueLogs(carry), 145);
  // Spielzahl faellt im Set um 1 → letzter Eintrag, nicht Maximum
  assert.equal(gamesFromLeagueLogs([[1000, 'DIAMOND', 'I', 10, 50, 5], [2000, 'DIAMOND', 'I', 20, 60, 6], [3000, 'DIAMOND', 'I', 30, 59, 6]]), 59);
  // Set nicht gespielt: nur der Uebertrag steht im Verlauf
  assert.equal(gamesFromLeagueLogs([[6000, 'MASTER', 'I', 900, 765, 90]], prev), null);
  assert.equal(gamesFromLeagueLogs([[6000, 'MASTER', 'I', 900, 765, 90]]), 765, 'ohne Vorset-Vergleich nicht erkennbar');
  // Uebertrag ohne Abfall, danach gespielt
  assert.equal(gamesFromLeagueLogs([[6000, 'MASTER', 'I', 900, 765, 90], [7000, 'MASTER', 'I', 950, 770, 91]], prev), 770);
  assert.deepEqual(peakFromLeagueLogs([[6000, 'MASTER', 'I', 900, 765, 90], [7000, 'MASTER', 'I', 850, 770, 91]], prev), { tier: 'MASTER', lp: 850 });
  assert.equal(gamesFromLeagueLogs([]), null);
  assert.equal(gamesFromLeagueLogs([[1000, 'IRON', 'IV', 0, 0, 0]]), null, 'nie 0');
});

test('Merge: Verlaufs-Spielzahl auf dakgg-Zeile bleibt beim Neuabruf', () => {
  const existing = [{ set_number: 7, set_label: 'TFTSet7', end_tier: 'DIAMOND', total_games: 212, source: 'dakgg' }];
  const dk = [{ set_number: 7, set_label: 'TFTSet7', end_tier: 'DIAMOND', end_division: 'II', total_games: null, source: 'dakgg' }];
  const [m] = mergeRankSources([], dk, existing, 18);
  assert.equal(m.total_games, 212);
  const mt = [{ set_number: 7, set_label: 'TFTSet7', end_tier: 'DIAMOND', total_games: 215, source: 'metatft' }];
  assert.equal(mergeRankSources(mt, dk, existing, 18)[0].total_games, 215, 'MetaTFT geht vor');
});

// End-LP alter Sets aus dem Verlauf (User 2026-10-07).
test('End-LP: letzter Eintrag bei gleicher Stufe, Master 0 ist echt', () => {
  // Loescher Set 9.5: letzter Eintrag Chall 986 = MetaTFT-Ende 986
  assert.equal(endFromLeagueLogs([[1000, 'GRANDMASTER', 'I', 700, 280, 40], [2000, 'CHALLENGER', 'I', 986, 297, 45]], null, 'CHALLENGER'), 986);
  assert.equal(endFromLeagueLogs([[1000, 'MASTER', 'I', 120, 200, 30], [2000, 'MASTER', 'I', 0, 200, 30]], null, 'MASTER'), 0, 'Verfall ohne Spiele');
  // Stufe passt nicht → nichts raten
  assert.equal(endFromLeagueLogs([[1000, 'GRANDMASTER', 'I', 500, 200, 30]], null, 'MASTER'), null);
  // unter Master keine LP
  assert.equal(endFromLeagueLogs([[1000, 'DIAMOND', 'I', 50, 200, 30]], null, 'DIAMOND'), null);
  // nur Uebertrag vom Vorset → null
  const prev = [5000, 'MASTER', 'I', 900, 765, 90];
  assert.equal(endFromLeagueLogs([[6000, 'MASTER', 'I', 900, 765, 90]], prev, 'MASTER'), null);
  assert.equal(endFromLeagueLogs([], null, 'MASTER'), null);
});

test('Merge: End-LP aus dem Verlauf bleiben beim Neuabruf (dakgg und MetaTFT)', () => {
  const existing = [{ set_number: 7, set_label: 'TFTSet7', end_tier: 'MASTER', end_lp: 0, total_games: 368, source: 'dakgg' }];
  const dk = [{ set_number: 7, set_label: 'TFTSet7', end_tier: 'MASTER', end_division: 'I', end_lp: null, total_games: null, source: 'dakgg' }];
  assert.equal(mergeRankSources([], dk, existing, 18)[0].end_lp, 0);
  // andere Endstufe → gespeicherte LP passen nicht mehr
  const dkGm = [{ ...dk[0], end_tier: 'GRANDMASTER' }];
  assert.equal(mergeRankSources([], dkGm, existing, 18)[0].end_lp, null);
  // MetaTFT ohne End-LP, gleiche Stufe → bleibt; MetaTFT mit LP → MetaTFT gewinnt
  const ex2 = [{ set_number: 11, set_label: 'TFTSet11', end_tier: 'CHALLENGER', end_lp: 1200, total_games: 535, source: 'metatft' }];
  const mt = [{ set_number: 11, set_label: 'TFTSet11', peak_tier: 'CHALLENGER', peak_lp: 1300, end_tier: 'CHALLENGER', end_lp: null, total_games: 535, source: 'metatft' }];
  assert.equal(mergeRankSources(mt, [], ex2, 18)[0].end_lp, 1200);
  assert.equal(mergeRankSources([{ ...mt[0], end_lp: 1250 }], [], ex2, 18)[0].end_lp, 1250);
  // laufendes Set: nie behalten
  const cur = [{ set_number: 18, set_label: 'TFTSet18', end_tier: 'MASTER', end_lp: 300, total_games: 50, source: 'metatft' }];
  assert.equal(mergeRankSources([{ ...cur[0], end_lp: null }], [], cur, 18)[0].end_lp, null);
});

// Tabelle "Max LP pro Set" / "Rang am Set-Ende" (User 2026-10-07).
test('Max LP: Hoechststand GM 460, Ende Master 0 → GM 460 / Master 0 LP', () => {
  const row = { set_number: 17, set_label: 'TFTSet17', peak_tier: 'GRANDMASTER', peak_lp: 460, end_tier: 'MASTER', end_division: 'I', end_lp: 0 };
  assert.deepEqual(setMaxLp(row), { tier: 'GRANDMASTER', lp: 460 });
  assert.deepEqual(setEndRank(row), { tier: 'MASTER', div: null, lp: 0 }, 'Master 0 LP ist echt, nicht leer');
});

test('Max LP: Stufe kommt vom hoeheren Wert (Set 14: Chall 552 → GM 718)', () => {
  const row = { set_number: 14, set_label: 'TFTSet14', peak_tier: 'CHALLENGER', peak_lp: 552, end_tier: 'GRANDMASTER', end_lp: 718 };
  assert.deepEqual(setMaxLp(row), { tier: 'GRANDMASTER', lp: 718 });
  assert.deepEqual(setEndRank(row), { tier: 'GRANDMASTER', div: null, lp: 718 });
});

test('Max LP: dakgg-Master ohne Hoechststand → keine Max-LP, Ende "Master"', () => {
  const row = { set_number: 9, set_label: 'TFTSet9', peak_tier: null, peak_lp: null, end_tier: 'MASTER', end_division: 'I', end_lp: null };
  assert.equal(setMaxLp(row), null);
  assert.deepEqual(setEndRank(row), { tier: 'MASTER', div: null, lp: null });
});

test('Max LP: Hoechststand GM, Ende Gold II → beide Werte getrennt', () => {
  const row = { set_number: 16, set_label: 'TFTSet16', peak_tier: 'GRANDMASTER', peak_lp: 240, end_tier: 'GOLD', end_division: 'II', end_lp: 50 };
  assert.deepEqual(setMaxLp(row), { tier: 'GRANDMASTER', lp: 240 });
  assert.deepEqual(setEndRank(row), { tier: 'GOLD', div: 'II', lp: null });
});

test('Max LP: unter Master ohne Hoechststand → keine Max-LP; Unranked/1970 → kein Ende', () => {
  assert.equal(setMaxLp({ set_number: 12, set_label: 'TFTSet12', peak_tier: 'DIAMOND', peak_lp: 75, end_tier: 'DIAMOND', end_division: 'II' }), null);
  assert.equal(setEndRank({ set_number: 12, set_label: 'TFTSet12', peak_tier: null, peak_lp: null, end_tier: 'UNRANKED' }), null);
  assert.equal(setEndRank({ set_number: 12, set_label: 'TFTSet12', peak_tier: null, peak_lp: null, end_tier: null }), null);
});

test('Max LP live: hoeherer Live-Rang gewinnt mit seiner Stufe', () => {
  const row = { set_number: 18, set_label: 'TFTSet18', peak_tier: 'MASTER', peak_lp: 262 };
  assert.deepEqual(setMaxLp(row, { tier: 'GRANDMASTER', lp: 492 }), { tier: 'GRANDMASTER', lp: 492 });
  assert.deepEqual(setMaxLp({ ...row, peak_tier: 'CHALLENGER', peak_lp: 1200 }, { tier: 'GRANDMASTER', lp: 900 }), { tier: 'CHALLENGER', lp: 1200 }, 'Live tiefer: gespeicherter Wert bleibt mit Stufe');
});

test('Max LP live: Live unter Master behaelt gespeicherten Hoechststand; ohne beides → null', () => {
  const row = { set_number: 18, set_label: 'TFTSet18', peak_tier: 'GRANDMASTER', peak_lp: 300 };
  assert.deepEqual(setMaxLp(row, { tier: 'DIAMOND', lp: 40 }), { tier: 'GRANDMASTER', lp: 300 });
  assert.equal(setMaxLp({ set_number: 18, set_label: 'TFTSet18', peak_tier: null, peak_lp: null }, { tier: 'DIAMOND', lp: 40 }), null);
  assert.deepEqual(setMaxLp({ set_number: 18, set_label: 'TFTSet18', peak_tier: null, peak_lp: null }, { tier: 'MASTER', lp: 120 }), { tier: 'MASTER', lp: 120 });
});

test('Max LP: Ausnahme Chillout 8.2 → Challenger 760 in beiden Spalten', () => {
  const [row] = applyRankOverrides(CHILLOUT, [], 18);
  assert.deepEqual(setMaxLp(row), { tier: 'CHALLENGER', lp: 760 });
  assert.deepEqual(setEndRank(row), { tier: 'CHALLENGER', div: null, lp: 760 });
});
