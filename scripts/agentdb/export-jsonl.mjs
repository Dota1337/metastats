#!/usr/bin/env node
// Daily JSONL-Export für Workstation-Sync. Schreibt nach Dropbox.
//
// Exportiert wird alles, was NICHT aus Markdown rekonstruierbar ist:
//   1. trajectories (+ ihre Memory-Refs)
//   2. memory_sections mit section_type='trajectory'
//
// Punkt 2 kam dazu, als der Daemon anfing, Trajectory-Zusammenfassungen als
// eigene Sections zu indexieren. Der alte Kommentar hier ("memory_sections
// können aus Markdown re-indexed werden") stimmte ab diesem Moment nicht mehr:
// diese Sections haben keine Markdown-Quelle. Ohne sie im Export wäre ein
// Restore stillschweigend unvollständig — die Trajectory-Zeilen wären da, das
// durchsuchbare Gedächtnis darüber nicht.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import os from 'node:os';
import { openDb } from './lib/db.mjs';

const EXPORT_DIR = join(os.homedir(), 'Dropbox', 'Metastats', 'agentdb-snapshot');
if (!existsSync(EXPORT_DIR)) mkdirSync(EXPORT_DIR, { recursive: true });

const db = openDb();
const today = new Date().toISOString().slice(0, 10);
const outPath = join(EXPORT_DIR, `trajectories-${today}.jsonl`);

const trajectories = db.prepare(`
  SELECT t.*, group_concat(mr.memory_section_id) as ref_section_ids
  FROM trajectories t
  LEFT JOIN trajectory_memory_refs mr ON mr.trajectory_id = t.id
  GROUP BY t.id
  ORDER BY t.id
`).all();

const lines = trajectories.map(t => JSON.stringify({
  ...t,
  ref_section_ids: t.ref_section_ids ? t.ref_section_ids.split(',').map(Number) : [],
})).join('\n');

writeFileSync(outPath, lines + '\n', 'utf8');
console.log(`[export] ${trajectories.length} trajectories → ${outPath}`);

// Die Embeddings selbst bleiben draussen: sie sind aus `content` jederzeit
// reproduzierbar und wuerden den Export um zwei Groessenordnungen aufblaehen.
const trajSections = db.prepare(`
  SELECT id, file_path, section_title, content, content_hash, embedding_model,
         section_type, topic_tag, set_version, stale_after_days,
         frontmatter_meta, last_validated_at, indexed_at
  FROM memory_sections
  WHERE section_type = 'trajectory'
  ORDER BY id
`).all();

const secPath = join(EXPORT_DIR, `trajectory-sections-${today}.jsonl`);
writeFileSync(secPath, trajSections.map(s => JSON.stringify(s)).join('\n') + '\n', 'utf8');
console.log(`[export] ${trajSections.length} trajectory-sections → ${secPath}`);

db.close();
