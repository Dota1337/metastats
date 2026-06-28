// Per-day cursor + gap-detection for the daily all-ranks crawl (Audit F2b/F3,
// 2026-06-28). Replaces the single-file day-keyed cursor: each target day gets
// its own file so a day left partial after its window passes is not overwritten
// and can be re-targeted later. A region is "done" on child exit 0 (NOT on rows
// written — preserves the legit-empty handling), or "given up" after N attempts.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, unlinkSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ACTIVE_REGIONS } from './active-regions.mjs';
import { resolveDailyTargetDay } from './tft-crawl-window.mjs';

export const CURSOR_VERSION = 2;
export const DEFAULT_K = 7;
export const DEFAULT_MAX_ATTEMPTS = 3;
const DAY_MS = 86_400_000;

export const CURSOR_DIR = process.env.DAILY_CRAWL_CURSOR_DIR
  || (existsSync('/etc/metastats-crawler') ? '/etc/metastats-crawler' : '.daily-crawl-cursor');
const LEGACY_PATH = `${CURSOR_DIR}/daily-crawl-cursor.json`;

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
export function cursorPath(day) { return `${CURSOR_DIR}/daily-crawl-cursor-${day}.json`; }

// Read the per-day cursor. `present` distinguishes absent (hole candidate) from
// existing-but-empty (a started-or-partial day). A corrupt/unparseable file is
// present but treated as empty -> not-done -> the next crawl atomically rewrites
// it (self-heals next tick). Audit MED-7.
export function readCursor(day) {
  const path = cursorPath(day);
  if (!existsSync(path)) return { day, completed: [], attempts: {}, present: false };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if ((raw.cursorVersion ?? 1) > CURSOR_VERSION) return { day, completed: [], attempts: {}, present: true };
    return {
      day,
      completed: Array.isArray(raw.completed) ? raw.completed : [],
      attempts: (raw.attempts && typeof raw.attempts === 'object') ? raw.attempts : {},
      startedAt: raw.startedAt,
      present: true,
    };
  } catch {
    return { day, completed: [], attempts: {}, present: true, corrupt: true };
  }
}

export function writeCursor(cursor) {
  const path = cursorPath(cursor.day);
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify({
      cursorVersion: CURSOR_VERSION,
      day: cursor.day,
      startedAt: cursor.startedAt,
      completed: cursor.completed,
      attempts: cursor.attempts,
      updatedAt: new Date().toISOString(),
    }, null, 2));
    renameSync(tmp, path); // atomic
  } catch (err) {
    console.error(`[cursor] persist failed (${path}): ${err.message}`);
  }
}

// Write an empty cursor at run start so the FILE'S EXISTENCE means "a run for
// this day was begun" — the basis for hole-detection (an absent file between two
// present files is a skipped middle day).
export function startSeed(day) {
  const existing = readCursor(day);
  if (existing.present) return existing; // resume: keep prior progress
  const cursor = { day, completed: [], attempts: {}, startedAt: new Date().toISOString() };
  writeCursor(cursor);
  return cursor;
}

export function markCompleted(cursor, region) {
  if (!cursor.completed.includes(region)) cursor.completed.push(region);
  writeCursor(cursor);
}

export function recordAttempt(cursor, region) {
  cursor.attempts[region] = (cursor.attempts[region] || 0) + 1;
  writeCursor(cursor);
}

// A region is settled if it completed (exit 0) OR was given up after maxAttempts
// failures. completed is checked FIRST so a region that failed then succeeded is
// settled-via-completed, never falsely "given up". Audit LOW-8.
export function isSettled(cursor, region, maxAttempts = DEFAULT_MAX_ATTEMPTS) {
  return cursor.completed.includes(region) || (cursor.attempts[region] || 0) >= maxAttempts;
}

export function isDayDone(cursor, maxAttempts = DEFAULT_MAX_ATTEMPTS) {
  return ACTIVE_REGIONS.every((r) => isSettled(cursor, r, maxAttempts));
}

