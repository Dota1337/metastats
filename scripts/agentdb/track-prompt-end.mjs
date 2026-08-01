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

const REPO = 'C:/Users/dtaub/metastats';
const git = (args) => execSync(`git -C "${REPO}" ${args} 2>&1`, {
  encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
}).trim();

try {
  // Ein Commit-ZAEHLER ist als Gedaechtnis wertlos: ein Agent, der spaeter
  // "1 commits since prompt" liest, weiss hinterher nichts. Wir schreiben
  // deshalb WAS passiert ist — Commit-Subjects (die tragen bei uns die
  // Begruendung) plus die beruehrten Bereiche. Das ist der Unterschied
  // zwischen einer Log-Zeile und einer abrufbaren Erkenntnis.
  const subjects = git(`log --since="${state.started_at}" --format=%s`)
    .split('\n').filter(Boolean);
  const commitCount = subjects.length;

  if (commitCount === 0) {
    // Kein Commit heisst NICHT "nichts gelernt" — Diagnose-, Recherche- und
    // Entscheidungs-Turns sind oft die wertvollsten. Als partial markieren,
    // aber den Prompt als Kontext behalten.
    verdict = 'partial';
    summary = `Kein Commit — Diskussion/Diagnose. Prompt: ${(state.prompt_excerpt || '').slice(0, 160)}`;
  } else {
    // Betroffene Bereiche aus den geaenderten Pfaden ableiten (2 Ebenen tief,
    // dedupliziert) — damit ist spaeter suchbar "was hing schon mal an X".
    let areas = [];
    try {
      areas = [...new Set(
        git(`log --since="${state.started_at}" --name-only --format=`)
          .split('\n').filter(Boolean)
          .map(p => p.split('/').slice(0, 2).join('/')),
      )].slice(0, 12);
    } catch { /* Pfade sind Bonus, nicht kritisch */ }

    summary = subjects.slice(0, 6).map(s => `• ${s}`).join('\n');
    if (commitCount > 6) summary += `\n• …und ${commitCount - 6} weitere`;
    if (areas.length) summary += `\nBereiche: ${areas.join(', ')}`;
  }

  // revert im Zeitfenster ist ein Warnsignal: da wurde etwas zurueckgenommen.
  if (subjects.some(s => /revert/i.test(s))) {
    verdict = 'partial';
    summary += '\n[revert im Zeitfenster — hier ist etwas schiefgegangen]';
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
