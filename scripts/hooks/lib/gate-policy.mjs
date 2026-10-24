// Policy-Kern des Schreib-Gates. Bewusst frei von stdin, process.exit und
// Hook-JSON: das hier ist der testbare Teil, `write-gate.mjs` ist nur Glue.
//
// Warum getrennt: `planQuality()` ist reine Textlogik mit Regex-Vorgeschichte,
// und `pathsWrittenByShell()` muss gegen echte Kommandozeilen aus dem Transcript
// geprueft werden koennen. Ein Hook-Entry-Point laesst sich nicht unit-testen,
// diese Funktionen schon — dieselbe Aufteilung wie bei `state.mjs` +
// `state.test.mjs`.

import { readFileSync, statSync, realpathSync } from 'node:fs';
import { relative, isAbsolute, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { toNativePath, textbloecke, zerlege, befehlsWoerter, befehlsName, istVerdopplung, TEXTBLOCK } from './shell-words.mjs';

// Frueher hier definiert; search-policy und die Tests importieren es weiter von hier.
export { toNativePath };

// --------------------------------------------------------------- Freistellungen

/**
 * Routine-Ops: getrackte Skripte, deren Ausfuehrung wiederkehrender Betrieb ist
 * und keine Architektur-Entscheidung. Nur der AUFRUF ist freigestellt, nicht
 * die Datei — wer den Inhalt aendern will, braucht weiterhin einen Plan.
 * Aufnahmekriterium: `isExempt(pfad)` muss false sein, sonst waere der Eintrag
 * ein Schlupfloch (Skript unbemerkt umschreiben, dann ausfuehren).
 */
export const ROUTINE_OPS = new Set([
  'scripts/refresh-riot-key.mjs',
  // Schritt 0 jedes Pruefer-Agenten (AGENTS.md, Spec-First): startet den
  // Recall-Dienst und schreibt nur nach ~/.claude/agentdb (ensure-daemon.mjs:33,
  // :113). Ohne Eintrag blockte das Gate die Pruefer VOR der Freigabe — also
  // genau den Schritt, der zur Freigabe fuehren soll (logic-flow-critic 24.10.2026).
  'scripts/agentdb/ensure-daemon.mjs',
]);

/**
 * Die fuenf Stellen, an denen das Gate selbst haengt. Sie liegen in Ordnern,
 * die sonst komplett freigestellt sind, und werden deshalb namentlich
 * zurueckgeholt (Sicherheitsdurchsicht 19.09.2026, Befunde 1 und 2).
 * Ohne Ruecksicht auf Gross-/Kleinschreibung: Windows unterscheidet sie nicht,
 * `.claude/SETTINGS.JSON` IST die Registrierung (Durchsicht 24.10.2026,
 * gate-selbst-schreibweise). settings.local.json kam am selben Tag dazu — auch
 * dort laesst sich `disableAllHooks` setzen (hooks-abschaltbar-settings-local).
 */
const GATE_SELBST =
  /^(\.git\/(metastats-discipline\/|hooks\/|config$)|\.claude\/settings(\.local)?\.json$)/i;

/** Dieselben Stellen als Projektpfade — Quelle fuer die Verweis-Aufloesung in toRel. */
const GATE_PFADE = [
  '.claude/settings.json', '.claude/settings.local.json',
  '.git/config', '.git/hooks', '.git/metastats-discipline',
];

/**
 * Pfade, die das Gate nichts angehen. Uebernommen aus plan-gate.mjs, erweitert
 * um die Freistellung, ohne die sich das Gate selbst einsperrt
 * (logic-flow-critic F1, 2026-09-01): seinen eigenen Quellcode unter
 * scripts/hooks/. Ohne die ist eine Reparatur von innen nicht moeglich —
 * WRITE_GATE=0 laesst sich aus einem geblockten Kommando heraus nicht setzen,
 * das braucht einen Neustart von Claude Code.
 *
 * Die Hook-Registrierung (.claude/settings.json) war bis zur
 * Sicherheitsdurchsicht am 19.09.2026 aus demselben Grund frei. Sie ist es
 * NICHT mehr: wer sie schreiben darf, traegt das Gate aus und braucht nie
 * wieder einen Plan. Der Rollback laeuft stattdessen ueber scripts/hooks/
 * (dort steht der Code, der die Ablehnung ausspricht) oder von aussen.
 */
export function isExempt(rel) {
  if (rel == null) return true;
  // Leerer relativer Pfad = die Projektwurzel selbst. Das ist der Fall bei
  // Kommandos, die den ganzen Baum anfassen (`git reset --hard`, `git clean`),
  // und der darf gerade NICHT als freigestellt durchgehen.
  if (rel === '') return false;
  if (rel.startsWith('..') || isAbsolute(rel)) return true;      // ausserhalb des Projekts
  // Wer diese Stellen schreiben darf, haengt das Gate aus, ohne je einen
  // Plan vorzulegen: der Freigabe-Zustand (.git/metastats-discipline/), die 13
  // Pruefungen vor dem Hochladen (.git/hooks/), core.hooksPath (.git/config)
  // und die Registrierung dieses Hooks (.claude/settings{,.local}.json). Der
  // Rest beider Ordner bleibt frei — .claude/plan-current.md MUSS schreibbar
  // bleiben, sonst verlangt das Gate einen Plan und sperrt zugleich dessen
  // Erstellung.
  if (GATE_SELBST.test(rel)) return false;
  if (rel.startsWith('.claude/') || rel.startsWith('.git/')) return true;
  if (rel === 'AGENTS.md' || rel === 'CLAUDE.md') return true;
  // Der eigene Reparaturpfad. Ein Logikfehler im Gate schreibt sauberes
  // "deny" und Exit 0 — das ist KEIN Absturz und faellt deshalb nicht offen
  // aus. Ohne diese Zeile waere der Fix am Gate selbst gesperrt.
  if (rel.startsWith('scripts/hooks/')) return true;
  if (rel === 'infra/claude-settings/hooks.json') return true;
  // Notizen und Doku ausserhalb des Codes.
  if (/\.(md|txt)$/i.test(rel) && !/^(app|scripts|infra)\//.test(rel)) return true;
  // Regel- und Spec-Prosa unter infra/ (User-Entscheidung 2026-08-17).
  // infra/claude-agents/ bleibt bewusst gesperrt.
  if (/^infra\/(claude-settings|specs)\/.+\.md$/i.test(rel)) return true;
  return false;
}

/**
 * Echter Pfad einer Stelle, Verweise aufgeloest. Gibt den Eingabepfad zurueck,
 * wenn es die Stelle (noch) nicht gibt — realpathSync wirft dann.
 */
function echterPfad(p) {
  const s = (x) => x.split('\\').join('/');
  try { return s(realpathSync(p)); } catch { return s(p); }
}

/** Fuer Vergleiche: unter Windows ohne Gross-/Kleinschreibung. */
function gefaltet(p, platform = process.platform) {
  return platform === 'win32' ? p.toLowerCase() : p;
}

/**
 * NTFS-Schreibweisen, die auf dieselbe Datei zeigen: `datei::$DATA`,
 * `datei:strom`, abschliessende Punkte oder Leerzeichen (`settings.json.`).
 * Unter Windows sind das andere Namen fuer dieselbe Datei — und damit ein
 * zweiter Weg an GATE_SELBST vorbei.
 */
function ohneNtfsZusatz(p, platform = process.platform) {
  if (platform !== 'win32') return p;
  return p.split('/').map((teil, i) => {
    if (i === 0 && /^[A-Za-z]:$/.test(teil)) return teil;
    return teil.replace(/:.*$/, '').replace(/[. ]+$/, '') || teil;
  }).join('/');
}

export { toNativePath as _toNativePathFuerTests };

/** Absoluter oder relativer Pfad -> projekt-relativ mit Vorwaerts-Slashes. */
export function toRel(file, projectDir, base = projectDir) {
  if (!file) return '';
  file = toNativePath(file);
  base = toNativePath(base);
  const abs = ohneNtfsZusatz((isAbsolute(file) ? resolve(file) : resolve(base, file)).split('\\').join('/'));
  // .claude/settings.json ist auf dieser Workstation ein Verweis nach Dropbox
  // (reference_workstation_sync). Ueber den Zielpfad geschrieben sieht die Datei
  // aus wie 'ausserhalb des Projekts' und waere damit freigestellt — das Gate
  // liesse sich ueber diesen Umweg abschalten. Deshalb werden Treffer auf die
  // Gate-Stellen auf ihren Projektnamen zurueckgerechnet. Verglichen wird
  // gefaltet: unter Windows ist `…/SETTINGS.JSON` derselbe Verweis.
  const real = echterPfad(abs);
  for (const p of GATE_PFADE) {
    const ziel = echterPfad(resolve(projectDir, p));
    if (gefaltet(real) === gefaltet(ziel)) return p;
    if (gefaltet(real).startsWith(`${gefaltet(ziel)}/`)) return p + real.slice(ziel.length);
  }
  return relative(projectDir, abs).replace(/\\/g, '/');
}

// ------------------------------------------------------------------ Plan-Pruefung

// `stat` haengt bewusst am `read`: stellt ein Test den Inhalt selbst, gibt es
// keine Datei auf der Platte, die man befragen koennte.
export function planQuality(planFile, read = readFileSync, stat = read === readFileSync ? statSync : null) {
  let text;
  try {
    // INNERHALB des try, nicht davor: in write-gate.mjs steht der Aufruf hinter
    // dem catch, eine Ausnahme hier wuerde die Ablehnung komplett verschlucken
    // und das Gate stillschweigend oeffnen (logic-flow-critic, 19.09.2026).
    // Ein Ordner an der Planstelle warf frueher EISDIR und galt damit als
    // 'Pruefung uebersprungen' = bestandener Plan.
    if (stat && !stat(planFile).isFile()) return { ok: false, why: 'keine Plan-Datei' };
    text = read(planFile, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return { ok: false, why: 'keine Plan-Datei' };
    // Bis 24.10.2026 galt jeder andere Fehler als bestandener Plan
    // (plan-pruefung-faellt-offen). Jetzt nicht bestanden — ohne Aussperren,
    // der Plan liegt in .claude/ und bleibt schreibbar. Der Grund nennt den
    // Fehler, damit ein Bug hier nicht wie "kein Plan" aussieht.
    return { ok: false, why: `Plan-Datei nicht lesbar (${err?.code || err?.message || err})` };
  }

  const hasVerdictHeading = /^#{1,4}\s*verdicts?\b/im.test(text);
  const AGENT = /\b(metastats-[a-z-]+|classification-reviewer|Explore)\b/i;
  const verdictLines = text.split('\n')
    .filter((l) => AGENT.test(l) && /[-*|]/.test(l.trim()[0] || ''));
  if (!hasVerdictHeading || !verdictLines.length) {
    return { ok: false, why: 'kein "## Verdicts"-Block mit mindestens einem Agent-Verdict' };
  }

  const tableRows = text.split('\n')
    .filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s|:-]+\|?\s*$/.test(l)).length;
  const numbered = (text.match(/^\s*(\d+[.)]|[A-C]\))\s+\S/gm) || []).length;
  if (Math.max(tableRows - 1, numbered) < 3) {
    return { ok: false, why: 'weniger als 3 Alternativen mit Trade-offs im Plan' };
  }
  return { ok: true };
}

