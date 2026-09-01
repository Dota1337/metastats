#!/usr/bin/env node
// Indexer: liest alle Markdown-Files unter Memory-Folder, splittet in Sections,
// embedded mit fastembed, schreibt in AgentDB. Source-of-Truth bleibt Markdown.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { openDb, EMBEDDING_MODEL } from './lib/db.mjs';
import { embed, vecToJson } from './lib/embedder.mjs';
import { splitSections } from './lib/sections.mjs';

const MEMORY_DIR = `${os.homedir()}/.claude/projects/C--Users-dtaub-metastats/memory`;
const BATCH_SIZE = 16;

// Dropbox und OneDrive legen bei Sync-Kollisionen eine zweite Datei daneben:
// "feedback_x (Konflikt … 2026-08-30).md". Inhaltlich ist das eine fast
// wortgleiche Kopie — indiziert wuerde sie mit dem Original um die Top-K-Plaetze
// konkurrieren und im schlimmsten Fall den veralteten Stand nach oben spuelen.
const CONFLICT_COPY = /\([^)]*(?:Konflikt|conflicted copy|in Konflikt stehende)[^)]*\)/i;

// Frische-Marker: der Session-Start-Hook liest nur diese kleine Datei, statt
// better-sqlite3 im Hot-Path zu laden.
const MARKER_PATH = `${os.homedir()}/.claude/agentdb/last-index.json`;

function writeMarker(sections) {
  try {
    writeFileSync(MARKER_PATH, JSON.stringify({
      at: new Date().toISOString(),
      files: files.length,
      sections,
    }, null, 2));
  } catch (err) {
    console.error(`[index] Marker nicht schreibbar: ${err.message}`);
  }
}

console.log(`[index] Memory-Dir: ${MEMORY_DIR}`);
console.log(`[index] Embedding-Model: ${EMBEDDING_MODEL}`);

const t0 = Date.now();
const db = openDb();
// `_`-Praefix markiert generierte Dateien — allen voran _TIER1_BUNDLE.md, das
// saemtliche Tier-1-Memories noch einmal wortgleich enthaelt. Wuerde man es
// mitindexieren, konkurrierte jede Verhaltensregel mit ihrer eigenen Kopie um
// die Top-K-Plaetze und halbierte damit die nutzbare Trefferliste.
// MEMORY.md ist der Index, kein Inhalt.
const files = readdirSync(MEMORY_DIR)
  .filter(f => f.endsWith('.md') && f !== 'MEMORY.md' && !f.startsWith('_') && !CONFLICT_COPY.test(f))
  .map(f => join(MEMORY_DIR, f));
console.log(`[index] ${files.length} Markdown-Files gefunden`);

const allSections = [];
let readFailures = 0;
for (const filePath of files) {
  try {
    const md = readFileSync(filePath, 'utf8');
    const sections = splitSections(md, filePath);
    for (const s of sections) {
      allSections.push({ filePath, ...s });
    }
  } catch (err) {
    readFailures++;
    console.error(`[index] Skip ${filePath}: ${err.message}`);
  }
}
console.log(`[index] ${allSections.length} Sections nach Splitting`);

// Prune: Sections aus geloeschten, umbenannten oder neu ausgeschlossenen Dateien
// (und geloeschte Ueberschriften innerhalb bestehender Dateien). Der Indexer hat
// bisher nur geschrieben, nie entfernt — verwaiste Eintraege blieben im
// Vektor-Index und konkurrierten weiter um die Top-K-Plaetze.
//
// Trajectory-Sections sind ausgenommen: die haben keine Markdown-Quelle,
// werden vom Daemon geschrieben und wuerden hier sonst restlos geloescht.
//
// Bei einem Lesefehler wird gar nicht geprunt — sonst leert ein voruebergehend
// nicht lesbares File (Sync-Lock, offener Editor) still seinen halben Index.
if (readFailures > 0) {
  console.warn(`[index] Prune uebersprungen — ${readFailures} File(s) nicht lesbar`);
} else {
  const liveKeys = new Set(allSections.map(s => `${s.filePath}#${s.section_title || ''}`));
  const stale = db.prepare(`
    SELECT id, file_path, section_title FROM memory_sections
    WHERE section_type IS NULL OR section_type != 'trajectory'
  `).all().filter(r => !liveKeys.has(`${r.file_path}#${r.section_title || ''}`));

  if (stale.length > 0) {
    const delSec = db.prepare('DELETE FROM memory_sections WHERE id = ?');
    const delVec = db.prepare('DELETE FROM memory_vec WHERE rowid = ?');
    // trajectory_memory_refs haelt einen Foreign Key auf memory_sections; ohne
    // dieses DELETE schlaegt der Prune mit SQLITE_CONSTRAINT_FOREIGNKEY fehl.
    // Die Lernspur geht damit verloren — das ist richtig so: "Memory X wurde
    // abgerufen" ist wertlos, sobald X nicht mehr existiert.
    const delRefs = db.prepare('DELETE FROM trajectory_memory_refs WHERE memory_section_id = ?');
    let refsDropped = 0;
    db.transaction(() => {
      for (const r of stale) {
        refsDropped += delRefs.run(r.id).changes;
        try { delVec.run(BigInt(r.id)); } catch { /* kein Vektor vorhanden */ }
        delSec.run(r.id);
      }
    })();
    if (refsDropped > 0) console.log(`[index] ${refsDropped} zugehoerige Memory-Refs entfernt`);
    const byFile = [...new Set(stale.map(r => r.file_path.split(/[\\/]/).pop()))];
    console.log(`[index] ${stale.length} verwaiste Sections entfernt (${byFile.slice(0, 5).join(', ')}${byFile.length > 5 ? ', …' : ''})`);
  }
}

