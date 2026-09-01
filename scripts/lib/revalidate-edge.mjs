// Push-Invalidation des Vercel-Edge-Caches nach erfolgreichen Crawls.
// Ruft den /api/internal/revalidate Endpoint mit HMAC-Auth — der signiert
// timestamp + body mit REVALIDATE_SECRET. Sicheres Timing-Window ±5min.
//
// Aufruf:
//   import { revalidateEdge } from './lib/revalidate-edge.mjs';
//   await revalidateEdge(['/api/tft/comps', '/api/tft/units']);
//
// Konfiguration via Env:
//   REVALIDATE_SECRET   — Shared Secret, identisch zu Vercel-Env
//   REVALIDATE_BASE_URL — Default: https://www.metastats.gg
//                          (für Tests gegen Staging überschreiben)
//
// Fehler werden geloggt aber nicht geworfen — eine fehlgeschlagene
// Cache-Invalidation darf einen erfolgreichen Crawl nicht zum Failure machen.
// Im Worst-Case läuft der Cache halt seine reguläre 6h-TTL ab.

import { createHmac } from 'node:crypto';
import { existsSync, writeFileSync, renameSync } from 'node:fs';

const SECRET = process.env.REVALIDATE_SECRET || '';
const BASE = (process.env.REVALIDATE_BASE_URL || 'https://www.metastats.gg').replace(/\/$/, '');
const TIMEOUT_MS = 10_000;

// Der Marker liegt in /etc/metastats-crawler/, NICHT in /var/lib/: die Units
// laufen mit ProtectSystem=strict und listen nur /etc/metastats-crawler und
// /run/lock in ReadWritePaths. Ein Write nach /var/lib waere EROFS — ausgerechnet
// in dem Pfad, der aufhoeren soll, still zu scheitern. Die Tages-Cursor liegen
// aus demselben Grund dort.
const STATUS_DIR = process.env.REVALIDATE_STATUS_DIR || '/etc/metastats-crawler';

// Bilanz ueber den ganzen Prozess. Die Crawler rufen revalidateEdge() pro
// Region auf; erst die Summe am Ende sagt, ob der Edge-Cache wirklich frisch ist.
const tally = { ok: 0, failed: 0, skipped: 0, failedLabels: [] };

export function revalidateTally() {
  return { ...tally, failedLabels: [...tally.failedLabels] };
}

