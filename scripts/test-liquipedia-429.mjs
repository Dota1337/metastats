#!/usr/bin/env node
/**
 * Tests fuer die abgestufte 429-Reaktion in scripts/lib/liquipedia-tft.mjs.
 *
 * Anlass (2026-08-02): jeder einzelne 429 loeste eine 12h-Vollsperre aus. Auf
 * dem GitHub-Runner kam der erste 429 nach ~6 Minuten normalem Crawlen und
 * wuergte damit alle folgenden Schritte desselben Laufs ab — die
 * Turnier-Historie kam nicht ueber die Auswahl hinaus, die Portal-Gegenprobe
 * gar nicht mehr dran.
 *
 * Die Staffel muss zwei Faelle unterscheiden, die beide als 429 ankommen:
 * normales Rate-Limiting (kurz warten, weitermachen) und einen echten Block
 * (lange Sperre). Beide Richtungen sind hier abgedeckt.
 *
 *   node scripts/test-liquipedia-429.mjs
 */
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolierte State-Files, damit der Test den echten Cooldown der Maschine nicht
// anfasst — und kurze Wartezeiten, sonst laeuft er 2 Minuten.
const dir = mkdtempSync(join(tmpdir(), 'liq-429-test-'));
process.env.METASTATS_LIQ_LOCK_FILE = join(dir, 'lock');
process.env.METASTATS_LIQ_COOLDOWN_FILE = join(dir, 'cooldown');
process.env.METASTATS_LIQ_STRIKE_FILE = join(dir, 'strikes');
process.env.METASTATS_LIQ_CACHE_DIR = join(dir, 'cache');
process.env.METASTATS_LIQ_429_MIN_WAIT_MS = '10';
process.env.METASTATS_LIQ_429_MAX_WAIT_MS = '20';

const lib = await import('./lib/liquipedia-tft.mjs');
const { liquipediaJson, cooldownStatus, clearCooldown, readStrikes, resetStrikes, LiquipediaCooldownError } = lib;

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : `\n       erwartet ${JSON.stringify(expected)}, war ${JSON.stringify(actual)}`}`);
  if (!ok) failed++;
}

// fetch-Stub: liefert die vorgegebene Antwortfolge ab.
let queue = [];
let calls = 0;
globalThis.fetch = async () => {
  calls++;
  const next = queue.shift() ?? { status: 200, body: { ok: true } };
  return {
    status: next.status,
    ok: next.status >= 200 && next.status < 300,
    headers: { get: (h) => (h.toLowerCase() === 'retry-after' ? (next.retryAfter ?? null) : null) },
    json: async () => next.body ?? {},
    text: async () => '',
  };
};

function reset(q) {
  queue = q;
  calls = 0;
  clearCooldown();
  resetStrikes();
}

console.log('=== 429-Staffel ===\n');

// ── Fall 1: ein einzelner 429, danach Erfolg ───────────────────────────────
{
  reset([{ status: 429, retryAfter: '1' }, { status: 200, body: { hit: 1 } }]);
  const r = await liquipediaJson({ action: 'test1' });
  check('einzelner 429 wird erneut versucht', r, { hit: 1 });
  check('  dabei genau 2 Requests', calls, 2);
  check('  KEINE Sperre gesetzt', cooldownStatus().active, false);
  check('  Erfolg setzt den Zaehler zurueck', readStrikes(), 0);
}

// ── Fall 2: zwei 429 hintereinander, dann Erfolg ───────────────────────────
{
  reset([{ status: 429 }, { status: 429 }, { status: 200, body: { hit: 2 } }]);
  const r = await liquipediaJson({ action: 'test2' });
  check('zwei 429 werden noch weggesteckt', r, { hit: 2 });
  check('  immer noch keine Sperre', cooldownStatus().active, false);
}

// ── Fall 3: drei 429 → harte Sperre ───────────────────────────────────────
{
  reset([{ status: 429 }, { status: 429 }, { status: 429 }]);
  let threw = null;
  try { await liquipediaJson({ action: 'test3' }); } catch (e) { threw = e; }
  check('dritter 429 wirft LiquipediaCooldownError', threw instanceof LiquipediaCooldownError, true);
  const st = cooldownStatus();
  check('  Sperre ist aktiv', st.active, true);
  const hours = (st.until - Date.now()) / 3600_000;
  check('  Sperre liegt bei ~12h', hours > 11.9 && hours < 12.1, true);
}

// ── Fall 4: aktive Sperre blockt weitere Anfragen ohne Netz ────────────────
{
  const before = calls;
  let threw = null;
  try { await liquipediaJson({ action: 'test4' }); } catch (e) { threw = e; }
  check('waehrend der Sperre wirft es weiter', threw instanceof LiquipediaCooldownError, true);
  check('  ohne einen einzigen Request', calls, before);
}

// ── Fall 5: Retry-After wird respektiert, aber gedeckelt ───────────────────
{
  reset([{ status: 429, retryAfter: '99999' }, { status: 200, body: { hit: 5 } }]);
  const t0 = Date.now();
  const r = await liquipediaJson({ action: 'test5' });
  const waited = Date.now() - t0;
  check('grosses Retry-After fuehrt trotzdem zum Retry', r, { hit: 5 });
  // Deckel steht im Test auf 20ms — ohne Deckel waere die Wartezeit 99999s.
  // Die Schwelle liegt bewusst ueber 5s: zwischen zwei Requests greift
  // zusaetzlich das regulaere Rate-Gate (DEFAULT_MIN_DELAY_MS = 5s), das mit
  // dem 429-Deckel nichts zu tun hat.
  check('  Wartezeit ist gedeckelt', waited < 20_000, true);
}

// ── Fall 6: Zaehler-Fenster ───────────────────────────────────────────────
{
  resetStrikes();
  // Zwei alte Treffer, ausserhalb des 30-Minuten-Fensters.
  writeFileSync(process.env.METASTATS_LIQ_STRIKE_FILE, `2:${Date.now() - 31 * 60 * 1000}`);
  check('alte Treffer zaehlen nicht mehr', readStrikes(), 0);
  writeFileSync(process.env.METASTATS_LIQ_STRIKE_FILE, `2:${Date.now() - 5 * 60 * 1000}`);
  check('frische Treffer zaehlen', readStrikes(), 2);
}

// ── Fall 7: kaputter Zaehler-Stand darf nicht werfen ──────────────────────
{
  writeFileSync(process.env.METASTATS_LIQ_STRIKE_FILE, 'muell');
  check('unlesbarer Stand zaehlt als 0', readStrikes(), 0);
}

// ── Fall 8: 404 bleibt 404, keine Staffel ─────────────────────────────────
{
  reset([{ status: 404 }]);
  const r = await liquipediaJson({ action: 'test8' });
  check('404 liefert null', r, null);
  check('  und setzt keine Sperre', cooldownStatus().active, false);
}

console.log('');
if (failed > 0) { console.error(`=== ${failed} FEHLER ===`); process.exit(1); }
console.log('=== alle Tests gruen ===');