// -------------------------------------------------- Schreibpfade aus Shell-Zeilen

// Kommandos, deren Rest an eine andere Maschine oder in einen Container geht.
// Lokal schreiben sie trotzdem: ueber Umleitungen (die macht die lokale Shell,
// `ssh box cat x > app/y.ts`) und ueber ihre Herunterlade-Ziele (`scp h:/x
// app/a.ts`, `vercel env pull .env.local`) — beides wird einzeln geprueft
// (Sicherheitsdurchsicht 24.10.2026, fernbefehl-umleitung-unerkannt).
const REMOTE = new Set(['ssh', 'scp', 'rsync', 'docker', 'podman', 'kubectl', 'vercel', 'gh']);
const NODEISH = /^(node|tsx|ts-node|bun|deno)$/;
const PYTHON = /^(python[23]?|py)$/;
const SHELLS = /^(bash|sh|zsh|dash|ksh)$/;
const PWSH = /^(powershell|pwsh)$/;
// Formatierer, die mit dem richtigen Flag den Arbeitsbaum umschreiben. Ohne
// Flag sind es reine Pruefer und bleiben offen.
const FORMATTER = /^(eslint|prettier|biome|dprint)$/;
const CD = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl', 'push-location']);
// Wie tief verschachtelte Aufrufe aufgeloest werden (npm run → Script-Body,
// bash -c, powershell -Command, Heredoc an eine Shell, Skript-Datei). Heute ruft
// kein einziges der 19 Scripts in package.json ein anderes ueber `npm run` auf
// (gemessen 2026-09-01). Die Grenze steht trotzdem: eine Zeile in package.json
// wuerde fuer einen Zyklus reichen, und ein Hook, der sich aufhaengt, blockiert
// jeden Bash-Aufruf.
const MAX_TIEFE = 3;
// Namentliche Ausnahme, wie `--test`: die Build-Einstiege regenerieren
// Artefakte (`public/pro-teams`, `infra/system-map.json`, `.next`) aus Quellen,
// die im selben Lauf nicht angefasst werden. Sie sind der haeufigste
// Verifikationsschritt vor einem Commit — ein Gate, das den Build sperrt, wird
// abgeschaltet (User-Entscheid 2026-09-01: „Nimm es raus"). Die Liste ist
// bewusst eine Aufzaehlung und kein Praefix-Muster ausserhalb von `build:`:
// ein neues Script gilt erst als Build, wenn es so heisst.
const GENERATED_BUILDS = /^(dev|start|build|build:[\w:.-]+)$/;
// Schreibaufrufe in Skript- und Inline-Code (JS und Python).
// `.write(` steht bewusst AUSSERHALB der Wortgrenzen-Gruppe: ein \b vor einem
// Punkt verlangt ein Wortzeichen davor, deshalb traf das Muster zwar
// `strom.write(`, aber nicht `open(pfad).write(` — gemessen 19.09.2026.
// `stdout.write(`/`stderr.write(` sind Ausgaben, keine Dateien — vorher blockte
// `cat x | node -e "process.stdout.write(…)"`.
// Seit 24.10.2026 auch die asynchronen und Promise-Varianten (`fsp.writeFile`,
// `await rm(`), cp/symlink/link/truncate und Pythons shutil/os/pathlib
// (Sicherheitsdurchsicht, schreib-api-unerkannt).
const WRITE_CALLS = new RegExp([
  String.raw`\b(?:write|append|copy)File(?:Sync)?\b`,
  String.raw`\b(?:unlink|rename|rm|rmdir|mkdir|cp|symlink|link|truncate)Sync\b`,
  String.raw`\bcreateWriteStream\b`,
  String.raw`\b(?:fs|fsp|promises|fsPromises)\.(?:cp|rm|rmdir|rename|unlink|mkdir|symlink|link|truncate)\s*\(`,
  String.raw`\bawait\s+(?:cp|rm|rmdir|rename|unlink|mkdir|symlink|link|truncate)\s*\(`,
  String.raw`(?<!\b(?:stdout|stderr))\.write\(`,
  String.raw`\.write_(?:text|bytes)\(`,
  String.raw`\bshutil\.(?:copy\w*|move|rmtree)\(`,
  String.raw`\bos\.(?:remove|unlink|rename|replace|makedirs|mkdir|rmdir|truncate)\(`,
].join('|'));

