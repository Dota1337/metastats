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

const SECRET = process.env.REVALIDATE_SECRET || '';
const BASE = (process.env.REVALIDATE_BASE_URL || 'https://www.metastats.gg').replace(/\/$/, '');
const TIMEOUT_MS = 10_000;

export async function revalidateEdge(paths = [], tags = [], opts = {}) {
  const label = opts.label || 'revalidate';
  if (!SECRET) {
    console.log(`[${label}] skipped — REVALIDATE_SECRET not set`);
    return { ok: false, reason: 'no-secret' };
  }
  if (!paths.length && !tags.length) {
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
      console.log(`[${label}] revalidate FAILED HTTP ${res.status} ${text.slice(0, 200)} (${ms}ms)`);
      return { ok: false, status: res.status, ms };
    }
    const respJson = await res.json().catch(() => ({}));
    const okPaths = respJson?.revalidated?.paths?.length ?? 0;
    const okTags = respJson?.revalidated?.tags?.length ?? 0;
    console.log(`[${label}] revalidated ${okPaths} path(s) + ${okTags} tag(s) in ${ms}ms`);
    return { ok: true, status: res.status, ms, revalidated: respJson?.revalidated };
  } catch (err) {
    console.log(`[${label}] revalidate ERR ${err.name === 'AbortError' ? 'timeout' : err.message}`);
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
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

// Marktwert-spezifische Pfade. Der Marktwert-Crawler aktualisiert primär
// Pro-Player-Snapshots; die Stats-Pages sind davon nicht betroffen.
export const MARKETVALUE_EDGE_PATHS = [
  '/api/tft/marktwert',
  '/api/tft/onetricks',
  '/api/tft/pros/specialty',
];
