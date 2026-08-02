#!/usr/bin/env node
/**
 * Tests fuer selectProsToEnrich() aus enrich-tft-pro-history.mjs.
 *
 * Der Filter entscheidet, wer bei einem Lauf angefasst wird. Faellt er zu
 * scharf aus, veralten Turnier-Historien unbemerkt; faellt er zu lasch aus,
 * sind wir wieder bei 45-90 Minuten Laufzeit. Beide Richtungen sind hier
 * abgedeckt, inklusive Starvation.
 *
 *   node scripts/test-enrich-selection.mjs
 */
import { selectProsToEnrich } from './enrich-tft-pro-history.mjs';

const NOW = Date.parse('2026-08-02T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(NOW - days * DAY).toISOString();

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

const pick = (rows, opts = {}) => selectProsToEnrich(rows, { now: NOW, ...opts });
const names = (r) => r.selected.map((p) => p.pro_name);

console.log('selectProsToEnrich\n');

// ── Grundregeln ────────────────────────────────────────────────────────────
check('nie angereichert wird gezogen',
  names(pick([{ pro_name: 'A', source_page: 'A', last_enriched_at: null }])).includes('A'));

check('ohne source_page wird nie gezogen',
  pick([{ pro_name: 'A', source_page: null, last_enriched_at: null }]).selected.length === 0);

check('ohne source_page zaehlt nicht als total',
  pick([{ pro_name: 'A', source_page: null, last_enriched_at: null }]).totalWithPage === 0);

// ── Aktiv: 7-Tage-Fenster ──────────────────────────────────────────────────
const activeFresh = { pro_name: 'A', source_page: 'A', last_enriched_at: ago(3), tpc_verified: true };
const activeStale = { pro_name: 'B', source_page: 'B', last_enriched_at: ago(9), tpc_verified: true };
check('tpc_verified nach 3 Tagen ist frisch', pick([activeFresh]).selected.length === 0);
check('tpc_verified nach 9 Tagen ist stale', pick([activeStale]).selected.length === 1);
check('tpc_verified exakt 7 Tage ist stale (>=)',
  pick([{ pro_name: 'C', source_page: 'C', last_enriched_at: ago(7), tpc_verified: true }]).selected.length === 1);

// Turnier innerhalb 365d zaehlt ebenfalls als aktiv
check('Turnier vor 100 Tagen → aktiv → nach 9 Tagen stale',
  pick([{ pro_name: 'D', source_page: 'D', last_enriched_at: ago(9), last_tournament_at: ago(100) }]).selected.length === 1);
check('Turnier vor 100 Tagen → aktiv → nach 3 Tagen frisch',
  pick([{ pro_name: 'D', source_page: 'D', last_enriched_at: ago(3), last_tournament_at: ago(100) }]).selected.length === 0);

// ── Ruhend: 30-Tage-Fenster ────────────────────────────────────────────────
const dormant = (days, t = 800) => ({ pro_name: 'E', source_page: 'E', last_enriched_at: ago(days), last_tournament_at: ago(t) });
check('ruhend nach 9 Tagen ist frisch (kein 7-Tage-Fenster)', pick([dormant(9)]).selected.length === 0);
check('ruhend nach 31 Tagen ist stale', pick([dormant(31)]).selected.length === 1);
check('ruhend ohne Turnier-Datum nach 9 Tagen frisch',
  pick([{ pro_name: 'F', source_page: 'F', last_enriched_at: ago(9), last_tournament_at: null }]).selected.length === 0);

// tpc_verified schlaegt altes Turnier-Datum
check('tpc_verified trotz Turnier vor 800 Tagen ist aktiv',
  pick([{ pro_name: 'G', source_page: 'G', last_enriched_at: ago(9), last_tournament_at: ago(800), tpc_verified: true }]).selected.length === 1);

// ── Robustheit ─────────────────────────────────────────────────────────────
check('unparsebarer Zeitstempel wird neu geholt',
  pick([{ pro_name: 'H', source_page: 'H', last_enriched_at: 'nicht-ein-datum' }]).selected.length === 1);
check('unparsebares Turnier-Datum kippt nicht auf aktiv',
  pick([{ pro_name: 'I', source_page: 'I', last_enriched_at: ago(9), last_tournament_at: 'kaputt' }]).selected.length === 0);

// ── Reihenfolge + Deckel ───────────────────────────────────────────────────
const many = [
  { pro_name: 'alt', source_page: 'alt', last_enriched_at: ago(60), last_tournament_at: ago(800) },
  { pro_name: 'nie', source_page: 'nie', last_enriched_at: null },
  { pro_name: 'aelter', source_page: 'aelter', last_enriched_at: ago(90), last_tournament_at: ago(800) },
];
check('NULL steht vor allen Zeitstempeln', names(pick(many))[0] === 'nie');
check('danach aeltester zuerst', names(pick(many))[1] === 'aelter', names(pick(many)).join(','));
check('Deckel kappt auf maxCount', pick(many, { maxCount: 2 }).selected.length === 2);
check('deferred zaehlt den Rest', pick(many, { maxCount: 2 }).deferred === 1);
check('deferred ist 0 ohne Deckel', pick(many).deferred === 0);
check('staleCount ignoriert den Deckel', pick(many, { maxCount: 1 }).staleCount === 3);

// Stabiler Tie-Break bei identischen Zeitstempeln
const tie = [
  { pro_name: 'zeta', source_page: 'z', last_enriched_at: ago(60), last_tournament_at: ago(800) },
  { pro_name: 'alpha', source_page: 'a', last_enriched_at: ago(60), last_tournament_at: ago(800) },
];
check('gleicher Zeitstempel → alphabetisch stabil', names(pick(tie))[0] === 'alpha');

// ── force ──────────────────────────────────────────────────────────────────
check('--force zieht auch Frische', pick([activeFresh], { force: true }).selected.length === 1);
check('--force respektiert source_page trotzdem',
  pick([{ pro_name: 'X', source_page: null, last_enriched_at: null }], { force: true }).selected.length === 0);
check('--force respektiert den Deckel', pick(many, { force: true, maxCount: 1 }).selected.length === 1);

// ── Kein Verhungern ueber Runden ───────────────────────────────────────────
// 10 ruhende Pros, Deckel 3: nach 4 Runden muss jeder einmal drangewesen sein.
{
  const pool = Array.from({ length: 10 }, (_, i) => ({
    pro_name: `p${i}`, source_page: `p${i}`,
    last_enriched_at: ago(40 + i), last_tournament_at: ago(800),
  }));
  const seen = new Set();
  let clock = NOW;
  for (let round = 0; round < 4; round++) {
    const r = selectProsToEnrich(pool, { now: clock, maxCount: 3 });
    for (const p of r.selected) {
      seen.add(p.pro_name);
      p.last_enriched_at = new Date(clock).toISOString();
    }
    clock += 7 * DAY;
  }
  check('kein Pro verhungert ueber 4 Runden', seen.size === 10, `nur ${seen.size}/10 gesehen`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