// `[IO.File]::WriteAllText('app/x', …)` in PowerShell: das erste Argument ist das Ziel.
const DOTNET = /^\[(?:System\.)?IO\.(?:File|Directory|FileInfo|DirectoryInfo|StreamWriter)\]::(?:Write\w*|Append\w*|Create\w*|Delete|Move|Copy|Replace|SetAttributes|SetLastWriteTime\w*|OpenWrite|Open|new)$/i;

const NULLGERAET = /^(\/dev\/(null|stdout|stderr|tty|fd\/\d+)|\$null|nul|-)$/i;
// Platzhalter fuer Argumente, die erst zur Laufzeit kommen (xargs, find -exec).
const PLATZHALTER = '__ARGUMENT_ZUR_LAUFZEIT__';

/**
 * Schreibt ein Skript ausschliesslich in den Temp-Ordner? Dann ist sein Lauf
 * kein Eingriff in den Arbeitsbaum. Bewusst konservativ: es reicht NICHT, dass
 * `tmpdir` irgendwo vorkommt — es muss in jeder Zeile mit einem Schreibaufruf
 * stehen. Eine einzige Schreibzeile ohne Temp-Bezug macht das Skript wieder
 * gefaehrlich, und dann blockt das Gate.
 *
 * Kommentare zaehlen nicht: `writeFileSync('app/x.ts', y) // tmpdir` galt bis
 * 24.10.2026 als Temp-Schreiber (tmp-ausnahme-per-kommentar).
 */
export function onlyTmpWrites(body) {
  const ohneKommentare = body
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(/\r?\n/)
    .map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1').replace(/(^|\s)#.*$/, '$1'));
  const writeLines = ohneKommentare.filter((l) => WRITE_CALLS.test(l));
  if (!writeLines.length) return false;
  return writeLines.every((l) => /tmpdir|TMPDIR|os\.tmpdir|TEMP_|tmpDir/.test(l));
}

/**
 * Body eines package.json-Scripts. Sucht die package.json vom aktuellen
 * Arbeitsverzeichnis aus nach oben, weil npm das auch tut: nach
 * `cd scripts && npm run build` liegt sie eine Ebene hoeher. Findet sich
 * nichts, ist der Rueckgabewert leer und das Kommando bleibt offen — npm
 * selbst wuerde dann ebenfalls abbrechen.
 */
function npmScriptBody(name, base, readScript) {
  if (!name) return '';
  let dir = base;
  for (let i = 0; i < 6; i++) {
    try {
      const pkg = JSON.parse(readScript(resolve(dir, 'package.json'), 'utf8'));
      const body = pkg && pkg.scripts && pkg.scripts[name];
      return typeof body === 'string' ? body : '';
    } catch {
      // keine oder kaputte package.json hier — eine Ebene hoeher versuchen
    }
    const up = resolve(dir, '..');
    if (up === dir) break;
    dir = up;
  }
  return '';
}

// ---------------------------------------------------------- Pfade und Variablen

function variable(ctx, n) {
  if (Object.prototype.hasOwnProperty.call(ctx.vars, n)) return ctx.vars[n];
  const k = Object.keys(ctx.vars).find((x) => x.toLowerCase() === n.toLowerCase());
  if (k) return ctx.vars[k];                            // PowerShell: Schreibweise egal
  if (/^home$/i.test(n)) return ctx.home;
  const v = ctx.env[n];
  if (typeof v === 'string' && v !== '') return v;
  // Git Bash setzt TMPDIR, der Hook-Prozess (von Claude Code gestartet) nicht.
  // Gemeint ist in beiden Faellen der Temp-Ordner.
  if (/^(tmpdir|tmp|temp)$/i.test(n)) return ctx.tmp;
  return null;
}

/**
 * `$TEMP/x`, `${S}/x`, `$env:TEMP\x`, `%TEMP%\x`, `~/x`, `$(pwd)/x` aufloesen —
 * aus Zuweisungen weiter vorn in derselben Zeile und aus der Umgebung des Hooks.
 * Bis 24.10.2026 galt `$TEMP/vi.log` als Projektpfad: 234 der 374 Treffer in 15
 * Transcripts waren solche Variablen-Ziele (logic-flow-critic). Was sich nicht
 * aufloesen laesst, bleibt stehen und zaehlt wie bisher als Projektpfad.
 */
function expandiere(p, ctx) {
  let s = String(p);
  if (s === '~' || /^~[\\/]/.test(s)) s = ctx.home + s.slice(1);
  if (!s.includes('$') && !s.includes('%')) return s;
  s = s.replace(/\$\(\s*pwd\s*\)|\$\{PWD\}|\$PWD\b/gi, () => ctx.base);
  return s.replace(/\$\{(?:env:)?([A-Za-z_]\w*)\}|\$env:([A-Za-z_]\w*)|\$([A-Za-z_]\w*)|%([A-Za-z_]\w*)%/gi, (m, a, b, c, d) => {
    const n = a || b || c || d;
    if (n === '_') return m;                            // $_ ist das Pipeline-Objekt
    const v = variable(ctx, n);
    return v == null ? m : v;
  });
}

function pfad(ctx, p) {
  const x = toNativePath(expandiere(p, ctx));
  return isAbsolute(x) ? resolve(x) : resolve(ctx.base, x);
}

function ziel(ctx, p, base = ctx.base) {
  if (p == null || p === '') return;
  const v = expandiere(p, ctx);
  if (NULLGERAET.test(v)) return;
  // PowerShell-Laufwerke ohne Datei dahinter (`env:X`, `HKCU:\…`, `variable:`)
  // und Adressen. Bewusst eine Liste und kein Muster: `config:x` ist unter
  // Windows ein Datenstrom von `config` — dieselbe Datei.
  if (/^(env|variable|function|alias|hk(cu|lm|cr|u|cc)|cert|wsman|temp|https?|ftp):/i.test(v)) return;
  ctx.out.push({ path: v, base });
}

