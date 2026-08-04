#!/usr/bin/env node
// AgentDB Daemon-Server. Hält fastembed-Modell + sqlite-vec persistent geladen
// damit Spec-Architect-Inject + Trajectory-Tracking unter 500ms bleiben.
// Pattern angelehnt an scripts/refresh-api-server.mjs.

import { createServer } from 'node:http';
import { openDb, isSectionStale, DEFAULT_STALE_DAYS, EMBEDDING_MODEL } from './lib/db.mjs';
import { embedOne, vecToJson, getPipeline } from './lib/embedder.mjs';
import { createHash } from 'node:crypto';

const PORT = parseInt(process.env.AGENTDB_PORT || '7878', 10);
const HOST = '127.0.0.1';

const startTime = Date.now();

// Der Port ist unser Mutex. Frueher lief `await getPipeline()` VOR dem listen();
// in diesem Fenster (bis 23s bei kaltem Modell-Cache) antwortete /healthz nicht,
// also hielt jeder neue Prompt den Daemon fuer tot und spawnte einen weiteren —
// der erst ~300MB Modell lud und dann an EADDRINUSE starb. Mit Rueckkopplung:
// mehr Spawns -> langsamere Maschine -> laengeres Fenster -> mehr Spawns.
// Jetzt binden wir zuerst und waermen danach; /healthz meldet solange 'warming'.
const db = openDb();
let warmState = 'warming';
let warmError = null;

async function handleHealthz() {
  const counts = {
    sections: db.prepare('SELECT COUNT(*) as n FROM memory_sections').get().n,
    vecs: db.prepare('SELECT COUNT(*) as n FROM memory_vec').get().n,
    trajectories: db.prepare('SELECT COUNT(*) as n FROM trajectories').get().n,
  };
  return {
    status: warmState,
    warm_error: warmError,
    uptime_sec: Math.floor((Date.now() - startTime) / 1000),
    embedding_model: EMBEDDING_MODEL,
    counts,
  };
}

async function handleSearch(body) {
  const {
    query, top_k = 5, topic = null, set_version = null,
    include_trajectories = false, trajectory_id = null,
  } = body;
  if (!query) return { error: 'query required' };
  const t0 = Date.now();
  const queryVec = await embedOne(query);
  const tEmbed = Date.now();

  const whereClauses = [];
  const params = {};
  if (topic) { whereClauses.push('ms.topic_tag = $topic'); params.topic = topic; }
  if (set_version != null) {
    whereClauses.push('(ms.set_version IS NULL OR ms.set_version = $setVer)');
    params.setVer = set_version;
  }
  // Trajektorien wachsen taeglich, kuratierte Memories nicht. Ohne diesen Filter
  // verdraengen sie binnen Monaten die Doku aus den Top-K. Opt-in statt Default.
  if (!include_trajectories) whereClauses.push("ms.section_type != 'trajectory'");

  // Der Filter greift NACH der KNN-Suche (sqlite-vec kann nicht vorfiltern):
  // `MATCH ... AND k = N` holt die N naechsten, erst danach wirft das WHERE
  // Zeilen weg. Mit kleinem k liefert eine gefilterte Suche also still weniger
  // als top_k Treffer. Deshalb holen wir bei aktivem Filter deutlich breiter.
  const knnK = whereClauses.length > 0 ? top_k * 10 : top_k * 3;
  const whereSql = whereClauses.length > 0 ? `AND ${whereClauses.join(' AND ')}` : '';

  const sql = `
    SELECT
      ms.id, ms.file_path, ms.section_title, ms.content,
      ms.section_type, ms.topic_tag, ms.set_version,
      ms.stale_after_days, ms.last_validated_at,
      v.distance
    FROM memory_vec v
    JOIN memory_sections ms ON ms.id = v.rowid
    WHERE v.embedding MATCH $qvec
      AND k = ${knnK}
      ${whereSql}
    ORDER BY v.distance
    LIMIT ${top_k}
  `;
  const results = db.prepare(sql).all({ qvec: vecToJson(queryVec), ...params });
  const tSearch = Date.now();

  // Der eigentliche Lern-Loop: festhalten, WELCHE Memory bei WELCHEM Prompt
  // ausgeliefert wurde. Ohne diese Verknuepfung ist die Trajektorien-Tabelle
  // nur eine Prompt-Liste. Der Daemon ist der einzige Writer auf die DB —
  // ein zweiter Prozess gegen die dauerhaft offene WAL waere SQLITE_BUSY-Flaeche.
  let refs_written = 0;
  if (trajectory_id) {
    try {
      const exists = db.prepare('SELECT 1 FROM trajectories WHERE id = ?').get(trajectory_id);
      if (exists) {
        // OR IGNORE: dieselbe Suche zweimal im selben Turn ist normal und darf
        // den Recall nicht mit SQLITE_CONSTRAINT in einen 500er kippen.
        const ins = db.prepare(`
          INSERT OR IGNORE INTO trajectory_memory_refs(trajectory_id, memory_section_id, applied_at)
          VALUES (?, ?, ?)
        `);
        const nowRef = Math.floor(Date.now() / 1000);
        for (const r of results) refs_written += ins.run(trajectory_id, r.id, nowRef).changes;
      }
    } catch (err) {
      // Refs sind Telemetrie, nicht das Suchergebnis. Nie den Recall scheitern lassen.
      console.error(`[daemon] ref-write failed: ${err.message}`);
    }
  }

  const nowSec = Math.floor(Date.now() / 1000);
  return {
    query,
    refs_written,
    timing: { embed_ms: tEmbed - t0, search_ms: tSearch - tEmbed, total_ms: tSearch - t0 },
    results: results.map(r => ({
      id: r.id,
      file_path: r.file_path.replace(/.*[/\\]/, ''),
      section_title: r.section_title,
      distance: r.distance,
      topic_tag: r.topic_tag,
      section_type: r.section_type,
      set_version: r.set_version,
      is_stale: isSectionStale(r, nowSec),
      age_days: Math.floor((nowSec - r.last_validated_at) / 86400),
      stale_threshold_days: r.stale_after_days ?? DEFAULT_STALE_DAYS,
      excerpt: r.content.slice(0, 300).replace(/\n+/g, ' '),
    })),
  };
}

