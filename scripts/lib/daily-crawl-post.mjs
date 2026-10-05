// Was der Tagestreiber (crawl-allranks-all-regions.mjs) nach dem Sammeln tut —
// als reine Funktionen, damit es ohne Box und ohne Datenbank testbar ist.
//
// Ablauf am Ende eines Laufs:
//   1. Umbenennung der Patch-Namen (relabel-tft-bpatch.mjs --auto --apply) als
//      Kind, genau einmal, unter der Sperre des Treibers. Das Kind nimmt die
//      Sperre nicht selbst — es erkennt den Treiber an LOCK_OWNER_ENV.
//   2. Nacharbeit nur, wenn gesammelt ODER umbenannt wurde: VACUUM, Sperre frei,
//      Publisher (erst wenn er nicht mehr laeuft), Explorer bei Umbenennung.
// Die Umbenennung aendert den Exit-Code des Treibers nie — an ihm haengt die
// OnSuccess-Kette (catchup, Marktwert).

import { existsSync } from 'node:fs';
import { STATUS_SCHEMA } from './tft-patch-relabel.mjs';

export const RELABEL_SCRIPT = 'scripts/relabel-tft-bpatch.mjs';
// Das Kind sieht hier die PID des Treibers und weiss: die Sperre haelt mein Elternprozess.
export const LOCK_OWNER_ENV = 'METASTATS_DAILY_CRAWL_LOCK_OWNER';
export const RELABEL_TIMEOUT_MS = 30 * 60_000;
export const PUBLISHER_UNIT = 'metastats-snapshot-publisher.service';
export const EXPLORER_UNIT = 'metastats-explorer-build.service';
export const PUBLISHER_WAIT_MS = 30 * 60_000;
export const PUBLISHER_POLL_MS = 30_000;

/** Dieselbe Sperrdatei fuer Treiber, Watchdog-Nachholen und Umbenennung von Hand. */
export function dailyCrawlLockPath(env = process.env, exists = existsSync) {
  return env.DAILY_CRAWL_LOCK
    || (exists('/run/lock') ? '/run/lock/metastats-daily-crawl.lock' : '.daily-crawl.lock');
}

export function relabelChildArgs({ runId, day, patch }) {
  return [RELABEL_SCRIPT, '--auto', '--apply', '--run-id', runId, '--expect', `${day}=${patch}`];
}

/** Umbenennen: nie im rollenden Tageslauf; beim Nachholen nur, wenn etwas gesammelt wurde. */
export function shouldRunRelabel({ mode, resumeGaps, done }) {
  if (mode === 'today') return false;
  if (resumeGaps) return done > 0;
  return true;
}

/**
 * Liest die Statusdatei des Kinds. Zaehlt die umbenannten Tage auch dann, wenn
 * das Kind abgebrochen ist (Zeitlimit) — was geschrieben ist, ist geschrieben.
 */
export function readRelabelStatus(text, runId) {
  let s;
  try {
    s = JSON.parse(text);
  } catch (err) {
    return { ok: false, state: null, changedDays: [], reason: `Statusdatei unlesbar: ${err.message}` };
  }
  if (s?.schema !== STATUS_SCHEMA) {
    return { ok: false, state: null, changedDays: [], reason: `Statusdatei hat Fassung ${s?.schema ?? '–'}, erwartet ${STATUS_SCHEMA}` };
  }
  if (s.runId !== runId) {
    return { ok: false, state: s.state ?? null, changedDays: [], reason: `Statusdatei gehoert zu ${s.runId}, nicht zu ${runId}` };
  }
  const changedDays = Array.isArray(s.changedDays) ? s.changedDays.filter((d) => typeof d === 'string') : [];
  return { ok: true, state: s.state ?? null, changedDays, reason: null };
}

export function shouldPostCrawl({ done, relabelChanged }) {
  return done > 0 || relabelChanged > 0;
}

/** VACUUM-Ziele: alle Tagestabellen des Writers, danach Namen und (langsamste) Marktwerte. */
export function maintenanceTables(dailyTables) {
  return [...dailyTables, 'tft_player_names', 'tft_player_marketvalue_snapshots'];
}

export function unitBusy(state) {
  return ['active', 'activating', 'reloading', 'deactivating'].includes(String(state ?? '').trim());
}

/**
 * Wartet, bis probe() keinen laufenden Zustand mehr meldet — hoechstens maxMs.
 * probe() gibt den Zustand zurueck (oder null, wenn er sich nicht lesen laesst).
 */
export async function waitUntilIdle({ probe, sleep, now = Date.now, maxMs = PUBLISHER_WAIT_MS, pollMs = PUBLISHER_POLL_MS }) {
  const t0 = now();
  for (;;) {
    const state = probe();
    const waitedMs = now() - t0;
    if (!unitBusy(state)) return { idle: true, state, waitedMs };
    if (waitedMs >= maxMs) return { idle: false, state, waitedMs };
    await sleep(Math.min(pollMs, Math.max(0, maxMs - waitedMs)));
  }
}
