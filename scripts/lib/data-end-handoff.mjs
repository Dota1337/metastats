// Endtag E (volle Tage, Migration 0095) von der Vorab-Rechnung an den
// Publisher. Beide laufen in derselben systemd-Unit
// (metastats-snapshot-publisher.service: ExecStartPre + ExecStart) und teilen
// sich damit dasselbe private /tmp (PrivateTmp=yes). Die Vorab-Rechnung pinnt
// E einmal und legt ihre Listen unter window_end = E ab; der Publisher muss
// genau diesen Tag nehmen, sonst trifft der Vorrat nicht und die schweren
// Listen laufen wieder live (7-21 s). Fehlt die Datei oder ist sie aelter als
// MAX_AGE_MS (Handlauf ausserhalb der Unit), bestimmt der Publisher E selbst.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const DATA_END_HANDOFF_PATH = process.env.DATA_END_HANDOFF_PATH
  || join(tmpdir(), 'metastats-data-end.json');
const MAX_AGE_MS = 6 * 3600 * 1000;
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDay(s) {
  if (typeof s !== 'string' || !ISO_DAY_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** Schreibt E (oder null = altes Fenster) atomar. Fehler nur melden. */
export function writeDataEndHandoff(dataEnd, path = DATA_END_HANDOFF_PATH) {
  try {
    const tmp = `${path}.${process.pid}`;
    writeFileSync(tmp, JSON.stringify({ dataEnd: isIsoDay(dataEnd) ? dataEnd : null, at: new Date().toISOString() }));
    renameSync(tmp, path);
    return true;
  } catch (err) {
    console.warn(`[data-end] Uebergabe nicht geschrieben (${path}): ${err.message}`);
    return false;
  }
}

/**
 * undefined = keine frische Uebergabe (selbst bestimmen); null = die
 * Vorab-Rechnung lief bewusst ohne Endtag; sonst der Tag.
 */
export function readDataEndHandoff(path = DATA_END_HANDOFF_PATH, now = Date.now()) {
  let raw;
  try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch { return undefined; }
  const at = Date.parse(raw?.at);
  if (!Number.isFinite(at) || now - at > MAX_AGE_MS || at > now + 60_000) return undefined;
  if (raw.dataEnd === null) return null;
  return isIsoDay(raw.dataEnd) ? raw.dataEnd : undefined;
}