async function handleTrajectoryStart(body) {
  const { prompt, set_version = null } = body;
  if (!prompt) return { error: 'prompt required' };
  const promptHash = createHash('sha256').update(prompt).digest('hex').slice(0, 16);
  const startedAt = Math.floor(Date.now() / 1000);
  const result = db.prepare(`
    INSERT INTO trajectories(prompt_hash, prompt_excerpt, started_at, set_version)
    VALUES (?, ?, ?, ?)
  `).run(promptHash, prompt.slice(0, 500), startedAt, set_version);
  return { trajectory_id: Number(result.lastInsertRowid), prompt_hash: promptHash };
}

// Topic-Tag aus dem Text ableiten — gleiche Buckets wie der Memory-Indexer,
// damit der topic-Filter in /search auch auf Trajektorien wirkt.
function inferTopic(text) {
  const t = text.toLowerCase();
  if (/\btft\b|comp|champion|trait|augment|cluster|aggregat|patch|set \d/.test(t)) return 'tft';
  if (/hetzner|systemd|crawler|deploy|vercel|supabase|volume|backup|cron/.test(t)) return 'infra';
  if (/review|spec|plan|workflow|memory|agent|feedback/.test(t)) return 'workflow';
  if (/next\.?js|react|typescript|api-route|component/.test(t)) return 'coding';
  return 'general';
}

// Eine abgeschlossene Trajektorie in den Vektor-Index schreiben, damit /search
// sie findet. Ohne das liegen Trajektorien in einer eigenen Tabelle und sind
// fuer die Agenten unsichtbar — der Graph kennt dann die Doku, aber nicht die
// tatsaechlich geleistete Arbeit.
async function indexTrajectory(trajectoryId, promptExcerpt, summary, setVersion) {
  const content = `Aufgabe: ${promptExcerpt}\n\nErgebnis:\n${summary}`;
  const title = (promptExcerpt || `Trajektorie ${trajectoryId}`).replace(/\s+/g, ' ').slice(0, 120);
  const vec = await embedOne(content);
  const nowSec = Math.floor(Date.now() / 1000);
  const hash = createHash('sha256').update(content).digest('hex');

  const row = db.prepare(`
    INSERT INTO memory_sections(
      file_path, section_title, content, content_hash, embedding_model,
      section_type, topic_tag, set_version, stale_after_days, frontmatter_meta,
      last_validated_at, indexed_at
    ) VALUES (?, ?, ?, ?, ?, 'trajectory', ?, ?, 90, NULL, ?, ?)
    ON CONFLICT(file_path, section_title) DO UPDATE SET
      content=excluded.content, content_hash=excluded.content_hash,
      last_validated_at=excluded.last_validated_at, indexed_at=excluded.indexed_at
    RETURNING id
  `).get(
    `trajectory/${trajectoryId}`, title, content, hash, EMBEDDING_MODEL,
    inferTopic(content), setVersion, nowSec, nowSec,
  );

  // BigInt ist PFLICHT fuer die vec0-Tabelle: sqlite-vec lehnt einen normalen
  // JS-Number-rowid mit "Only integers are allows for primary key values on
  // memory_vec" ab, obwohl 477 sehr wohl ein Integer ist. Empirisch verifiziert
  // (BigInt -> OK, Number -> throw). Nicht "vereinfachen".
  const vecRowId = BigInt(row.id);
  db.prepare('DELETE FROM memory_vec WHERE rowid = ?').run(vecRowId);
  db.prepare('INSERT INTO memory_vec(rowid, embedding) VALUES (?, ?)').run(vecRowId, vecToJson(vec));
  return Number(row.id);
}