function lies(ctx, p) {
  try { return ctx.readScript(pfad(ctx, p), 'utf8'); } catch { return ''; }
}

/**
 * Shell-Skript lesen, `$(dirname "$0")` und `$PSScriptRoot` durch seinen Ordner
 * ersetzt — sonst gelten Ziele wie `$(dirname $0)/x.out` als Projektpfad, obwohl
 * das Skript im Scratchpad liegt (Korpus-Abgleich 24.10.2026).
 */
function skriptText(ctx, p) {
  const ordner = resolve(pfad(ctx, p), '..').split('\\').join('/');
  return lies(ctx, p)
    .replace(/\$\(\s*dirname\s+"?\$(?:0|\{0\}|\{BASH_SOURCE(?:\[0\])?\})"?\s*\)|\$\{0%\/\*\}/g, ordner)
    .replace(/\$PSScriptRoot\b/gi, ordner);
}

/** Verschachtelter Aufruf (bash -c, powershell -Command, Heredoc an eine Shell). */
function tiefer(ctx, text, shell = ctx.shell, bloecke = []) {
  if (ctx.depth >= MAX_TIEFE || !text) return;
  analysiere(text, { ...ctx, depth: ctx.depth + 1, shell, vars: { ...ctx.vars } }, bloecke);
}

/**
 * Befehle in `$(…)` (in bash auch zwischen Backticks) innerhalb eines Wortes.
 * Ohne Anfuehrungszeichen trennt die Zerlegung sie ohnehin ab; in "…" laufen
 * sie trotzdem — `echo "$(rm app/x.ts)"` loescht.
 */
function ersetzungen(v, shell) {
  const out = [];
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '$' && v[i + 1] === '(' && v[i + 2] !== '(') {
      let tiefe = 0;
      let j = i + 1;
      for (; j < v.length; j++) {
        if (v[j] === '(') tiefe++;
        else if (v[j] === ')' && --tiefe === 0) break;
      }
      out.push(v.slice(i + 2, j));
      i = j;
    } else if (shell === 'bash' && v[i] === '`') {
      const e = v.indexOf('`', i + 1);
      out.push(v.slice(i + 1, e === -1 ? v.length : e));
      i = e === -1 ? v.length : e;
    }
  }
  return out;
}

// ------------------------------------------------------------- Befehle je Art

function neueBasis(name, args, ctx) {
  let z = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (/^-(path|literalpath|lp|pspath)$/i.test(a)) { z = args[i + 1] ?? null; break; }
    if (/^\/d$/i.test(a) || a === '--') continue;      // cmd: `cd /d D:\x`
    if (a.startsWith('-') && a !== '-') continue;
    z = a;
    break;
  }
  if (z === null) {
    if (ctx.shell === 'bash' && (name === 'cd' || name === 'pushd')) ctx.base = ctx.home;
    return;
  }
  if (z === '-') return;
  ctx.base = pfad(ctx, z);
}

// Werte-Flags je Fernbefehl — sonst haelt man `-i schluessel` fuer ein Ziel.
const FERN_MIT_WERT = {
  scp: new Set(['-i', '-P', '-o', '-F', '-c', '-l', '-J', '-S']),
  rsync: new Set(['-e', '--rsh', '-f', '--filter', '--exclude', '--include', '--exclude-from',
    '--include-from', '--files-from', '--port', '--chmod', '-T', '--temp-dir', '--log-file']),
  gh: new Set(['-R', '--repo', '-D', '--dir', '-O', '--output', '-p', '--pattern', '-q', '--jq',
    '-t', '--template', '-H', '--header', '-f', '-F', '--field', '--raw-field', '-X', '--method', '--input', '-n', '--name']),
  vercel: new Set(['--token', '--scope', '-t', '-S', '--environment', '--cwd', '-A', '--local-config',
    '-Q', '--global-config', '--git-branch']),
  docker: new Set(['-a', '--archive']),
  podman: new Set([]),
  kubectl: new Set(['-n', '--namespace', '-c', '--container', '--context']),
  ssh: new Set(['-i', '-p', '-o', '-F', '-l', '-J', '-L', '-R', '-D', '-c', '-E', '-S', '-W', '-b', '-e', '-m', '-O', '-Q', '-w']),
};

function fernZiele(name, args, ctx) {
  const mitWert = FERN_MIT_WERT[name] || new Set();
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('-')) { if (mitWert.has(args[i])) i++; continue; }
    pos.push(args[i]);
  }
  // `host:pfad` bzw. `container:pfad` ist entfernt; `C:\x` (ein Buchstabe) nicht.
  // Erst aufloesen: `$H:/opt/x` mit H=root@box ist entfernt — und bleibt es,
  // wenn H erst zur Laufzeit entsteht (`H=$(cat boxhost.txt)`).
  const lokal = (p) => {
    const v = expandiere(p, ctx);
    return !/^(?:[\w.-]+@)?[\w.-]{2,}:/.test(v) && !/^[^/\\:]*\$[^/\\:]*:/.test(v);
  };
  const flag = (...f) => { const k = args.findIndex((a) => f.includes(a)); return k >= 0 ? args[k + 1] : null; };
  if (name === 'scp' || name === 'rsync') {
    const d = pos[pos.length - 1];
    if (pos.length >= 2 && lokal(d)) ziel(ctx, d);
  } else if ((name === 'docker' || name === 'podman' || name === 'kubectl') && pos[0] === 'cp') {
    const d = pos[pos.length - 1];
    if (pos.length >= 3 && lokal(d)) ziel(ctx, d);
  } else if (name === 'vercel') {
    // `vercel env pull` ueberschreibt .env.local — dort liegen die Schluessel des Users.
    if (pos[0] === 'env' && pos[1] === 'pull') ziel(ctx, pos[2] || '.env.local');
    else if (pos[0] === 'pull' || pos[0] === 'link' || pos[0] === 'build') ziel(ctx, '.vercel');
  } else if (name === 'gh') {
    if ((pos[0] === 'run' || pos[0] === 'release') && pos[1] === 'download') {
      ziel(ctx, flag('-D', '--dir', '-O', '--output') || '.');
    } else if (pos[0] === 'repo' && pos[1] === 'clone') {
      ziel(ctx, pos[3] || String(pos[2] || '.').split('/').pop());
    } else if (pos[0] === 'pr' && pos[1] === 'checkout') {
      ziel(ctx, '.');
    }
  }
}

function gitZiele(args, ctx) {
  let i = 0;
  let basis = ctx.base;
  while (i < args.length && args[i].startsWith('-')) {
    if (args[i] === '-C') { basis = pfad(ctx, args[i + 1] || '.'); i += 2; continue; }
    if (args[i] === '-c' || args[i] === '--git-dir' || args[i] === '--work-tree') { i += 2; continue; }
    i++;
  }
  const rest = args.slice(i).join(' ');
  // Nur die Unterbefehle, die Dateien im Baum ueberschreiben oder entfernen.
  // `checkout HEAD -- datei` und `checkout <hash> datei` lagen bis 24.10.2026
  // daneben, nur `checkout -- datei` zaehlte (Korpus-Abgleich: 16 Aufrufe).
  if (/^(checkout(\s+\S+)*\s+--(\s|$)|checkout\s+\.(\s|$)|restore|apply|am(\s|$)|stash\s+(pop|apply)|reset\s+--hard|clean\s+-[a-z]*f|mv\s|rm\s(?!.*--cached))/.test(rest)) {
    ziel(ctx, '.', basis);
  }
}

