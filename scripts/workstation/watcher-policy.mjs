// Entscheidungskern des Prozess-Waechters: aus einer Prozessliste ableiten,
// wer gesenkt, gedrosselt oder beendet wird. Reine Funktionen ohne
// Systemzugriff, damit jede Regel testbar ist (watcher-policy.test.mjs) —
// process-watcher.mjs ist nur der Glue mit Prozessabfrage, setPriority und kill.
//
// Vorfall 07.10.2026: abgelaufene grep-/du-Aufrufe liefen unter Windows als
// Waisen weiter und bremsten das Spiel des Users. User-Vorgabe danach:
// „Wenn wir eine Berechnung starten, die bewusst ueber 2 Minuten geht, muss sie
// auch durchlaufen koennen“ — deshalb DROSSELN statt beenden. Beendet wird nur
// ein verwaistes Suchprogramm, dessen Ausgabe niemand mehr liest.
import os from 'node:os';
import path from 'node:path';

/** Ab so viel eigener CPU-Zeit (Sekunden) wird ein Claude-Nachfahre auf Leerlauf gesetzt. */
export const CPU_DROSSEL_S = 120;

/** Windows-Basisprioritaeten wie Win32_Process.Priority sie meldet. */
export const PRIO = { IDLE: 4, BELOW_NORMAL: 6, NORMAL: 8 };

/** Aelter als das ist der Herzschlag eines toten Waechters. */
export const HERZ_ALT_MS = 180_000;

/**
 * Sperrdatei und Log. LOCALAPPDATA statt %TEMP%, weil Claude-Sitzungen ihr
 * TEMP verbiegen koennen — dann saehe jede Sitzung eine andere Sperre und
 * startete einen eigenen Waechter.
 */
export const WAECHTER_ORDNER = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'metastats-watcher');

