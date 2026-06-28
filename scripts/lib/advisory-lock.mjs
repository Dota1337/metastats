// Shared cross-invocation advisory lock. Extracted from publish-snapshot-bundle.mjs
// (Audit 2026-06-28) so the snapshot publisher AND the daily-crawl driver share
// ONE lock implementation instead of drifting copies.
//
// NOT flock(2): an O_EXCL lockfile that an OS-level crash does NOT auto-release.
// The next acquire reclaims a stale lock by checking whether the recorded holder
// PID is still alive (process.kill(pid, 0)). Both bare `node` runs and systemd
// ExecStart execute the same script, so the lock lives here, not in the unit.

import { openSync, closeSync, writeSync, readFileSync, unlinkSync } from 'node:fs';

export function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

// Try once. Returns true if acquired, false if held by a still-alive holder.
// A stale lock (holder dead, e.g. SIGKILL/reboot) is removed and retried.
export function tryAcquire(lockPath) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = openSync(lockPath, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let holder = NaN;
      try { holder = Number(readFileSync(lockPath, 'utf8').trim()); } catch { /* race: gone */ }
      if (pidAlive(holder)) return false;
      try { unlinkSync(lockPath); } catch { /* already removed */ }
    }
  }
  return false;
}

export function releaseLock(lockPath) {
  try {
    const holder = Number(readFileSync(lockPath, 'utf8').trim());
    if (holder === process.pid) unlinkSync(lockPath);
  } catch { /* already gone */ }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Block until acquired or timeout. Re-runs tryAcquire() each poll so a lock held
// by a now-dead holder is reclaimed mid-wait (Audit MED-6) — existsSync polling
// alone would block the full timeout against a dead lock.
export async function blockAcquire(lockPath, { timeoutMs = 1_800_000, pollMs = 5_000, onWait } = {}) {
  const start = Date.now();
  for (;;) {
    if (tryAcquire(lockPath)) return true;
    if (Date.now() - start >= timeoutMs) return false;
    if (onWait) onWait(Math.round((Date.now() - start) / 1000));
    await sleep(pollMs);
  }
}
