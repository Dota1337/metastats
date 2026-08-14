#!/usr/bin/env node
/**
 * Traegt den Haertungsboden aus infra/hetzner/hardening-floor.conf woertlich
 * in jede infra/hetzner/metastats-*.service ein und haengt die Ausnahmen der
 * jeweiligen Unit dahinter.
 *
 * Warum ein Generator und kein Drop-In: systemd kennt kein Include, und ein
 * Drop-In unter /etc/systemd/system/UNIT.service.d/ waere Zustand, den
 * scripts/build-system-map.mjs beim Parsen der Unit-Files nicht sieht — die
 * Systemkarte wuerde dann etwas anderes behaupten als auf der Box gilt. Also
 * Duplikat im Repo, erzwungen durch check-system-map.mjs.
 *
 * Warum die Ausnahmen HINTER dem Boden stehen: systemd nimmt bei
 * Nicht-Listen-Direktiven die letzte Zuweisung. `PrivateTmp=no` nach
 * `PrivateTmp=yes` gewinnt also. Deshalb ist die Reihenfolge nicht Kosmetik.
 *
 * Aufruf:  node scripts/apply-hardening-floor.mjs [--check]
 *   --check  schreibt nichts, Exit 1 wenn eine Unit vom Soll abweicht
 *            (das ist der Modus, den der pre-push-Gate benutzt)
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const UNIT_DIR = 'infra/hetzner';
const FLOOR_FILE = join(UNIT_DIR, 'hardening-floor.conf');
const BEGIN = '# --- BEGIN metastats-hardening-floor ---';
const END = '# --- END metastats-hardening-floor ---';

/**
 * Pro Unit: was sie ZUSAETZLICH braucht, und warum. Der Grund steht als
 * Kommentar mit in der Unit — wer sie in einem halben Jahr liest, soll nicht
 * raten muessen, warum ausgerechnet hier eine Direktive aufgeweicht ist.
 *
 * Die Schreibpfade stammen aus einem Datei-fuer-Datei-Review der Scripts
 * (2026-08-14), nicht aus Vermutung. Zwei davon sind der teure Fall: sowohl
 * daily-crawl-cursor.mjs als auch crawl-all-regions.mjs SCHLUCKEN einen
 * Schreibfehler beim Cursor. Ohne ReadWritePaths liefe der Crawl 14h lang
 * gruen durch und haette trotzdem keinen Tag als erledigt verbucht.
 */
const EXCEPTIONS = {
  'metastats-daily-crawl.service': [
    ['ReadWritePaths=/etc/metastats-crawler /run/lock',
      'Tages-Cursor (lib/daily-crawl-cursor.mjs) + Advisory-Lock. Cursor-Schreibfehler wird geschluckt -> ohne das hier laeuft der Crawl still ins Leere.'],
  ],
  'metastats-daily-crawl-resume.service': [
    ['ReadWritePaths=/etc/metastats-crawler /run/lock',
      'Gleiches Script wie daily-crawl, nur --resume-gaps.'],
  ],
  'metastats-crawler.service': [
    ['ReadWritePaths=/etc/metastats-crawler',
      'mv-region-cursor.json. writeCursor schluckt Fehler -> Region-Rotation faellt sonst still auf euw1 zurueck.'],
  ],
  'metastats-lol-marketvalue.service': [
    ['ReadWritePaths=/etc/metastats-crawler',
      'lol-mv-last-run-Marker.'],
  ],
  'metastats-snapshot-publisher.service': [
    ['ReadWritePaths=/run/lock',
      'Advisory-Lock; openSync(...,"wx") wirft EROFS und acquireLock reicht das weiter.'],
  ],
  'metastats-contracts.service': [
    ['StateDirectory=metastats',
      'contracts-status.json. StateDirectory statt ReadWritePaths, weil systemd das Verzeichnis dann auch anlegt.'],
  ],
  'metastats-health.service': [
    ['StateDirectory=metastats-health', 'Health-State.'],
  ],
  'metastats-build-check.service': [
    ['StateDirectory=metastats-health',
      'build-check-state.json. Ohne beschreibbares Ziel faellt das Script auf einen relativen Pfad im WorkingDirectory zurueck — und den raeumt der naechste git-Deploy weg.'],
  ],
  'metastats-phase1-probe.service': [
    ['LogsDirectory=metastats',
      'Der ExecStart macht selbst mkdir -p /var/log/metastats und haengt dort an.'],
  ],
  'metastats-tft-pro-tpc-roster.service': [
    ['PrivateTmp=no',
      'Resume-Cache nach 429-Abbruch liegt in /tmp und soll 6h ueberleben. Mit PrivateTmp waere er pro Lauf frisch, der 429-Schutz also tot.'],
  ],
  'metastats-tft-pro-fullsync.service': [
    ['ProtectHome=read-only',
      'gh issue create liest /root/.config/gh. GH_TOKEN steht zwar im env-File, aber read-only kostet nichts und nimmt den stillen Fehlerfall raus.'],
    ['PrivateTmp=no',
      'Cooldown-/Strike-/Lock-Dateien des Liquipedia-Schutzes liegen in tmpdir(). Heute laeuft --steps=local, der Pfad ist kalt — wer auf liquipedia-Steps umstellt, verliert mit PrivateTmp die Strike-Historie und laeuft in die bekannte IP-Sperre.'],
  ],
  'metastats-tft-pro-validator.service': [
    ['ProtectHome=read-only', 'Wie fullsync: gh issue create.'],
    ['PrivateTmp=no', 'Wie fullsync: Liquipedia-Schutzdateien in tmpdir().'],
  ],
};