const pfad = (s) => String(s || '').toLowerCase().replace(/\//g, '\\');
const ausGit = (p) => /\\git\\(usr\\)?bin\\/.test(pfad(p.exe));

/** claude.exe im rg-Modus: das Grep-Tool startet claude.exe als ripgrep. */
export function istRgModus(p) {
  if (!/^claude\.exe$/i.test(p.name || '')) return false;
  const c = String(p.cmd || '');
  return /^"?rg(\.exe)?"?(\s|$)/i.test(c) || /claude(\.exe)?"?\s+(rg|--ripgrep)(\s|$)/i.test(c);
}

/** Die eigentliche Claude-Code-Sitzung — erkannt am Pfad, damit Claude Desktop nie zaehlt. */
export function istClaudeHaupt(p) {
  const exe = pfad(p.exe);
  const claudeCode = /\\@anthropic-ai\\claude-code\\/.test(exe) || /\\\.local\\bin\\claude\.exe$/.test(exe);
  return claudeCode && !istRgModus(p);
}

/** Der agentdb-Dienst laeuft abgekoppelt von Claude und wird mitgesenkt. */
export function istAgentdb(p) {
  return /scripts[\\/]agentdb[\\/]server\.mjs/i.test(String(p.cmd || ''));
}

/**
 * Reine Suchprogramme — die einzigen Prozesse, die je beendet werden.
 * grep/find/du nur aus Git: das find.exe von Windows ist ein anderes Programm.
 */
export function istSuchProgramm(p) {
  const name = String(p.name || '').toLowerCase();
  if (/^(grep|egrep|fgrep|find|du)\.exe$/.test(name)) return ausGit(p);
  if (name === 'rg.exe') return true;
  return istRgModus(p);
}

/** Git-Shell, in der eine Suche haengen bleiben kann, wenn ihr Claude-Elternteil weg ist. */
const istGitShell = (p) => /^(bash|sh)\.exe$/i.test(p.name || '') && ausGit(p);

/** PID allein ist kein Ausweis: Windows vergibt PIDs neu. */
export const schluessel = (p) => `${p.pid}@${p.created}`;

function nichtJuenger(eltern, kind) {
  try { return BigInt(eltern) <= BigInt(kind); } catch { return false; }
}

/**
 * @param {Array<{pid:number, ppid:number, name:string, exe:string, cmd:string,
 *                created:string, cpu:number, prio:number}>} procs
 *   created = Startzeit als FILETIME-String, cpu = Sekunden, prio = Basisprioritaet
 * @param {{ selfPid:number, lineage?: Set<string> }} opts
 *   lineage = Schluessel aller Prozesse, die im letzten Durchgang an Claude hingen
 */
export function decide(procs, { selfPid, lineage = new Set() } = {}) {
  const byPid = new Map(procs.map((p) => [p.pid, p]));

  // Ein Elternteil zaehlt nur, wenn er lebt und nicht juenger als das Kind ist —
  // sonst gehoert die PID inzwischen einem fremden Prozess.
  const eltern = (p) => {
    const q = byPid.get(p.ppid);
    if (!q || q.pid === p.pid || !nichtJuenger(q.created, p.created)) return null;
    return q;
  };

  // anClaude: ein Vorfahre ist die Claude-Sitzung. eigen: Baum des Waechters.
  // waise: der Elternteil fehlt, oder die Kette aus Git-Shells endet im Nichts.
  const info = new Map();
  const herkunft = (p) => {
    if (info.has(p.pid)) return info.get(p.pid);
    info.set(p.pid, { anClaude: false, eigen: false, waise: false }); // Schutz vor Zyklen
    let r;
    if (p.pid === selfPid) r = { anClaude: false, eigen: true, waise: false };
    else {
      const q = eltern(p);
      if (!q) r = { anClaude: false, eigen: false, waise: true };
      else if (istClaudeHaupt(q)) r = { anClaude: true, eigen: false, waise: false };
      else {
        const e = herkunft(q);
        r = { anClaude: e.anClaude, eigen: e.eigen, waise: e.waise && istGitShell(q) };
      }
    }
    info.set(p.pid, r);
    return r;
  };

  const lower = [];
  const idle = [];
  const kill = [];
  const neu = new Set();
  let claudeDa = false;

  for (const p of procs) {
    const h = herkunft(p);
    if (h.eigen) continue;
    const key = schluessel(p);
    const haupt = istClaudeHaupt(p);
    if (haupt) claudeDa = true;
    const vonClaude = h.anClaude || lineage.has(key);
    if (vonClaude) neu.add(key);

    // Beenden nur, wenn alle drei gelten: Suchprogramm, haengt nicht mehr an
    // Claude, und stammt nachweislich von Claude (frueher gesehen, oder als
    // Waise mit der von Claude geerbten gesenkten Prioritaet).
    if (istSuchProgramm(p) && !h.anClaude
      && (lineage.has(key) || (h.waise && p.prio <= PRIO.BELOW_NORMAL))) {
      kill.push({ ...p, grund: lineage.has(key) ? 'verwaiste Claude-Suche' : 'verwaiste Suche mit gesenkter Prioritaet' });
      continue;
    }
    if (vonClaude && !haupt && p.cpu > CPU_DROSSEL_S && p.prio > PRIO.IDLE) {
      idle.push({ ...p, grund: `${Math.round(p.cpu)} s CPU` });
      continue;
    }
    if (p.prio > PRIO.BELOW_NORMAL && (haupt || h.anClaude || istAgentdb(p))) {
      lower.push({ ...p, grund: haupt ? 'Claude-Sitzung' : h.anClaude ? 'Claude-Nachfahre' : 'agentdb' });
    }
  }

  return { lower, idle, kill, lineage: neu, claudeDa };
}

/**
 * Lebt der Waechter laut Sperrdatei? Herzschlag = Aenderungszeit der Datei.
 * pid -1 heisst „gerade unlesbar“ (wird geschrieben) — frisch gilt dann als lebendig.
 * @param {{pid:number, mtimeMs:number}|null} info
 * @param {number} now
 * @param {(pid:number) => boolean} lebt
 */
export function waechterLebt(info, now, lebt) {
  if (!info || !(now - info.mtimeMs < HERZ_ALT_MS)) return false;
  if (info.pid === -1) return true;
  return Number.isInteger(info.pid) && info.pid > 0 && lebt(info.pid);
}
