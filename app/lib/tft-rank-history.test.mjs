/**
 * Rang pro Set = Endrang + hoechste LP (User 2026-09-28).
 * Fixture-Werte sind die echten MetaTFT-Antworten vom 2026-09-28 fuer
 * TFT Chillout#EUW und Loescher#Yerba.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMetatftProfile, mergeRankSources, refreshMode, applyRankOverrides, peakFromLeagueLogs, RANK_SCHEMA_AT_MS } from './tft-rank-history.ts';
import { setRankDisplay, withLiveRank, lastRowPerSet } from './tft-rank-kind.ts';

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
