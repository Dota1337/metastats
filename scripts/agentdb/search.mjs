#!/usr/bin/env node
// Vector-Search CLI für AgentDB. Output: Top-K relevante Memory-Sections
// + Stale-Markierung + Topic-Filter.

import { openDb, isSectionStale, DEFAULT_STALE_DAYS } from './lib/db.mjs';
import { embedOne, vecToJson } from './lib/embedder.mjs';

const args = process.argv.slice(2);
const queryIdx = args.indexOf('--query');
const topKIdx = args.indexOf('--top-k');
const topicIdx = args.indexOf('--topic');
const setIdx = args.indexOf('--set');
const jsonMode = args.includes('--json');

if (queryIdx < 0) {
  console.error('Usage: search.mjs --query "<text>" [--top-k 5] [--topic tft] [--set 17] [--json]');
  process.exit(1);
}

const query = args[queryIdx + 1];
const topK = topKIdx >= 0 ? parseInt(args[topKIdx + 1], 10) : 5;
const topicFilter = topicIdx >= 0 ? args[topicIdx + 1] : null;
const setFilter = setIdx >= 0 ? parseInt(args[setIdx + 1], 10) : null;

const t0 = Date.now();
const queryVec = await embedOne(query);
const tEmbed = Date.now();

const db = openDb();

const whereClauses = [];
const params = {};
if (topicFilter) { whereClauses.push('ms.topic_tag = $topic'); params.topic = topicFilter; }
if (setFilter != null) {
  whereClauses.push('(ms.set_version IS NULL OR ms.set_version = $setVer)');
  params.setVer = setFilter;
}
const whereSql = whereClauses.length > 0 ? `AND ${whereClauses.join(' AND ')}` : '';

const sql = `
  SELECT
    ms.id,
    ms.file_path,
    ms.section_title,
    ms.content,
    ms.section_type,
    ms.topic_tag,
    ms.set_version,
    ms.stale_after_days,
    ms.last_validated_at,
    v.distance
  FROM memory_vec v
  JOIN memory_sections ms ON ms.id = v.rowid
  WHERE v.embedding MATCH $qvec
    AND k = ${topK * 3}
    ${whereSql}
  ORDER BY v.distance
  LIMIT ${topK}
`;

const results = db.prepare(sql).all({ qvec: vecToJson(queryVec), ...params });
const tSearch = Date.now();

const nowSec = Math.floor(Date.now() / 1000);
const enriched = results.map(r => ({
  ...r,
  is_stale: isSectionStale(r, nowSec),
  age_days: Math.floor((nowSec - r.last_validated_at) / 86400),
  excerpt: r.content.slice(0, 200).replace(/\n+/g, ' '),
}));

if (jsonMode) {
  console.log(JSON.stringify({
    query, topK,
    timing: { embed_ms: tEmbed - t0, search_ms: tSearch - tEmbed, total_ms: tSearch - t0 },
    filters: { topic: topicFilter, set: setFilter },
    results: enriched.map(r => ({
      file_path: r.file_path.replace(/.*[/\\]/, ''),
      section_title: r.section_title,
      distance: r.distance,
      topic_tag: r.topic_tag,
      section_type: r.section_type,
      set_version: r.set_version,
      is_stale: r.is_stale,
      age_days: r.age_days,
      stale_threshold_days: r.stale_after_days ?? DEFAULT_STALE_DAYS,
      excerpt: r.excerpt,
    })),
  }, null, 2));
} else {
  console.log(`Query: "${query}"`);
  console.log(`Timing: embed ${tEmbed - t0}ms · search ${tSearch - tEmbed}ms · total ${tSearch - t0}ms`);
  console.log(`Filters: topic=${topicFilter || 'any'} set=${setFilter || 'any'}\n`);
  for (let i = 0; i < enriched.length; i++) {
    const r = enriched[i];
    const file = r.file_path.replace(/.*[/\\]/, '');
    const staleMarker = r.is_stale ? ` ⚠ STALE (${r.age_days}d > ${r.stale_after_days ?? DEFAULT_STALE_DAYS}d)` : '';
    console.log(`${i + 1}. ${file}${r.section_title ? ' › ' + r.section_title : ''}`);
    console.log(`   dist=${r.distance.toFixed(4)} · ${r.topic_tag} · ${r.section_type}${r.set_version ? ' · set' + r.set_version : ''}${staleMarker}`);
    console.log(`   ${r.excerpt}...\n`);
  }
}

db.close();