// PowerShell: Aliase auf die Schreib-Cmdlets (Windows PowerShell 5.1).
const PS_ALIAS = {
  sc: 'set-content', ac: 'add-content', clc: 'clear-content', del: 'remove-item', erase: 'remove-item',
  ri: 'remove-item', rd: 'remove-item', ni: 'new-item', mi: 'move-item', move: 'move-item',
  cpi: 'copy-item', copy: 'copy-item', rni: 'rename-item', ren: 'rename-item', sp: 'set-itemproperty',
  epcsv: 'export-csv',
};
const PS_SCHREIBER = new Set([
  'set-content', 'add-content', 'clear-content', 'out-file', 'new-item', 'set-itemproperty',
  'new-itemproperty', 'remove-itemproperty', 'rename-item', 'set-item', 'clear-item', 'export-csv',
  'export-clixml', 'tee-object', 'set-acl', 'remove-item', 'move-item', 'copy-item',
  'expand-archive', 'compress-archive',
]);
const PS_PFAD = new Set(['path', 'literalpath', 'lp', 'pspath', 'filepath', 'destination', 'destinationpath', 'outfile']);
// Parameter mit Wert, die KEIN Ziel sind. Unbekannte Parameter gelten als
// Schalter: lieber ein Wert zu viel als Ziel (Fehlalarm) als ein Ziel
// verschluckt (Luecke). `-Encoding utf8` lieferte bis 24.10.2026 "utf8" als Ziel.
const PS_MIT_WERT = new Set([
  'value', 'encoding', 'itemtype', 'type', 'filter', 'include', 'exclude', 'credential', 'stream',
  'delimiter', 'width', 'inputobject', 'newname', 'name', 'propertytype', 'erroraction', 'ea',
  'warningaction', 'wa', 'informationaction', 'infa', 'errorvariable', 'ev', 'outvariable', 'ov',
  'outbuffer', 'ob', 'pipelinevariable', 'pv', 'warningvariable', 'wv', 'informationvariable', 'iv',
  'uri', 'method', 'body', 'headers', 'contenttype', 'timeoutsec', 'useragent', 'compressionlevel',
  'sessionvariable', 'websession', 'maximumredirection', 'proxy', 'proxycredential', 'certificate',
  'certificatethumbprint', 'transferencoding', 'infile', 'target', 'aclobject', 'securitydescriptor',
  'variable',
]);

function psZiele(cmdlet, args, ctx) {
  const benannt = [];
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!/^-[A-Za-z]/.test(a)) { pos.push(a); continue; }
    const doppel = a.indexOf(':');
    const name = (doppel === -1 ? a.slice(1) : a.slice(1, doppel)).toLowerCase();
    const nimm = () => (doppel === -1 ? args[++i] : a.slice(doppel + 1));
    if (PS_PFAD.has(name) || (cmdlet === 'new-item' && name === 'name')) { benannt.push({ name, v: nimm() }); continue; }
    if (PS_MIT_WERT.has(name)) { nimm(); continue; }
  }
  const liste = (v) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const dest = benannt.filter((b) => /^(destination|destinationpath|outfile)$/.test(b.name)).flatMap((b) => liste(b.v));
  const quelle = benannt.filter((b) => !/^(destination|destinationpath|outfile)$/.test(b.name)).flatMap((b) => liste(b.v));
  let ziele;
  if (cmdlet === 'copy-item' || cmdlet === 'expand-archive' || cmdlet === 'compress-archive') {
    // Quelle bleibt unberuehrt; Ziel ist -Destination oder die zweite Position.
    ziele = dest.length ? dest : (quelle.length ? pos.slice(0, 1) : pos.slice(1, 2));
    if (!ziele.length && cmdlet !== 'compress-archive') ziele = ['.'];
  } else if (cmdlet === 'move-item' || cmdlet === 'remove-item') {
    ziele = [...quelle, ...dest, ...pos.flatMap(liste)];
  } else {
    ziele = [...quelle, ...dest, ...(quelle.length || dest.length ? [] : pos.slice(0, 1))];
  }
  for (const z of ziele) ziel(ctx, z);
}

function ladeZiele(name, args, ctx) {
  let gesetzt = false;
  const z = (p) => { gesetzt = true; ziel(ctx, p); };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (/^-outfile$/i.test(a)) { z(args[++i]); continue; }   // PowerShell (curl/wget sind dort Aliase)
    if (/^-outfile:/i.test(a)) { z(a.slice(9)); continue; }
    if (name === 'curl') {
      if (a === '-o' || a === '--output') { z(args[++i]); continue; }
      if (a.startsWith('--output=')) { z(a.slice(9)); continue; }
      if (a === '-O' || a === '--remote-name' || a === '--remote-name-all') { z('.'); continue; }
      if (/^-[a-zA-Z]*o$/.test(a)) { z(args[++i]); continue; }
      if (/^-[a-zA-Z]*O[a-zA-Z]*$/.test(a)) { z('.'); continue; }
    } else if (name === 'wget') {
      if (['-O', '--output-document', '-o', '--output-file', '-a', '--append-output', '-P', '--directory-prefix'].includes(a)) { z(args[++i]); continue; }
      const lang = a.match(/^--(?:output-document|output-file|append-output|directory-prefix)=(.*)$/);
      if (lang) { z(lang[1]); continue; }
      if (/^-[a-zA-Z]*O$/.test(a)) { z(args[++i]); continue; }
      const kurz = a.match(/^-[a-zA-Z]*O(.+)$/);
      if (kurz) { z(kurz[1]); continue; }
    }
  }
  // wget ohne Ziel speichert in den Arbeitsordner.
  if (name === 'wget' && !gesetzt) ziel(ctx, '.');
}

function archivZiele(name, args, ctx) {
  if (name === 'unzip') {
    if (args.some((a) => /^-[a-zA-Z]*[lvtz]$/.test(a))) return;   // nur anzeigen/testen
    const k = args.indexOf('-d');
    ziel(ctx, k >= 0 ? args[k + 1] : '.');
    return;
  }
  // tar: Modus steht im ersten Flag-Wort (`-xzf`, `xzf`, `--extract`).
  const modus = args.find((a) => /^-?[A-Za-z]+$/.test(a) && !a.startsWith('--')) || '';
  const lang = (x) => args.includes(x);
  if (/x/.test(modus) || lang('--extract') || lang('--get')) {
    const k = args.indexOf('-C');
    const dir = args.find((a) => a.startsWith('--directory='));
    ziel(ctx, k >= 0 ? args[k + 1] : (dir ? dir.slice(12) : '.'));
  } else if (/[cru]/.test(modus) || lang('--create') || lang('--append') || lang('--update')) {
    const k = args.indexOf(modus);
    const datei = args.find((a) => a.startsWith('--file='));
    if (/f/.test(modus)) ziel(ctx, args[k + 1]);
    else if (datei) ziel(ctx, datei.slice(7));
  }
}