async function handleTrajectoryEnd(body) {
  const { trajectory_id, verdict, verdict_source = 'auto', summary, tool_calls_count = 0 } = body;
  if (!trajectory_id) return { error: 'trajectory_id required' };
  const endedAt = Math.floor(Date.now() / 1000);
  // `AND ended_at IS NULL` macht den Call idempotent. Ohne den Guard konnte ein
  // vom Hook-Timeout gekillter Stop-Lauf spaeter als 'abandoned' ueber ein
  // bereits geschriebenes gutes Verdict laufen — waehrend der zugehoerige Text
  // im Vektor-Index stehenblieb. Tabelle und Index divergierten dann still.
  const upd = db.prepare(`
    UPDATE trajectories
    SET ended_at = ?, verdict = ?, verdict_source = ?, summary = ?, tool_calls_count = ?
    WHERE id = ? AND ended_at IS NULL
  `).run(endedAt, verdict, verdict_source, summary, tool_calls_count, trajectory_id);
  if (upd.changes === 0) {
    return { trajectory_id, verdict: null, already_ended: true, indexed_section_id: null };
  }

  // Nur substanzielle Trajektorien indexieren. Ein "kein Commit"-Turn ohne
  // Inhalt wuerde den Index sonst mit Rauschen fluten und die Trefferqualitaet
  // fuer echte Erkenntnisse senken.
  let indexed = null;
  try {
    const t = db.prepare('SELECT prompt_excerpt, set_version FROM trajectories WHERE id = ?').get(trajectory_id);
    const worthIndexing = summary && summary.length >= 40 && /•|Bereiche:/.test(summary);
    if (worthIndexing && t) {
      indexed = await indexTrajectory(trajectory_id, t.prompt_excerpt || '', summary, t.set_version ?? null);
    }
  } catch (err) {
    console.error(`[daemon] trajectory-index failed: ${err.message}`);  // nie den End-Call scheitern lassen
  }
  return { trajectory_id, verdict, indexed_section_id: indexed };
}

async function handleRescore(body) {
  const { recent_n = 3, new_verdict = 'failure', reason } = body;
  const recent = db.prepare(`
    SELECT id, verdict FROM trajectories
    WHERE ended_at IS NOT NULL
    ORDER BY ended_at DESC
    LIMIT ?
  `).all(recent_n);
  let count = 0;
  for (const t of recent) {
    db.prepare(`
      UPDATE trajectories
      SET verdict = ?, verdict_source = 'rescored', summary = COALESCE(summary, '') || ' [RESCORED: ' || ? || ']'
      WHERE id = ?
    `).run(new_verdict, reason || 'user-correction', t.id);
    count++;
  }
  return { rescored: count, recent };
}

const server = createServer(async (req, res) => {
  const t0 = Date.now();
  try {
    let body = {};
    if (req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString('utf8');
      body = raw ? JSON.parse(raw) : {};
    }

    let result;
    if (req.url === '/healthz') result = await handleHealthz();
    else if (req.url === '/search') result = await handleSearch(body);
    else if (req.url === '/trajectory/start') result = await handleTrajectoryStart(body);
    else if (req.url === '/trajectory/end') result = await handleTrajectoryEnd(body);
    else if (req.url === '/trajectory/rescore') result = await handleRescore(body);
    else { res.writeHead(404); res.end('not found'); return; }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    console.log(`[daemon] ${req.method} ${req.url} → ${Date.now() - t0}ms`);
  } catch (err) {
    console.error(`[daemon] ${req.method} ${req.url} ERROR: ${err.message}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

// EADDRINUSE ist kein Fehler, sondern die Antwort "es laeuft schon einer".
// Ohne diesen Handler war es eine unhandled exception — und weil die Spawner
// mit stdio:'ignore' starten, war der Crash unsichtbar.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[daemon] port ${PORT} already in use — another daemon is live, exiting`);
    process.exit(0);
  }
  console.error(`[daemon] listen error: ${err.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`[daemon] Listening on http://${HOST}:${PORT} (warming)`);
  // Erst binden, dann waermen — siehe Kommentar am Dateikopf.
  getPipeline()
    .then(() => {
      warmState = 'ok';
      console.log(`[daemon] Pipeline warm in ${Date.now() - startTime}ms, model: ${EMBEDDING_MODEL}`);
    })
    .catch((err) => {
      warmState = 'error';
      warmError = err.message;
      console.error(`[daemon] Pipeline warmup FAILED: ${err.message}`);
    });
});

process.on('SIGTERM', () => { console.log('[daemon] SIGTERM, shutting down'); db.close(); server.close(); });
process.on('SIGINT', () => { console.log('[daemon] SIGINT, shutting down'); db.close(); server.close(); process.exit(0); });
