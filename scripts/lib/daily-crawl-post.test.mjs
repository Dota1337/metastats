/**
 * Tests fuer die Nacharbeit des Tagestreibers (daily-crawl-post.mjs).
 *
 * Warum: Die Umbenennung der Patch-Namen haengt am Ende jedes Tageslaufs. Wird
 * sie zu oft, zu selten oder ohne Sperre gestartet, oder startet der Publisher,
 * waehrend er noch laeuft, zeigen die TFT-Seiten still alte Namen. Und die
 * Tabellenliste fuer das Aufraeumen muss zum Writer passen — eine neue
 * Tagestabelle ohne VACUUM wird langsam, ohne dass es jemand merkt.
 *
 * Lauf: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LOCK_OWNER_ENV, RELABEL_SCRIPT, dailyCrawlLockPath, maintenanceTables, readRelabelStatus,
  relabelChildArgs, shouldPostCrawl, shouldRunRelabel, unitBusy, waitUntilIdle,
} from './daily-crawl-post.mjs';
import { STATUS_SCHEMA, parseArgs } from './tft-patch-relabel.mjs';
import { DAILY_TABLES } from './tft-supabase-writer.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('dailyCrawlLockPath: Umgebung vor /run/lock vor Arbeitsordner', () => {
  assert.equal(dailyCrawlLockPath({ DAILY_CRAWL_LOCK: '/x/l' }, () => true), '/x/l');
  assert.equal(dailyCrawlLockPath({}, (p) => p === '/run/lock'), '/run/lock/metastats-daily-crawl.lock');
  assert.equal(dailyCrawlLockPath({}, () => false), '.daily-crawl.lock');
});

test('relabelChildArgs: genau die Argumente, die das Werkzeug versteht', () => {
  const argv = relabelChildArgs({ runId: 'crawl-2026-10-04.1.2', day: '2026-10-04', patch: '18.3b' });
  assert.equal(argv[0], RELABEL_SCRIPT);
  const a = parseArgs(argv.slice(1));
  assert.equal(a.error, null);
  assert.equal(a.selection, 'auto');
  assert.equal(a.write, 'apply');
  assert.equal(a.runId, 'crawl-2026-10-04.1.2');
  assert.deepEqual(a.expect, { day: '2026-10-04', patch: '18.3b' });
  assert.equal(LOCK_OWNER_ENV, 'METASTATS_DAILY_CRAWL_LOCK_OWNER');
});

test('shouldRunRelabel: nie im rollenden Lauf, beim Nachholen nur nach echter Arbeit', () => {
  assert.equal(shouldRunRelabel({ mode: 'today', resumeGaps: false, done: 5 }), false);
  assert.equal(shouldRunRelabel({ mode: 'auto', resumeGaps: false, done: 0 }), true);
  assert.equal(shouldRunRelabel({ mode: 'auto', resumeGaps: false, done: 3 }), true);
  assert.equal(shouldRunRelabel({ mode: 'auto', resumeGaps: true, done: 0 }), false);
  assert.equal(shouldRunRelabel({ mode: 'auto', resumeGaps: true, done: 1 }), true);
});

test('readRelabelStatus: nur die eigene Kennung und Fassung zaehlt, auch abgebrochene Laeufe', () => {
  const s = (o) => JSON.stringify({ schema: STATUS_SCHEMA, runId: 'r1', state: 'done', changedDays: ['2026-09-24'], ...o });
  assert.deepEqual(readRelabelStatus(s({}), 'r1'), { ok: true, state: 'done', changedDays: ['2026-09-24'], reason: null });
  assert.deepEqual(readRelabelStatus(s({ state: 'running' }), 'r1').changedDays, ['2026-09-24']);
  assert.deepEqual(readRelabelStatus(s({ state: 'failed', changedDays: ['a', 1, null] }), 'r1').changedDays, ['a']);
  const other = readRelabelStatus(s({ runId: 'r0' }), 'r1');
  assert.equal(other.ok, false);
  assert.deepEqual(other.changedDays, []);
  assert.match(other.reason, /gehoert zu r0/);
  assert.match(readRelabelStatus(s({ schema: 99 }), 'r1').reason, /Fassung 99/);
  assert.match(readRelabelStatus('{kaputt', 'r1').reason, /unlesbar/);
  assert.deepEqual(readRelabelStatus(s({ changedDays: 'x' }), 'r1').changedDays, []);
});

test('shouldPostCrawl: gesammelt ODER umbenannt', () => {
  assert.equal(shouldPostCrawl({ done: 0, relabelChanged: 0 }), false);
  assert.equal(shouldPostCrawl({ done: 1, relabelChanged: 0 }), true);
  assert.equal(shouldPostCrawl({ done: 0, relabelChanged: 2 }), true);
});

test('Tabellenliste: passt genau zu den Schreibzielen des Writers', () => {
  const src = readFileSync(join(HERE, 'tft-supabase-writer.mjs'), 'utf8');
  const written = [...new Set([...src.matchAll(/upsertRows\(\s*'(tft_daily_\w+)'/g)].map((m) => m[1]))].sort();
  assert.ok(written.length >= 10, `nur ${written.length} Schreibziele gefunden — Muster passt nicht mehr`);
  assert.deepEqual([...DAILY_TABLES].sort(), written);
  assert.ok(DAILY_TABLES.includes('tft_daily_comp_outcome'));
  const m = maintenanceTables(DAILY_TABLES);
  assert.deepEqual(m.slice(0, DAILY_TABLES.length), DAILY_TABLES);
  assert.equal(m.at(-1), 'tft_player_marketvalue_snapshots', 'langsamste Tabelle zuletzt');
  assert.equal(new Set(m).size, m.length);
});

test('unitBusy: laufende Zustaende von systemd', () => {
  for (const s of ['active', 'activating', 'reloading', 'deactivating', 'activating\n']) assert.equal(unitBusy(s), true, s);
  for (const s of ['inactive', 'failed', '', null, undefined]) assert.equal(unitBusy(s), false, String(s));
});

function clock(states) {
  let t = 0;
  const slept = [];
  return {
    slept,
    now: () => t,
    sleep: async (ms) => { slept.push(ms); t += ms; },
    probe: () => (states.length > 1 ? states.shift() : states[0]),
  };
}

test('waitUntilIdle: wartet, bis der Publisher fertig ist', async () => {
  const c = clock(['activating', 'activating', 'inactive']);
  const r = await waitUntilIdle({ probe: c.probe, sleep: c.sleep, now: c.now, maxMs: 10_000, pollMs: 1_000 });
  assert.deepEqual(r, { idle: true, state: 'inactive', waitedMs: 2_000 });
});

test('waitUntilIdle: gibt nach maxMs auf, ohne darueber hinaus zu schlafen', async () => {
  const c = clock(['activating']);
  const r = await waitUntilIdle({ probe: c.probe, sleep: c.sleep, now: c.now, maxMs: 2_500, pollMs: 1_000 });
  assert.equal(r.idle, false);
  assert.equal(r.waitedMs, 2_500);
  assert.deepEqual(c.slept, [1_000, 1_000, 500]);
});

test('waitUntilIdle: kein systemctl (null) gilt als frei', async () => {
  const c = clock([null]);
  const r = await waitUntilIdle({ probe: c.probe, sleep: c.sleep, now: c.now });
  assert.equal(r.idle, true);
  assert.deepEqual(c.slept, []);
});
