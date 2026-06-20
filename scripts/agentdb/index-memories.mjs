#!/usr/bin/env node
// Indexer: liest alle Markdown-Files unter Memory-Folder, splittet in Sections,
// embedded mit fastembed, schreibt in AgentDB. Source-of-Truth bleibt Markdown.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { openDb, EMBEDDING_MODEL } from './lib/db.mjs';
import { embed, vecToJson } from './lib/embedder.mjs';
import { splitSections } from './lib/sections.mjs';

const MEMORY_DIR = `${os.homedir()}/.claude/projects/C--Users-dtaub-metastats/memory`;
const BATCH_SIZE = 16;

console.log(`[index] Memory-Dir: ${MEMORY_DIR}`);
console.log(`[index] Embedding-Model: ${EMBEDDING_MODEL}`);

const t0 = Date.now();
const db = openDb();
const files = readdirSync(MEMORY_DIR)
  .filter(f => f.endsWith('.md') && f !== 'MEMORY.md')
  .map(f => join(MEMORY_DIR, f));
console.log(`[index] ${files.length} Markdown-Files gefunden`);

const allSections = [];
for (const filePath of files) {
  try {
    const md = readFileSync(filePath, 'utf8');
    const sections = splitSections(md, filePath);
    for (const s of sections) {
      allSections.push({ filePath, ...s });
    }
  } catch (err) {
    console.error(`[index] Skip ${filePath}: ${err.message}`);
  }
}
console.log(`[index] ${allSections.length} Sections nach Splitting`);

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

db.close();
