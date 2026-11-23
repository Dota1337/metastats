// Marktwert-Sync Box → Supabase: nur neue oder geaenderte Zeilen senden.
//
// Anlass (gemessen 23.11.2026, pg_stat_statements seit 17.11.): der Sync schickte
// je Lauf alle 337–385 Tsd. Snapshot-Zeilen des 3-Tage-Fensters plus 132 Tsd.
// Season-Stats, 4× am Tag — auf Supabase 15.786 s Abfragezeit und 23 GB WAL in
// 5,2 Tagen, 5,59 Mio. Updates gegen 0,54 Mio. echte Inserts. Der Lauf vom
// 22.11. 19:15 UTC riss deswegen die 25-min-Frist.
//
// Der Zustand merkt sich je Zeile einen Fingerabdruck dessen, was WIRKLICH bei
// Supabase angekommen ist (onBatchDone), nicht was die Box hat:
// - Zeile neu oder Wert anders → senden.
// - Eintrag aelter als FP_MAX_AGE_MS → trotzdem senden. Jede Zeile geht so
//   mindestens einmal am Tag neu raus und heilt Verluste, die nur auf Supabase
//   passieren (Wiederherstellung, Rueckbau, Loeschen von Hand) — die sieht der
//   Vertrag sync-parity nur als Zeilenzahl, nicht als Wert.
// - Zustand einer anderen Supabase-Adresse, kaputt oder fehlt → alles senden.
// Schluessel und Fingerabdruck sind gekuerzte SHA-1 (96 bit), damit der Zustand
// bei ~450 Tsd. Zeilen klein bleibt.

import { createHash } from 'node:crypto';

export const FP_STATE_VERSION = 1;
// 22 h statt 24 h: der Sync laeuft alle 6 h mit bis zu 5 min Zufallsversatz;
// mit 24 h fiele die taegliche Neusendung oft erst auf den fuenften Lauf (30 h).
export const FP_MAX_AGE_MS = 22 * 3_600_000;

const short = (s, n = 16) => createHash('sha1').update(s).digest('base64url').slice(0, n);

/** Kennung der Supabase-Adresse (ohne Geheimnis), an die der Zustand gebunden ist. */
export function targetId(supaUrl) {
  return short(String(supaUrl || '').trim().replace(/\/+$/, '').toLowerCase(), 12);
}

export function rowKey(row, keyCols) {
  return short(keyCols.map((c) => String(row[c])).join('\u0001'));
}

const norm = (v) => (v instanceof Date ? v.toISOString() : v);

/** Fingerabdruck ueber alle Spalten in Abfrage-Reihenfolge, ohne `omit`. */
export function rowFingerprint(row, omit = []) {
  const skip = new Set(omit);
  const parts = [];
  for (const k of Object.keys(row)) if (!skip.has(k)) parts.push(k, norm(row[k]));
  return short(JSON.stringify(parts));
}

export function emptyState(target) {
  return { v: FP_STATE_VERSION, target, entries: {} };
}

/** Geladene Datei pruefen. reason = null, wenn sie gilt; sonst Grund fuers Komplett-Senden. */
export function loadState(raw, target) {
  if (raw == null) return { state: emptyState(target), reason: 'kein Zustand' };
  if (raw.v !== FP_STATE_VERSION || typeof raw.entries !== 'object' || raw.entries === null || Array.isArray(raw.entries)) {
    return { state: emptyState(target), reason: 'Zustand unlesbar' };
  }
  if (raw.target !== target) return { state: emptyState(target), reason: 'Zustand gehoert zu einer anderen Supabase-Adresse' };
  return { state: raw, reason: null };
}

/**
 * Welche Zeilen muessen raus? meta[i] = [key, fp, isNew] gehoert zu send[i]
 * und wird erst nach dem angekommenen Paket per recordSent eingetragen.
 * isNew = neu oder geaendert (nicht nur die taegliche Neusendung) — nur diese
 * Spieler muessen die Peaks neu rechnen.
 */
export function selectChanged(rows, state, { keyOf, fpOf, now = Date.now(), maxAgeMs = FP_MAX_AGE_MS }) {
  const send = [];
  const meta = [];
  const seen = new Set();
  const counts = { total: rows.length, unchanged: 0, fresh: 0, changed: 0, expired: 0 };
  for (const row of rows) {
    const k = keyOf(row);
    const fp = fpOf(row);
    seen.add(k);
    const e = state.entries[k];
    if (Array.isArray(e) && e[0] === fp && now - e[1] * 60_000 < maxAgeMs) { counts.unchanged++; continue; }
    let isNew = true;
    if (!Array.isArray(e)) counts.fresh++;
    else if (e[0] !== fp) counts.changed++;
    else { counts.expired++; isNew = false; }
    send.push(row);
    meta.push([k, fp, isNew]);
  }
  return { send, meta, seen, counts };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Fester Versatz je Schluessel in [0, spanMs) — verteilt die taegliche Neusendung. */
export function keySpreadMs(k, spanMs) {
  let x = 0;
  for (const c of String(k).slice(0, 8)) x = x * 64 + Math.max(0, B64.indexOf(c));
  return (x % Math.max(1, Math.floor(spanMs / 60_000))) * 60_000;
}

/**
 * Angekommene Zeilen eintragen (Minuten seit 1970, haelt die Datei klein).
 * spreadMs > 0 (nur beim Aufbau eines leeren Zustands): Sendezeit je Schluessel
 * um einen festen Versatz zurueckdatieren. Sonst liefen alle Eintraege
 * gleichzeitig ab und jeder 4. Lauf schickte wieder das ganze Fenster; so
 * verteilt sich die taegliche Neusendung auf alle vier Laeufe.
 */
export function recordSent(state, metaSlice, now = Date.now(), spreadMs = 0) {
  for (const [k, fp] of metaSlice) {
    const t = spreadMs > 0 ? now - keySpreadMs(k, spreadMs) : now;
    state.entries[k] = [fp, Math.floor(t / 60_000)];
  }
}

/** Eintraege ausserhalb der aktuellen Auswahl entfernen — nur in ungefilterten Laeufen. */
export function pruneState(state, seen) {
  let n = 0;
  for (const k of Object.keys(state.entries)) {
    if (!seen.has(k)) { delete state.entries[k]; n++; }
  }
  return n;
}
