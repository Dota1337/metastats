#!/usr/bin/env node
// Einziger Einstiegspunkt fuer semantischen Memory-Recall aus Agent-Definitionen.
//
// Warum es das gibt: die Agent-Definitionen riefen bisher jede fuer sich `curl`
// auf /search — sechs Kopien derselben URL, dazu ein siebter Pfad ueber
// search.mjs. Keiner davon konnte die trajectory_id mitgeben, weshalb
// trajectory_memory_refs dauerhaft leer blieb: die Tabelle, die eigentlich
// beantworten soll "welche Memory hat bei welchem Ergebnis geholfen", hatte
// nie eine Zeile. Genau diese Verknuepfung ist der Lern-Loop.
//
// Dieses Script schreibt NICHT selbst in die DB — der Daemon bleibt einziger
// Schreiber (better-sqlite3 ist synchron, ein zweiter Writer erzeugt
// SQLITE_BUSY). Es reicht die trajectory_id durch, der Daemon verbucht.
//
// Nutzung:  node scripts/agentdb/recall.mjs "<query>" [--top-k 5] [--topic X]
//           [--include-trajectories] [--json]
// Ausgabe:  ohne --json eine kompakte Text-Liste, mit --json exakt die
//           Daemon-Antwort (byte-kompatibel zum bisherigen curl-Aufruf).

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_DIR, readState, DAEMON_URL } from './lib/hook-state.mjs';

const VALUE_FLAGS = new Set(['top-k', 'topic']);
const opts = {};
const positional = [];
{
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const name = a.slice(2);
    if (VALUE_FLAGS.has(name)) opts[name] = args[++i];
    else opts[name] = true;
  }
}
const flag = (name, def = null) => opts[name] ?? def;
const has = (name) => opts[name] === true;
const query = positional.join(' ').trim();

if (!query) {
  console.error('usage: recall.mjs "<query>" [--top-k N] [--topic T] [--include-trajectories] [--json]');
  process.exit(1);
}

// Subagents kennen ihre session_id nicht. Wir nehmen die zuletzt geschriebene
// Session-Datei — in der Praxis die laufende Session. Findet sich keine,
// laeuft die Suche eben ohne Verknuepfung weiter: Recall ohne
// trajectory_memory_refs ist immer noch nuetzlich, ein harter Fehler waere es
// nicht.
function currentTrajectoryId() {
  try {
    const files = readdirSync(STATE_DIR)
      .filter((f) => f.startsWith('current-trajectory.') && f.endsWith('.json'))
      .map((f) => join(STATE_DIR, f));
    let best = null;
    let bestTs = -1;
    for (const f of files) {
      const s = readState(f);
      if (s?.trajectory_id && !s.ended_at && (s.started_at || 0) > bestTs) {
        bestTs = s.started_at || 0;
        best = s.trajectory_id;
      }
    }
    return best;
  } catch {
    return null;
  }
}

async function main() {
  const body = {
    query,
    top_k: parseInt(flag('top-k', '5'), 10),
    topic: flag('topic'),
    include_trajectories: has('include-trajectories'),
    trajectory_id: currentTrajectoryId(),
  };

  let data;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(`${DAEMON_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    clearTimeout(timer);
    data = await res.json();
  } catch (err) {
    console.error(`[recall] Daemon nicht erreichbar (${err.message}). Erst \`node scripts/agentdb/ensure-daemon.mjs\` laufen lassen.`);
    process.exit(1);
  }

  if (has('json')) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (!data.results?.length) {
    console.log(`Keine Treffer für "${query}".`);
    return;
  }
  console.log(`${data.results.length} Treffer für "${query}" (refs_written=${data.refs_written ?? 0}):\n`);
  for (const r of data.results) {
    const stale = r.is_stale ? `  ⚠ stale (${r.age_days}d > ${r.stale_threshold_days}d)` : '';
    const where = r.section_title ? `${r.file_path} › ${r.section_title}` : r.file_path;
    console.log(`— ${where}  [${r.section_type}${r.topic_tag ? `/${r.topic_tag}` : ''}]  distance=${r.distance?.toFixed(3)}${stale}`);
    console.log(`${(r.excerpt || '').slice(0, 400).replace(/\s+/g, ' ')}\n`);
  }
}

main().catch((err) => {
  console.error(`[recall] ${err.message}`);
  process.exit(1);
});