// Existing hashes lesen → Skip-Logic für unveränderte Sections
const existingHashes = new Map();
const rows = db.prepare('SELECT id, file_path, section_title, content_hash FROM memory_sections').all();
for (const r of rows) {
  const key = `${r.file_path}#${r.section_title || ''}`;
  existingHashes.set(key, { id: r.id, hash: r.content_hash });
}

const toIndex = [];
let skipped = 0;
for (const s of allSections) {
  const key = `${s.filePath}#${s.section_title || ''}`;
  const existing = existingHashes.get(key);
  if (existing && existing.hash === s.content_hash) {
    skipped++;
    continue;
  }
  toIndex.push({ ...s, existingId: existing?.id ?? null });
}
console.log(`[index] ${toIndex.length} Sections zu indexieren (${skipped} unverändert)`);

if (toIndex.length === 0) {
  console.log(`[index] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s — nichts zu tun`);
  writeMarker(allSections.length);
  db.close();
  process.exit(0);
}

const nowSec = Math.floor(Date.now() / 1000);

const upsertSection = db.prepare(`
  INSERT INTO memory_sections(
    file_path, section_title, content, content_hash, embedding_model,
    section_type, topic_tag, set_version, stale_after_days, frontmatter_meta,
    last_validated_at, indexed_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(file_path, section_title) DO UPDATE SET
    content=excluded.content,
    content_hash=excluded.content_hash,
    embedding_model=excluded.embedding_model,
    section_type=excluded.section_type,
    topic_tag=excluded.topic_tag,
    set_version=excluded.set_version,
    stale_after_days=excluded.stale_after_days,
    frontmatter_meta=excluded.frontmatter_meta,
    last_validated_at=excluded.last_validated_at,
    indexed_at=excluded.indexed_at
  RETURNING id
`);

const insertVec = db.prepare('INSERT INTO memory_vec(rowid, embedding) VALUES (?, ?)');
const deleteVec = db.prepare('DELETE FROM memory_vec WHERE rowid = ?');

// Embed batches
for (let i = 0; i < toIndex.length; i += BATCH_SIZE) {
  const batch = toIndex.slice(i, i + BATCH_SIZE);
  const texts = batch.map(s => s.content_for_embedding);
  console.log(`[index] Embed batch ${i / BATCH_SIZE + 1}/${Math.ceil(toIndex.length / BATCH_SIZE)} (${batch.length} sections)`);
  const vecs = await embed(texts);
  if (vecs.length !== batch.length) {
    console.error(`[index] WARN: embed returned ${vecs.length} vecs for ${batch.length} texts`);
    continue;
  }

  // Pro Section: upsert memory_sections + (re-)insert memory_vec
  const tx = db.transaction(() => {
    for (let j = 0; j < batch.length; j++) {
      const s = batch[j];
      const vec = vecs[j];
      const row = upsertSection.get(
        s.filePath, s.section_title, s.content, s.content_hash, EMBEDDING_MODEL,
        s.section_type, s.topic_tag, s.set_version, s.stale_after_days, s.frontmatter_meta,
        nowSec, nowSec,
      );
      // Delete old vec if exists (upsert in vec0 ist tricky — easier: delete + insert)
      try { deleteVec.run(BigInt(row.id)); } catch { /* no row */ }
      insertVec.run(BigInt(row.id), vecToJson(vec));
    }
  });
  tx();
}

const dt = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`[index] Done in ${dt}s — ${toIndex.length} Sections indexed, ${skipped} unchanged`);

// Verify
const counts = {
  sections: db.prepare('SELECT COUNT(*) as n FROM memory_sections').get().n,
  vecs: db.prepare('SELECT COUNT(*) as n FROM memory_vec').get().n,
};
console.log(`[index] Total in DB: ${counts.sections} sections, ${counts.vecs} vectors`);

writeMarker(counts.sections);
db.close();
