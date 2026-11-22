// Tageszeilen-Ablage von scripts/publish-comp-trends.mjs auf der Box
// (StateDirectory=metastats-comp-trend): eine Datei je Tag, damit jede Nacht
// nur wenige Tage von Supabase kommen. Eigenes Modul ohne Seiteneffekte —
// testbar, ohne das Treiber-Skript zu laden.

import { readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/** Die letzten N Tage bis zum Endtag kommen immer neu (Nachzuegler, Resume-Crawl). */
export const RECENT_DAYS = 3;
/** Aelter im Speicher: nachladen, gestaffelt. */
export const MAX_CACHE_AGE_MS = 14 * 86_400_000;
export const MAX_OLD_REFRESH = 2;

export const DEFAULT_STATE_DIR = '/var/lib/metastats-comp-trend';

/** systemd-StateDirectory (erster Eintrag), sonst derselbe Ort — nie das Arbeitsverzeichnis (/opt ist schreibgeschuetzt). */
export function stateDir(env = process.env) {
  return String(env.STATE_DIRECTORY || '').split(':')[0] || env.COMP_TREND_STATE_DIR || DEFAULT_STATE_DIR;
}

/** Fingerabdruck eines Tages: Zeilenzahl | Summe Spiele. */
export function dayFingerprint(n, games) {
  return `${Number(n) || 0}|${Number(games) || 0}`;
}

/**
 * Welche Tage muessen neu aus der DB?
 * @param {string[]} days  aufsteigend, letzter = Endtag
 * @param {Map<string,string>} dbFp  Tag -> Fingerabdruck laut DB (fehlt = keine Zeilen)
 * @param {Map<string,{fp:string,savedAt:number}>} cache
 * @returns {Set<string>}
 */
export function daysToLoad(days, dbFp, cache, now = Date.now()) {
  const recent = new Set(days.slice(-RECENT_DAYS));
  const must = [];
  const old = [];
  for (const d of days) {
    const c = cache.get(d);
    if (!c || recent.has(d) || c.fp !== (dbFp.get(d) || dayFingerprint(0, 0))) must.push(d);
    else if (!(now - c.savedAt <= MAX_CACHE_AGE_MS && c.savedAt <= now + 60_000)) old.push(d);
  }
  // Hoechstens MAX_OLD_REFRESH alte Tage je Lauf, aelteste zuerst. Sonst liefen
  // nach dem ersten Vollaufbau alle Tage in derselben Nacht ab — ein kalter Tag
  // kostet gemessen ~23 MB Lesestoff auf Supabase (EXPLAIN 22.11.2026 fuer den
  // 10.11.: 16.779 Zeilen, 2.892 Seiten gelesen, 107 ms). Nach 14 Tagen trotz
  // gleichem Abdruck neu, falls Werte ohne Aenderung von Zeilenzahl und Spielen wechseln.
  old.sort((a, b) => cache.get(a).savedAt - cache.get(b).savedAt);
  return new Set([...must, ...old.slice(0, MAX_OLD_REFRESH)]);
}

function cachePath(dir, day) {
  return join(dir, `day-${day}.json`);
}

/** Gueltige Tagesdateien; fehlende oder kaputte fehlen in der Map (= neu laden). */
export function readCache(dir, days) {
  const out = new Map();
  for (const d of days) {
    try {
      const c = JSON.parse(readFileSync(cachePath(dir, d), 'utf8'));
      if (c?.day === d && typeof c.fp === 'string' && Number.isFinite(c.savedAt) && Array.isArray(c.rows)) out.set(d, c);
    } catch { /* fehlt oder kaputt */ }
  }
  return out;
}

/** Atomar: Temp-Datei + rename. */
export function writeCache(dir, day, fp, rows, now = Date.now()) {
  const file = cachePath(dir, day);
  const tmp = `${file}.${process.pid}`;
  writeFileSync(tmp, JSON.stringify({ day, fp, savedAt: now, rows }));
  renameSync(tmp, file);
}

/** Tage ausserhalb des Fensters und liegengebliebene Temp-Dateien loeschen. */
export function pruneCache(dir, keep) {
  for (const f of readdirSync(dir)) {
    const m = f.match(/^day-(\d{4}-\d{2}-\d{2})\.json$/);
    if ((m && !keep.has(m[1])) || /^day-.*\.json\.\d+$/.test(f)) {
      try { unlinkSync(join(dir, f)); } catch { /* egal */ }
    }
  }
}