/**
 * Befehl, dessen Argumente erst zur Laufzeit kommen (xargs, find -exec): mit
 * Platzhalter pruefen. Schreibt er auf den Platzhalter, gilt das als Schreiben
 * auf `ersatz` (Arbeitsordner bzw. die Such-Wurzeln).
 */
function unterbefehl(woerter, ctx, ersatz, anhaengen = true) {
  if (ctx.depth >= MAX_TIEFE || !woerter.length) return;
  const sub = { ...ctx, depth: ctx.depth + 1, out: [], vars: { ...ctx.vars } };
  const roh = woerter.map((v) => (v === '{}' ? PLATZHALTER : v));
  if (anhaengen) roh.push(PLATZHALTER);
  befehl(roh.map((v) => ({ v, q: false, q0: false, glob: false })), [], null, sub);
  for (const c of sub.out) {
    if (String(c.path).includes(PLATZHALTER)) for (const e of ersatz) ziel(ctx, e);
    else ctx.out.push(c);
  }
}

function pwshAufruf(args, koerper, ctx) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('-')) { tiefer(ctx, args.slice(i).join(' '), 'pwsh'); return; }   // 5.1: Position = -Command
    const n = a.slice(1).toLowerCase();
    if (n === 'c' || (n.length >= 3 && 'command'.startsWith(n))) {
      const code = args.slice(i + 1).join(' ');
      tiefer(ctx, code === '-' ? koerper : code, 'pwsh');
      return;
    }
    if (n === 'e' || n === 'ec' || (n.length >= 2 && 'encodedcommand'.startsWith(n))) {
      let code = '';
      try { code = Buffer.from(String(args[i + 1] || ''), 'base64').toString('utf16le'); } catch { code = ''; }
      tiefer(ctx, code, 'pwsh');
      return;
    }
    if (n === 'f' || (n.length >= 2 && 'file'.startsWith(n))) {
      tiefer(ctx, lies(ctx, args[i + 1] || ''), 'pwsh');
      return;
    }
    if (['executionpolicy', 'ex', 'ep', 'windowstyle', 'w', 'inputformat', 'outputformat', 'version', 'v',
      'configurationname', 'workingdirectory', 'wd', 'settingsfile'].includes(n)) i++;
  }
  if (koerper != null) tiefer(ctx, koerper, 'pwsh');
}

function codeAufruf(name, args, koerper, ctx) {
  const node = NODEISH.test(name);
  const codeFlags = node ? ['-e', '--eval', '-p', '--print'] : ['-c'];
  const pruefe = (code) => { if (WRITE_CALLS.test(code)) ziel(ctx, '.'); };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const gleich = a.match(/^(--eval|--print)=([\s\S]*)$/);
    if (node && gleich) { pruefe(gleich[2]); return; }
    if (codeFlags.includes(a)) { pruefe(args[i + 1] ?? ''); return; }
  }
  // `node --test <datei>`: der Testlauf schreibt per Konvention nur nach
  // os.tmpdir(), die Testdatei enthaelt aber writeFileSync und wurde dadurch
  // als Projekt-Schreibzugriff gewertet (gemessen 2026-09-01). Dasselbe fuer
  // `node --check`/`-c`: reine Syntaxpruefung, die Datei wird nicht ausgefuehrt.
  if (node && args.some((a) => a === '--test' || a === '--check' || a === '-c')) return;
  const skript = args.find((a) => /\.(mjs|cjs|js|ts|mts|cts|tsx|py)$/i.test(a));
  if (skript) {
    // Namentliche Ausnahme fuer Routine-Ops (User-Entscheidung 2026-09-02):
    // sicher, weil das Skript SELBST weiter gesperrt bleibt.
    if (ROUTINE_OPS.has(toRel(pfad(ctx, skript), ctx.projectDir))) return;
    const body = lies(ctx, skript);
    // Nicht lesbar (Scratchpad, generiert): nicht blocken. Lesbar und
    // schreibend: als Schreibzugriff auf das Projekt werten.
    //
    // Bewusst NICHT gelockert (Review 2026-09-01, architect FAIL): „ein
    // committetes Skript auszufuehren ist harmlos" haelt der Messung nicht
    // stand — `scripts/codemod-accent.mjs --write` schreibt als getracktes
    // Werkzeug in App-Dateien.
    if (body && WRITE_CALLS.test(body) && !onlyTmpWrites(body)) ziel(ctx, '.');
    return;
  }
  // Kein Skript, kein Inline-Code: der Code kommt ueber stdin
  // (`node - <<'EOF'`, `python3 - <<EOF`). Lief bis 24.10.2026 ungeprueft durch.
  if (koerper != null && WRITE_CALLS.test(koerper) && !onlyTmpWrites(koerper)) ziel(ctx, '.');
}

function npmAufruf(name, args, ctx) {
  // Bis 2026-09-01 war dieser Kanal blind: `npm run build:system-map`
  // lieferte [], waehrend das identische `node scripts/build-system-map.mjs`
  // geblockt wurde. Wer das wusste, hatte einen Bypass ohne jede Trickserei.
  if (ctx.depth >= MAX_TIEFE) return;
  const rest = args.filter((w) => w && w !== '--');
  let inner = '';
  if (name === 'npx' || name === 'bunx' || rest[0] === 'exec' || rest[0] === 'dlx') {
    // Der Rest ist ein Kommando. Fuehrende Flags von npx selbst (-y,
    // --yes, --package=x) gehoeren nicht dazu.
    const start = (rest[0] === 'exec' || rest[0] === 'dlx') ? 1 : 0;
    inner = rest.slice(start).join(' ').replace(/^(?:-{1,2}\S+\s+)+/, '');
  } else if ((rest[0] === 'run' || rest[0] === 'run-script') && GENERATED_BUILDS.test(rest[1] || '') && rest.length <= 2) {
    // `npm run build` ohne Zusatzargumente. Mit `--` dahinter faellt die
    // Ausnahme weg: was da angehaengt wird, steht in keinem Script.
    return;
  } else if (GENERATED_BUILDS.test(rest[0] || '') && rest.length === 1) {
    return;                                       // `npm start` (Alias ohne `run`)
  } else if (rest[0] === 'run' || rest[0] === 'run-script') {
    // Zusatzargumente nach `--` haengt npm an den Script-Body an — genau so
    // wird aus dem Pruefer `lint` der Schreiber `eslint --fix`.
    inner = [npmScriptBody(rest[1], ctx.base, ctx.readScript), ...rest.slice(2)].join(' ').trim();
  } else if (rest[0] && !rest[0].startsWith('-')) {
    // Aliase ohne `run`: `npm test`, `npm start`. Echte Unterbefehle
    // (install, ci, publish) stehen nicht in package.json.scripts und
    // finden hier nichts — sie bleiben offen.
    inner = npmScriptBody(rest[0], ctx.base, ctx.readScript);
  }
  if (inner) tiefer(ctx, inner, 'bash');
}

