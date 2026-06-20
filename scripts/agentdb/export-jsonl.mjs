#!/usr/bin/env node
// Daily JSONL-Export für Workstation-Sync. Schreibt nach Dropbox.
// Nur trajectories — memory_sections können aus Markdown re-indexed werden,
// JSONL ist für Trajectory-History die ohne Backup verloren wäre.

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
db.close();