export function selectTodo(cursor, maxAttempts = DEFAULT_MAX_ATTEMPTS) {
  return ACTIVE_REGIONS.filter((r) => !isSettled(cursor, r, maxAttempts));
}

// Expected target days for the last K runs, newest-first: D-2, D-3, ... D-(K+1).
// ms-based subtraction (NOT getUTCDate()-d) so it's correct across month
// boundaries; resolveDailyTargetDay re-anchors each to its own 00:00-UTC D-2.
// Audit MED-5.
export function expectedTargetDays(now = new Date(), K = DEFAULT_K) {
  const out = [];
  for (let d = 0; d < K; d++) {
    out.push(resolveDailyTargetDay(new Date(now.getTime() - d * DAY_MS), 'auto'));
  }
  return out;
}

// Pick the OLDEST day in the K-window that still needs crawling, or null.
//  - partial-orphan: file present AND not done.
//  - hole (skipped middle day): file ABSENT but a present file exists both OLDER
//    and NEWER in the window. A leading absent day (no newer present file) is
//    cold-start / box-was-down / today-not-yet-run -> NOT a gap (stampede guard).
// NOTE: this is a pre-lock guess (TOCTOU). The caller MUST re-run it AFTER
// acquiring the lock and re-check selectTodo before crawling. Audit HIGH-2.
export function selectGapDay(now = new Date(), { K = DEFAULT_K, maxAttempts = DEFAULT_MAX_ATTEMPTS } = {}) {
  const chron = [...new Set(expectedTargetDays(now, K))].sort(); // oldest -> newest, deduped
  const state = chron.map((day) => {
    const cur = readCursor(day);
    return { day, present: cur.present, done: cur.present && isDayDone(cur, maxAttempts) };
  });
  for (let i = 0; i < state.length; i++) {
    const s = state[i];
    if (s.present && !s.done) return s.day; // oldest partial-orphan
    if (!s.present) {
      const olderPresent = state.slice(0, i).some((x) => x.present);
      const newerPresent = state.slice(i + 1).some((x) => x.present);
      if (olderPresent && newerPresent) return s.day; // oldest hole
    }
  }
  return null;
}

// Migrate the legacy single-file cursor (pre-2026-06-28) into its per-day file.
// Run UNDER the lock (only the holder migrates) to avoid a rename/unlink race
// between two starters. Idempotent: ENOENT/EEXIST = already migrated. Audit MED-3.
export function migrateLegacyCursor() {
  if (!existsSync(LEGACY_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(LEGACY_PATH, 'utf8'));
    const day = raw.day;
    if (isDay(day) && !existsSync(cursorPath(day))) {
      writeCursor({
        day,
        completed: Array.isArray(raw.completed) ? raw.completed : [],
        attempts: {},
        startedAt: raw.startedAt,
      });
    }
    unlinkSync(LEGACY_PATH);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      try { unlinkSync(LEGACY_PATH); } catch { /* gone */ }
    }
  }
}

// Delete cursor files older than today-(K+1), EXCEPT exceptDay (the running
// target). Call only in --mode auto and under the lock so a concurrent manual
// deep backfill (its own old-dated file) isn't pruned out from under it. MED-4.
export function pruneOldCursors(now = new Date(), K = DEFAULT_K, exceptDay = null) {
  const cutoff = new Date(now.getTime() - (K + 1) * DAY_MS).toISOString().slice(0, 10);
  let dir;
  try { dir = readdirSync(CURSOR_DIR); } catch { return; }
  for (const f of dir) {
    const m = /^daily-crawl-cursor-(\d{4}-\d{2}-\d{2})\.json$/.exec(f);
    if (!m) continue;
    const day = m[1];
    if (day === exceptDay) continue;
    if (day < cutoff) {
      try { unlinkSync(`${CURSOR_DIR}/${f}`); } catch { /* already gone */ }
    }
  }
}