/**
 * Zuweisungen am Anfang eines Abschnitts merken (`S=/tmp/x`, `export S=…`,
 * PowerShell `$s = 'C:\x'`). Liefert die Woerter, die danach als Befehl
 * gelten — bei `$null = New-Item app/x` also `New-Item app/x`.
 */
function zuweisungen(ab, ctx) {
  const v0 = ab[0]?.v || '';
  const ps = v0.match(/^\$(?:env:)?([A-Za-z_]\w*)(=(.*))?$/is);
  if (ps && !ab[0].q0) {
    if (ps[2] !== undefined) { ctx.vars[ps[1]] = expandiere(ps[3], ctx); return ab.slice(1); }
    if (ab[1]?.v === '=') {
      const rest = ab.slice(2);
      if (rest.length === 1 && rest[0].q0) { ctx.vars[ps[1]] = expandiere(rest[0].v, ctx); return []; }
      // `$p = Join-Path $env:TEMP 'x.txt'` — der haeufigste Weg zu einem Temp-Pfad.
      const jp = rest.filter((w) => !w.v.startsWith('-'));
      if (/^join-path$/i.test(rest[0]?.v || '') && jp.length === 3) {
        ctx.vars[ps[1]] = `${expandiere(jp[1].v, ctx)}/${expandiere(jp[2].v, ctx)}`;
        return [];
      }
      ctx.vars[ps[1]] = null;                   // Wert erst zur Laufzeit: nicht aufloesbar
      return rest;
    }
  }
  let i = 0;
  if (v0 === 'export' || v0 === 'declare' || v0 === 'local') i = 1;
  for (; i < ab.length; i++) {
    const m = !ab[i].q0 && !ab[i].op && ab[i].v.match(/^([A-Za-z_]\w*)=([\s\S]*)$/);
    if (!m) break;
    // `T=$(mktemp)`: die Zerlegung trennt an der Klammer, uebrig bleibt `T=$`.
    // Wert unbekannt — dann lieber keiner als ein alter aus der Umgebung.
    ctx.vars[m[1]] = /\$$/.test(m[2]) ? null : expandiere(m[2], ctx);
  }
  return ab;
}

/**
 * Ein Abschnitt (ein Befehl). `stdin` ist der Textblock, der per Pipe ankommt.
 * Rueckgabe: der Textblock, den dieser Befehl weiterreicht (`cat <<EOF | node -`).
 */
