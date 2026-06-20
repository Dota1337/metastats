#!/usr/bin/env node
// Stop-Hook: triggert /trajectory/end im Daemon mit Auto-Verdict-Inferenz.
// Auto-Verdict aus letztem Commit-Status, tsc-pass, User-Reply-Keywords.

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import os from 'node:os';

const STATE_FILE = join(os.homedir(), '.claude', 'agentdb', 'current-trajectory.json');
const DAEMON_URL = 'http://127.0.0.1:7878';

if (!existsSync(STATE_FILE)) process.exit(0);

let state;
try { state = JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { process.exit(0); }
if (!state.trajectory_id || state.ended_at) process.exit(0);

// Auto-Verdict-Heuristik
let verdict = 'success';
let summary = '';

try {
  // 1. Recent commits seit Trajectory-Start
  const recentCommits = execSync(
    `git -C "C:/Users/dtaub/metastats" log --since="${state.started_at}" --format="%h %s" 2>&1`,
    { encoding: 'utf8', maxBuffer: 1024 * 1024 },
  ).trim();
  const commitCount = recentCommits ? recentCommits.split('\n').length : 0;
  summary = `${commitCount} commits since prompt`;
  if (commitCount === 0) {
    // Keine Commits → entweder Diskussion ohne Code oder abgebrochen
    verdict = 'partial';
    summary += ' (no code commits)';
  }

  // 2. revert-Commits in recent → failure-Signal
  if (/revert/i.test(recentCommits)) {
    verdict = 'partial';
    summary += ' [revert detected]';
  }
} catch (err) {
  summary = `verdict heuristic failed: ${err.message}`;
}

// End trajectory
try {
  await fetch(`${DAEMON_URL}/trajectory/end`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      trajectory_id: state.trajectory_id,
      verdict,
      verdict_source: 'auto',
      summary,
      tool_calls_count: 0,  // Stop-Hook hat keine Counter-Info
    }),
  });
} catch { /* silent */ }

// State-File cleanup
try { unlinkSync(STATE_FILE); } catch { /* silent */ }
process.exit(0);
