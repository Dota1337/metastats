// AgentDB SQLite-Wrapper mit sqlite-vec Extension.
// Schema gemäß Multi-Review-Verdicts (architect 2026-06-20): set_version,
// embedding_model, section_type, topic_tag, last_validated_at, frontmatter_meta.

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import os from 'node:os';

export const DEFAULT_DB_PATH = `${os.homedir()}/.claude/agentdb/metastats.db`;
export const EMBEDDING_DIM = 384;             // BGE-small-en-v1.5
export const EMBEDDING_MODEL = 'bge-small-en-v1.5';
export const SCHEMA_VERSION = '1';

export function openDb(path = DEFAULT_DB_PATH) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new Database(path);
  sqliteVec.load(db);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  // Zwei Schreiber greifen auf dieselbe Datei zu: der Daemon (server.mjs, schreibt
  // Trajektorien waehrend einer Session) und der Indexer (index-memories.mjs, laeuft
  // seit 2026-09-01 detached beim Session-Start). WAL macht Leser und Schreiber
  // vertraeglich, aber nicht zwei Schreiber untereinander — ohne busy_timeout
  // scheitert der zweite sofort mit SQLITE_BUSY statt kurz zu warten.
  db.pragma('busy_timeout = 5000');
  ensureSchema(db);
  return db;
}

function ensureSchema(db) {
  // Metadata für Schema-Versioning + Embedding-Model-Tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Per-Section indexierte Memory-Inhalte
  // Source-of-Truth bleibt Markdown — AgentDB ist additiver Cache-Layer.
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_sections (
      id INTEGER PRIMARY KEY,
      file_path TEXT NOT NULL,
      section_title TEXT,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      section_type TEXT,                  -- feedback|reference|project|system
      topic_tag TEXT,                     -- tft|infra|workflow|coding|general
      set_version INTEGER,                -- 17|18|... NULL = setunabhängig
      stale_after_days INTEGER,           -- aus Frontmatter, default NULL=60
      frontmatter_meta TEXT,              -- JSON raw
      last_validated_at INTEGER NOT NULL, -- epoch sec
      indexed_at INTEGER NOT NULL,
      UNIQUE(file_path, section_title)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_sections_topic ON memory_sections(topic_tag);
    CREATE INDEX IF NOT EXISTS idx_memory_sections_set ON memory_sections(set_version);
    CREATE INDEX IF NOT EXISTS idx_memory_sections_validated ON memory_sections(last_validated_at);
  `);

  // Virtual vec0-Table für Vector-Search. Brute-Force bei N<5000 schneller als HNSW.
  // rowid joined gegen memory_sections.id
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(
      embedding float[${EMBEDDING_DIM}]
    );
  `);

  // Trajectories — pro User-Prompt eine.
  db.exec(`
    CREATE TABLE IF NOT EXISTS trajectories (
      id INTEGER PRIMARY KEY,
      prompt_hash TEXT NOT NULL,
      prompt_excerpt TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      verdict TEXT,                       -- success|failure|partial|abandoned
      verdict_source TEXT,                -- auto|manual|rescored
      summary TEXT,
      tool_calls_count INTEGER,
      set_version INTEGER                 -- Set-Kontext zum Trajectory-Start
    );
    CREATE INDEX IF NOT EXISTS idx_trajectories_verdict ON trajectories(verdict);
    CREATE INDEX IF NOT EXISTS idx_trajectories_ended ON trajectories(ended_at);
  `);

  // Welche Memory-Sections wurden in welcher Trajectory referenziert.
  // Für Pattern-Distillation: "fail-Trajectories haben oft Memory X gelesen aber nicht angewandt"
  db.exec(`
    CREATE TABLE IF NOT EXISTS trajectory_memory_refs (
      trajectory_id INTEGER NOT NULL,
      memory_section_id INTEGER NOT NULL,
      applied_at INTEGER NOT NULL,
      set_at_application INTEGER,         -- Set-Hygiene
      PRIMARY KEY(trajectory_id, memory_section_id),
      FOREIGN KEY(trajectory_id) REFERENCES trajectories(id),
      FOREIGN KEY(memory_section_id) REFERENCES memory_sections(id)
    );
  `);

  // Schema-Meta initial setzen
  const upsert = db.prepare(`
    INSERT INTO schema_meta(key, value) VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `);
  upsert.run('schema_version', SCHEMA_VERSION);
  upsert.run('embedding_model', EMBEDDING_MODEL);
  upsert.run('embedding_dim', String(EMBEDDING_DIM));

  // Ab wann die Lernschleife tatsaechlich geschlossen war. Die Hooks liefen
  // monatelang ins Leere: Trajectories wurden geschrieben, aber ohne
  // trajectory_memory_refs und fast alle mit verdict 'abandoned'. Wer spaeter
  // auswertet "wie oft hat ein Recall geholfen?", muss diese Alt-Trajectories
  // ausschliessen, sonst rechnet er gegen einen Nenner aus Rauschen.
  // DO NOTHING: einmal gesetzt, nie ueberschrieben.
  db.prepare(`
    INSERT INTO schema_meta(key, value) VALUES('loop_enabled_at', ?)
    ON CONFLICT(key) DO NOTHING
  `).run(String(Math.floor(Date.now() / 1000)));
}

// Check ob aktuelles Embedding-Model mit DB-State übereinstimmt.
// Bei Mismatch → Re-Index nötig (sonst silent corruption).
export function checkEmbeddingModelConsistency(db) {
  const row = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('embedding_model');
  const dbModel = row?.value;
  if (dbModel && dbModel !== EMBEDDING_MODEL) {
    return { consistent: false, dbModel, currentModel: EMBEDDING_MODEL };
  }
  return { consistent: true };
}

// Default Stale-Threshold: 60 Tage (data-skeptic-Empfehlung).
// Frontmatter kann pro File überschreiben.
export const DEFAULT_STALE_DAYS = 60;

export function isSectionStale(section, nowSec = Math.floor(Date.now() / 1000)) {
  const threshold = section.stale_after_days ?? DEFAULT_STALE_DAYS;
  const ageSec = nowSec - section.last_validated_at;
  return ageSec > threshold * 86400;
}