function befehl(abRoh, bloecke, stdin, ctx) {
  let koerper = stdin;
  // In einfachen Anfuehrungszeichen ist `$(…)` nur Text (sed-Ausdruecke,
  // JS-Vorlagen in `node -e '…'`) — nur doppelte zaehlen.
  for (const w of abRoh) {
    if (!w.op && w.dq) for (const inner of ersetzungen(w.v, ctx.shell)) tiefer(ctx, inner, ctx.shell, bloecke);
  }
  // Umleitungen und Heredoc-Marken — auch bei Fernbefehlen, denn die macht
  // die lokale Shell.
  for (let i = 0; i < abRoh.length; i++) {
    const w = abRoh[i];
    if (!w.op) continue;
    const n = abRoh[i + 1];
    if (!n || n.op) continue;
    if (/<<<$/.test(w.v)) { koerper = n.v; continue; }
    if (/<<-?$/.test(w.v)) {
      const m = TEXTBLOCK.exec(n.v);
      if (m) koerper = bloecke[Number(m[1])] ?? koerper;
      continue;
    }
    if (w.v.includes('>') && !istVerdopplung(w.v)) ziel(ctx, n.v);
  }

  const ab = zuweisungen(abRoh, ctx);
  let t = befehlsWoerter(ab);
  // PowerShell-Here-String als Argument oder als Quelle einer Pipe.
  const marken = t.filter((w) => TEXTBLOCK.test(w.v));
  if (marken.length) {
    if (koerper == null) koerper = marken.map((w) => bloecke[Number(TEXTBLOCK.exec(w.v)[1])] ?? '').join('\n');
    t = t.filter((w) => !TEXTBLOCK.test(w.v));
  }
  if (!t.length) return koerper;

  const name = befehlsName(t[0].v);
  const args = t.slice(1).map((w) => w.v);
  const ps = PS_ALIAS[name] || (PS_SCHREIBER.has(name) ? name : null);

  if (REMOTE.has(name)) fernZiele(name, args, ctx);
  else if (CD.has(name)) neueBasis(name, args, ctx);
  else if (/^(cat|type|write-output|echo)$/.test(name)) {
    // Reicht einen Textblock weiter (`cat <<'EOF' | node -`).
    return args.length && name !== 'echo' ? null : koerper;
  } else if (/^(sed|perl)$/.test(name) && args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place'))) {
    // Das erste Nicht-Options-Argument ist der Ausdruck (`s/a/b/`), nicht die
    // Datei — ohne diese Unterscheidung wird `s/a/b` als Pfad geblockt.
    for (const a of args.filter((x) => !x.startsWith('-')).slice(1)) ziel(ctx, a);
  } else if (/^(cp|mv|ln|install)$/.test(name)) {
    const k = args.findIndex((a) => a === '-t' || a === '--target-directory');
    const pos = args.filter((a) => !a.startsWith('-'));
    if (k >= 0) ziel(ctx, args[k + 1]);
    else if (name === 'mv') pos.forEach((a) => ziel(ctx, a));   // die Quelle verschwindet auch
    else ziel(ctx, pos[pos.length - 1]);
  } else if (/^(rm|rmdir|unlink|touch|mkdir|md|truncate|tee|shred)$/.test(name)) {
    for (let i = 0; i < args.length; i++) {
      if (name === 'truncate' && (args[i] === '-s' || args[i] === '-r')) { i++; continue; }
      if (!args[i].startsWith('-')) ziel(ctx, args[i]);
    }
  } else if (/^(chmod|chown|chgrp)$/.test(name)) {
    for (const a of args.filter((x) => !x.startsWith('-')).slice(1)) ziel(ctx, a);
  } else if (name === 'dd') {
    for (const a of args) if (a.startsWith('of=') && a.length > 3) ziel(ctx, a.slice(3));
  } else if (/^g?awk$/.test(name) && args.includes('-i') && args.includes('inplace')) {
    // Wie bei sed: das erste Nicht-Options-Argument ist das Programm.
    for (const a of args.filter((x) => !x.startsWith('-') && x !== 'inplace').slice(1)) ziel(ctx, a);
  } else if (name === 'git') gitZiele(args, ctx);
  else if (ps) psZiele(ps, args, ctx);
  else if (/^(curl|wget|invoke-webrequest|iwr|invoke-restmethod|irm)$/.test(name)) ladeZiele(name, args, ctx);
  else if (name === 'tar' || name === 'unzip') archivZiele(name, args, ctx);
  else if (name === 'patch') ziel(ctx, '.');
  else if (/^(npm|pnpm|yarn|npx|bunx)$/.test(name)) npmAufruf(name, args, ctx);
  else if (FORMATTER.test(name)) {
    // `eslint --fix` / `prettier --write` schreiben den Baum um.
    if (args.some((a) => a === '--fix' || a === '--write')) ziel(ctx, '.');
  } else if (name === 'xargs') {
    let i = 0;
    let ersetzen = false;
    while (i < args.length && args[i].startsWith('-')) {
      if (/^-(I|i|-replace)/.test(args[i])) ersetzen = true;
      if (/^-(n|P|L|s|d|E|a|I)$/.test(args[i])) i++;
      i++;
    }
    unterbefehl(args.slice(i), ctx, ['.'], !ersetzen);
  } else if (name === 'find') {
    let i = 0;
    const wurzeln = [];
    while (i < args.length && !/^[-(!]/.test(args[i])) wurzeln.push(args[i++]);
    if (!wurzeln.length) wurzeln.push('.');
    if (args.includes('-delete')) wurzeln.forEach((w) => ziel(ctx, w));
    for (let k = i; k < args.length; k++) {
      if (!/^-(exec|execdir|ok|okdir)$/.test(args[k])) continue;
      let e = k + 1;
      while (e < args.length && args[e] !== ';' && args[e] !== '+') e++;
      unterbefehl(args.slice(k + 1, e), ctx, wurzeln, false);
      k = e;
    }
  } else if (/^(eval|invoke-expression|iex)$/.test(name)) tiefer(ctx, args.join(' '));
  else if (name === 'cmd') {
    // `cmd /c "…"`: & trennt, " quotet — der PowerShell-Zerlegung am naechsten.
    const k = args.findIndex((a) => /^\/[ck]$/i.test(a));
    if (k >= 0) tiefer(ctx, args.slice(k + 1).join(' '), 'pwsh');
  } else if (PWSH.test(name)) pwshAufruf(args, koerper, ctx);
  else if (SHELLS.test(name)) {
    // `bash -c "…"` / `sh -lc '…'` / `bash skript.sh` / `bash -s <<EOF`:
    // der ausgefuehrte Text wird selbst geprueft (inline-shell-unerkannt).
    const k = args.findIndex((a) => /^-[a-zA-Z]*c$/.test(a));
    if (k >= 0) tiefer(ctx, args[k + 1] || '', 'bash');
    else {
      const skript = args.find((a) => !a.startsWith('-'));
      if (skript) tiefer(ctx, skriptText(ctx, skript), 'bash');
      else if (koerper != null) tiefer(ctx, koerper, 'bash');
    }
  } else if (NODEISH.test(name) || PYTHON.test(name)) codeAufruf(name, args, koerper, ctx);
  else if (name === 'source' || name === '.') tiefer(ctx, skriptText(ctx, args[0] || ''), ctx.shell);
  else if (/\.(sh|ps1|bat|cmd)$/i.test(t[0].v)) {
    tiefer(ctx, skriptText(ctx, t[0].v), /\.sh$/i.test(t[0].v) ? 'bash' : 'pwsh');
  }
  return null;
}

function durchlauf(abschnitte, bloecke, ctx) {
  let stdin = null;
  let dotnet = false;
  for (const ab of abschnitte) {
    if (dotnet) {
      ziel(ctx, (ab.find((w) => !w.op)?.v || '.').replace(/,$/, ''));
      dotnet = false;
      continue;
    }
    if (!ab.pipe) stdin = null;
    stdin = befehl(ab, bloecke, stdin, ctx);
    if (DOTNET.test(ab[ab.length - 1]?.v || '')) dotnet = true;
  }
  if (dotnet) ziel(ctx, '.');
}

function analysiere(text, ctx, erbe = []) {
  const { text: flach, bloecke } = textbloecke(text, ctx.shell, erbe);
  const abschnitte = zerlege(flach, ctx.shell);
  const start = { base: ctx.base, vars: { ...ctx.vars } };
  durchlauf(abschnitte, bloecke, ctx);
  // Nie geschlossenes Anfuehrungszeichen: die Zerlegung kann Befehle als Text
  // verschluckt haben. Dann zusaetzlich ohne Anfuehrungszeichen zerlegen —
  // mehr Treffer, nie weniger.
  if (abschnitte.offen) {
    ctx.base = start.base;
    ctx.vars = start.vars;
    durchlauf(zerlege(flach.replace(/["'`]/g, ' '), ctx.shell), bloecke, ctx);
  }
}

/**
 * Liefert [{ path, base }] — Kandidaten fuer geschriebene Dateien, jeweils mit
 * dem Arbeitsordner, gegen den `path` aufzuloesen ist.
 *
 * Seit Runde 10 (24.10.2026) auf der gemeinsamen Zerlegung aus shell-words.mjs:
 * Trenner und Umleitungen zaehlen nur ausserhalb von Anfuehrungszeichen,
 * Textbloecke sind Daten oder Code je nach Empfaenger, Pipes werden verfolgt,
 * Variablen aufgeloest. Grundsatz bleibt: im Zweifel ein Ziel zu viel (der User
 * sieht einen Hinweis) statt eines zu wenig.
 *
 * `readScript` erlaubt es dem Test, Skript-Inhalte zu stellen.
 * `opts.base` = Arbeitsordner des Befehls (Hook-Input `cwd`), `opts.shell` =
 * 'bash' | 'pwsh', `opts.env`/`opts.home` fuer Tests.
 */
export function pathsWrittenByShell(cmd, projectDir, readScript = readFileSync, depth = 0, opts = {}) {
  const out = [];
  if (!cmd) return out;
  const env = opts.env || process.env;
  const ctx = {
    projectDir,
    readScript,
    depth,
    out,
    env,
    shell: opts.shell === 'pwsh' ? 'pwsh' : 'bash',
    base: opts.base ? resolve(toNativePath(String(opts.base))) : projectDir,
    vars: { ...(opts.vars || {}) },
    home: opts.home || env.USERPROFILE || env.HOME || homedir(),
    tmp: opts.tmp || tmpdir(),
  };
  analysiere(String(cmd), ctx);
  return out;
}

// ------------------------------------------------------------------- Deny-Text

export function denyText(what, reason, planExists) {
  return `Schreiben auf ${what} ohne freigegebenen Plan blockiert (${reason}).

So kommst du weiter — in dieser Reihenfolge, ohne Abkuerzung:
1. Schreib den Plan nach .claude/plan-current.md${planExists ? ' (existiert bereits — ueberschreiben)' : ''}:
   Ziel in einem Satz · betroffene Dateien · >=3 Alternativen mit Trade-offs ·
   gewaehlte Option mit Begruendung · wie du das Ergebnis pruefst.
2. Spawne die passenden Review-Agents (AGENTS.md) und schreib ihre Verdicts
   unter eine Ueberschrift "## Verdicts" in denselben Plan — eine Zeile pro
   Agent, beginnend mit "- " oder in einer Tabelle. Ohne diesen Block oeffnet
   das Gate auch MIT Freigabe nicht.
3. Zeig dem User den Kern des Plans (kurz) und WARTE auf Freigabe.
4. Der User gibt frei mit: go / ok / passt / freigabe / los.
   Erst dann oeffnet dieses Gate — automatisch, du musst nichts weiter tun.

Trivial-Ausweg (nur wenn es wirklich zutrifft): der User schreibt "trivial"
oder "spot-fix" in seinen Prompt. Das entscheidest NICHT du.

Notausgang, falls dieses Gate selbst kaputt ist: WRITE_GATE=0 in der Umgebung.`;
}
