#!/usr/bin/env node
// Stop-Hook: schliesst die Trajectory der eigenen Session mit Auto-Verdict.
// Verdict-Heuristik aus den Commits im Zeitfenster des Prompts.
//
// Wie der Start-Hook: Exit immer 0, nichts auf stdout, jeder Netzwerk-Call
// mit Timeout. Der Hook laeuft zwar nach der Antwort und blockiert keinen
// Prompt, aber ein haengender Stop-Hook haelt die Session-Runde offen.

import { execSync } from 'node:child_process';
import {
  stateFileFor, readState, clearState, readStdinJson, fetchJson, DAEMON_URL,
} from './lib/hook-state.mjs';

async function main() {
  const { payload } = await readStdinJson();

  // Claude Code ruft den Stop-Hook erneut auf, wenn ein Hook die Runde
  // fortsetzt. Ohne diesen Guard endet die Trajectory in einer Schleife.
  if (payload.stop_hook_active) return;

  const stateFile = stateFileFor(payload.session_id);
  const state = readState(stateFile);
  if (!state?.trajectory_id || state.ended_at) return;

  // Doppelte Absicherung gegen die alte Kreuz-Session-Verwechslung: selbst
  // wenn zwei Sessions je an dieselbe Datei kaemen, endet hier nur, wer die
  // Trajectory auch gestartet hat.
  if (state.session_id && payload.session_id && state.session_id !== payload.session_id) return;

  // 'unknown' statt 'success': faellt die Heuristik unten in den catch, darf
  // kein Erfolgs-Verdict stehenbleiben, das nie gemessen wurde.
  let verdict = 'unknown';
  let summary = '';

  const REPO = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const git = (args) => execSync(`git -C "${REPO}" ${args} 2>&1`, {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 10000,
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
      verdict = 'success';
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

  try {
    await fetchJson(`${DAEMON_URL}/trajectory/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trajectory_id: state.trajectory_id,
        verdict,
        verdict_source: 'auto',
        summary,
        tool_calls_count: 0,  // Stop-Hook hat keine Counter-Info
      }),
    }, 3000);  // /trajectory/end embeddet die Zusammenfassung — braucht Luft
  } catch { /* silent */ }

  clearState(stateFile);
}

main()
  .catch((err) => { console.error(`[track-end] ${err.message}`); })
  .finally(() => process.exit(0));