function floorBlock() {
  const raw = readFileSync(FLOOR_FILE, 'utf8');
  const from = raw.indexOf(BEGIN);
  const to = raw.indexOf(END);
  if (from === -1 || to === -1) {
    throw new Error(`${FLOOR_FILE}: Markerzeilen fehlen`);
  }
  return raw.slice(from, to + END.length).replace(/\r\n/g, '\n').trimEnd();
}

function renderBlock(unit) {
  const parts = [floorBlock()];
  const ex = EXCEPTIONS[unit];
  if (ex && ex.length) {
    parts.push('# Ausnahmen dieser Unit (stehen bewusst NACH dem Boden — systemd nimmt');
    parts.push('# bei Nicht-Listen-Direktiven die letzte Zuweisung):');
    for (const [line, why] of ex) {
      parts.push(`#   ${why}`);
      parts.push(line);
    }
  }
  return parts.join('\n');
}

/** Fuegt den Block am Ende des [Service]-Abschnitts ein bzw. ersetzt ihn. */
function withBlock(text, unit) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const block = renderBlock(unit).split('\n');

  const begin = lines.indexOf(BEGIN);
  if (begin !== -1) {
    // Vorhandenen Block ersetzen. Ende ist die naechste Leerzeile oder der
    // naechste Abschnitt nach END — die Ausnahmen haengen hinter END dran.
    let end = lines.indexOf(END, begin);
    if (end === -1) throw new Error(`${unit}: BEGIN ohne END`);
    while (end + 1 < lines.length
      && lines[end + 1].trim() !== ''
      && !lines[end + 1].startsWith('[')) end++;
    lines.splice(begin, end - begin + 1, ...block);
    return lines.join(eol);
  }

  const svc = lines.findIndex(l => l.trim() === '[Service]');
  if (svc === -1) throw new Error(`${unit}: kein [Service]-Abschnitt`);
  let at = lines.length;
  for (let i = svc + 1; i < lines.length; i++) {
    if (lines[i].startsWith('[')) { at = i; break; }
  }
  // Vor dem naechsten Abschnitt einfuegen, mit einer Leerzeile Abstand.
  while (at > svc + 1 && lines[at - 1].trim() === '') at--;
  lines.splice(at, 0, '', ...block);
  return lines.join(eol);
}

const check = process.argv.includes('--check');
const units = readdirSync(UNIT_DIR)
  .filter(f => f.startsWith('metastats-') && f.endsWith('.service'))
  .sort();

const drift = [];
let written = 0;
for (const unit of units) {
  const path = join(UNIT_DIR, unit);
  const before = readFileSync(path, 'utf8');
  const after = withBlock(before, unit);
  if (before === after) continue;
  if (check) { drift.push(unit); continue; }
  writeFileSync(path, after);
  written++;
}

const unknown = Object.keys(EXCEPTIONS).filter(u => !units.includes(u));
if (unknown.length) {
  console.error(`Ausnahmen fuer nicht existierende Units: ${unknown.join(', ')}`);
  process.exit(1);
}

if (check) {
  if (drift.length) {
    console.error(`Haertungsboden fehlt oder weicht ab in ${drift.length} Unit(s):`);
    for (const u of drift) console.error(`  - ${u}`);
    console.error('Fix: node scripts/apply-hardening-floor.mjs');
    process.exit(1);
  }
  console.log(`Haertungsboden in allen ${units.length} Units aktuell.`);
} else {
  console.log(`Haertungsboden geschrieben: ${written} von ${units.length} Units geaendert.`);
}
