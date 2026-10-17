import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  WISP_ROUNDS, roundKey, roundRanges, roundInBands, normalizeSearch, parseWispQuery, matchWispQuery,
} from './tft-wisp-search.ts';

// Baender wie auf littlebuddybot.com/tft-wisps (APPEARANCE_BANDS, 17.10.2026).
const BANDS = {
  Early: { from: '2-1', to: '2-7' },
  EarlyMid: { from: '3-1', to: '3-4' },
  Mid: { from: '3-5', to: '4-1' },
  MidLate: { from: '4-2', to: '4-7' },
  Late: { from: '5-1', to: '5-7' },
  VeryLate: { from: '6-1', to: '10-1' },
};

const hit = (q, text, rounds = null) => {
  const parsed = parseWispQuery(q);
  if (!parsed) return true;
  return matchWispQuery(parsed, normalizeSearch(text), rounds ? k => roundInBands(k, rounds, BANDS) : null);
};

test('Runden: Schluessel und Bereiche', () => {
  assert.equal(roundKey('3-2'), 302);
  assert.equal(roundKey('10-1'), 1001);
  assert.equal(roundKey('3-star'), null);
  assert.equal(roundKey('gold'), null);
  assert.deepEqual(roundRanges(['Early', 'EarlyMid', 'Mid'], BANDS), [{ from: '2-1', to: '4-1', open: false }]);
  assert.deepEqual(roundRanges(['Late', 'VeryLate'], BANDS), [{ from: '5-1', to: '10-1', open: true }]);
  // Luecke → zwei Bereiche (PetrifyShields: MidLate + VeryLate)
  assert.deepEqual(roundRanges(['VeryLate', 'MidLate'], BANDS), [
    { from: '4-2', to: '4-7', open: false }, { from: '6-1', to: '10-1', open: true },
  ]);
  assert.deepEqual(roundRanges([], BANDS), []);
});

test('Runden: Grenzen, Stage-Wechsel innerhalb von Mid, ungueltige Runden', () => {
  assert.equal(roundInBands(roundKey('3-7'), ['Mid'], BANDS), true);
  assert.equal(roundInBands(roundKey('4-1'), ['Mid'], BANDS), true);
  assert.equal(roundInBands(roundKey('4-2'), ['Mid'], BANDS), false);
  assert.equal(roundInBands(roundKey('2-7'), ['Early'], BANDS), true);
  assert.equal(roundInBands(roundKey('2-8'), ['Early', 'EarlyMid'], BANDS), false);
  assert.equal(roundInBands(roundKey('1-3'), [...WISP_ROUNDS], BANDS), false);
});

test('Suche: Text, AND, OR, Vorrang, Klammern, Phrase', () => {
  const t = 'Gold Rush\nGain 5 gold and reroll your shop.';
  assert.equal(hit('gold', t), true);
  assert.equal(hit('GOLD reroll', t), true);
  assert.equal(hit('gold AND xp', t), false);
  assert.equal(hit('xp OR reroll', t), true);
  assert.equal(hit('xp or armor', t), false);
  // AND bindet staerker: xp OR (gold AND reroll)
  assert.equal(hit('xp OR gold AND reroll', t), true);
  assert.equal(hit('(xp OR gold) AND armor', t), false);
  assert.equal(hit('"gold and reroll"', t), true);
  assert.equal(hit('"reroll gold"', t), false);
  assert.equal(hit('rus', t), true); // Teilwort
});

test('Suche: fehlertolerant, leere Eingabe trifft alles', () => {
  const t = 'Blood and Iron\nGain armor.';
  assert.equal(parseWispQuery(''), null);
  assert.equal(parseWispQuery('   '), null);
  assert.equal(parseWispQuery('AND'), null);
  assert.equal(parseWispQuery('OR and ()'), null);
  assert.equal(hit('(armor OR xp', t), true);
  assert.equal(hit('armor AND', t), true);
  assert.equal(hit('OR armor', t), true);
  assert.equal(hit('armor) xp', t), false);
  assert.equal(hit('"blood and', t), true); // offenes Anfuehrungszeichen
  assert.equal(hit('blood and iron', t), true);
});

test('Suche: Akzente, Apostroph, Gedankenstrich', () => {
  assert.equal(hit('pokemon', 'Pokémon Trainer'), true);
  assert.equal(hit("tocker's", 'Tocker’s Trials'), true);
  assert.equal(normalizeSearch('3–2'), '3-2');
});

test('Suche: Runde trifft ueber die Baender, ohne Baender als Text', () => {
  const t = 'Abandon Ship\nSell your board.';
  assert.equal(hit('3-2', t, ['EarlyMid']), true);
  assert.equal(hit('3–2', t, ['EarlyMid']), true);
  assert.equal(hit('4-2', t, ['EarlyMid']), false);
  assert.equal(hit('3-2 AND ship', t, ['EarlyMid']), true);
  assert.equal(hit('3-2 AND gold', t, ['EarlyMid']), false);
  assert.equal(hit('1-3', t, [...WISP_ROUNDS]), false);
  assert.equal(hit('3-2', t, null), false); // ohne Baender: Text, kommt nicht vor
  assert.equal(hit('"3-2"', 'Wins 3-2 streak', ['Late']), true); // Phrase ist immer Text
});

// Gleichlauf Import ↔ App: die JSON des aktuellen Sets muss zu WISP_ROUNDS passen.
test('Wisp-JSON des aktuellen Sets passt zu WISP_ROUNDS', (t) => {
  const set = JSON.parse(readFileSync('public/tft-set.json', 'utf8')).setNumber;
  const file = `public/tft-wisps-${set}.json`;
  if (!existsSync(file)) { t.skip(`${file} fehlt`); return; }
  const data = JSON.parse(readFileSync(file, 'utf8'));
  for (const w of data.wisps) {
    for (const x of [w, ...w.variants]) {
      for (const r of x.rounds) assert.ok(WISP_ROUNDS.includes(r), `${x.api}: Band ${r} unbekannt`);
    }
    // Upgrades erben die Baender der Basis (Import, LBB-Regel)
    for (const v of w.variants.filter(v => v.kind === 'upgrade')) {
      assert.deepEqual(v.rounds, w.rounds, `${v.api}: Baender weichen von ${w.api} ab`);
    }
  }
  if (!data.bands) { t.diagnostic('keine bands in der JSON'); return; }
  assert.deepEqual(Object.keys(data.bands), [...WISP_ROUNDS]);
  let prev = 0;
  for (const r of WISP_ROUNDS) {
    const from = roundKey(data.bands[r].from);
    const to = roundKey(data.bands[r].to);
    assert.ok(from != null && to != null, `${r}: Runde nicht lesbar`);
    assert.ok(from <= to, `${r}: from > to`);
    assert.ok(from > prev, `${r}: nicht aufsteigend`);
    prev = to;
  }
});