export async function revalidateEdge(paths = [], tags = [], opts = {}) {
  const label = opts.label || 'revalidate';
  // no-secret / no-targets sind Konfigurations- bzw. Aufrufzustaende, keine
  // Fehlschlaege — sonst meldet jede Box ohne REVALIDATE_SECRET Dauerfehler.
  if (!SECRET) {
    console.log(`[${label}] skipped — REVALIDATE_SECRET not set`);
    tally.skipped++;
    return { ok: false, reason: 'no-secret' };
  }
  if (!paths.length && !tags.length) {
    tally.skipped++;
    return { ok: false, reason: 'no-targets' };
  }

  const timestamp = String(Date.now());
  const body = JSON.stringify({ paths, tags });
  const signature = createHmac('sha256', SECRET).update(timestamp + body).digest('hex');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/api/internal/revalidate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Revalidate-Timestamp': timestamp,
        'X-Revalidate-Signature': signature,
      },
      body,
      signal: ctrl.signal,
    });
    const ms = Date.now() - t0;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // console.error, nicht console.log: journalctl -p err zeigt sonst nichts,
      // und genau dort schaut man nach, wenn der Cache alt aussieht.
      console.error(`[${label}] revalidate FAILED HTTP ${res.status} ${text.slice(0, 200)} (${ms}ms)`);
      tally.failed++;
      tally.failedLabels.push(`${label}:http-${res.status}`);
      return { ok: false, status: res.status, ms };
    }
    const respJson = await res.json().catch(() => ({}));
    const okPaths = respJson?.revalidated?.paths?.length ?? 0;
    const okTags = respJson?.revalidated?.tags?.length ?? 0;
    console.log(`[${label}] revalidated ${okPaths} path(s) + ${okTags} tag(s) in ${ms}ms`);
    tally.ok++;
    return { ok: true, status: res.status, ms, revalidated: respJson?.revalidated };
  } catch (err) {
    const reason = err.name === 'AbortError' ? 'timeout' : err.message;
    console.error(`[${label}] revalidate ERR ${reason}`);
    tally.failed++;
    tally.failedLabels.push(`${label}:${reason}`);
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

// Bilanz-Zeile ins Journal + Marker-Datei fuer den Laufzeit-Vertrag
// `revalidate/edge-frische`. Ohne persistiertes Artefakt haette der Vertrag
// nichts zu pruefen — ein Revalidate hinterlaesst sonst keine Spur.
// `key` trennt die Marker der beiden Treiber (stats / marketvalue) — sonst
// ueberschreibt der spaeter laufende die Fehlerliste des frueheren.
export function finishRevalidateRun(label = 'revalidate', key = 'stats') {
  const t = revalidateTally();
  const line = `[${label}] Bilanz: ${t.ok} ok, ${t.failed} fehlgeschlagen, ${t.skipped} uebersprungen`;
  if (t.failed > 0) console.error(`${line} — ${t.failedLabels.join(', ')}`);
  else console.log(line);

  const payload = {
    updatedAt: new Date().toISOString(),
    ok: t.ok,
    failed: t.failed,
    skipped: t.skipped,
    failedPaths: t.failedLabels,
  };
  try {
    // Verzeichnis nicht anlegen: existiert es nicht, laeuft das hier auf einer
    // Workstation und der Marker ist dort bedeutungslos.
    if (!existsSync(STATUS_DIR)) return payload;
    const target = `${STATUS_DIR}/revalidate-status-${key}.json`;
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload, null, 2));
    renameSync(tmp, target);
  } catch (e) {
    console.error(`[${label}] Marker-Write fehlgeschlagen: ${e.message}`);
  }
  return payload;
}

// Die Cache-Pfade, die ein Stats-Crawl invalidieren sollte. Hält die
// Crawler-Caller schlank: ein zentraler Helper statt copy-paste-Listen.
export const STATS_EDGE_PATHS = [
  '/api/tft/comps',
  '/api/tft/units',
  '/api/tft/items',
  '/api/tft/traits',
  '/api/tft/trait-unitcount',
  '/api/tft/meta-pulse',
  '/api/tft/patch-diff',
  '/api/tft/available-patches',
];

// MARKETVALUE_EDGE_PATHS entfernt am 2026-09-01. Die Liste war seit dem Umbau
// auf daily-marketvalue-snapshot.mjs ohne Aufrufer — und ein Wiedereinbau haette
// nichts bewirkt. Messung gegen Produktion an dem Tag:
//
//   - Purge auf /api/tft/onetricks und /api/tft/comps quittiert 200 ok, der
//     Edge-Eintrag blieb stehen: Age 213 -> 244 -> 245 (onetricks) und
//     292 -> 292 (comps). revalidatePath fasst den selbst gesetzten CDN-Header
//     aus app/lib/api-cache.ts nicht an, und die Routen lesen request.url,
//     liegen also nicht in Nexts Routen-Cache.
//   - /api/tft/marktwert und /api/tft/pros/specialty lagen ohnehin in keinem
//     Cache (X-Vercel-Cache: MISS, max-age=0, must-revalidate).
//   - Die datentragenden Marktwert-Routen heissen leaderboard/movers/
//     sparklines/teams/history und standen nie in der Liste.
//
// Wer echte Sofort-Frische will, braucht Cache-Etiketten (cacheTag +
// revalidateTag) in diesen Routen plus einen Nachwaerm-Schritt — kalt liegt
// /api/tft/marktwert/movers bei 20,4 s. Das ist ein eigenes Vorhaben, kein
// Anhaengsel. Bis dahin traegt die 6-h-Frist aus app/lib/api-cache.ts.
//
// STATS_EDGE_PATHS bleibt bestehen, obwohl der Purge dort denselben Defekt hat:
// dessen Vertrag ist heute gruen und meldet wenigstens, ob der Treiber ueberhaupt
// bis zum Ende laeuft.
