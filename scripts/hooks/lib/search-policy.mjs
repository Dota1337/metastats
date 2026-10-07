// Suchsperre: erkennt Shell-Suchen, die durch node_modules, einen ganzen
// Laufwerks- oder Benutzerordner laufen, und grep-Muster mit riesigen
// Wiederholungen. Erster Schritt in write-gate.mjs, vor der Plan-Pruefung.
//
// Warum: Am 07.10.2026 musste der User eine Sitzung abbrechen, weil grep.exe
// und Python beim Spielen die CPU belegten. Die Befehle aus dem Protokoll waren
// `grep -rln … .` vom Projektordner (durch node_modules), `find .` mit
// `-not -path` in einem Ordner mit node_modules und `grep -o '…\{0,3000\}'`
// ueber ein grosses Sitzungsprotokoll. Nach dem Zeitlimit laufen solche
// Prozesse unter Windows als Waisen weiter — die Sperre verhindert den Start.
//
// Wie plan-gate/gate-policy: reine Funktion, kein stdin, kein process.exit.
// Bewusste Luecken (faengt der Prozess-Waechter ueber Prioritaet ab):
// `bash -c "…"`, `xargs`, `findstr /s`, `ls -R`, `$(…)` in Anfuehrungszeichen,
// `node -e` mit Unterprozess.

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { toNativePath } from './gate-policy.mjs';

/** Groesste erlaubte Zahl in einer Wiederholung `{n,m}` bzw. `\{n,m\}`. */
export const WIEDERHOLUNG_MAX = 100;

/** Befehle, deren Argumente woanders laufen oder keine Dateisuche sind. */
const FREMD = new Set(['ssh', 'scp', 'rsync', 'docker', 'kubectl', 'vercel', 'gh', 'git']);

/** Vorsaetze, nach denen erst der eigentliche Befehl kommt. */
const VORSATZ = new Set([
  'time', 'command', 'exec', 'builtin', 'nohup', 'sudo', 'then', 'do', 'else',
  'elif', 'if', 'while', 'until', '!', '{', '}',
]);

const GREP_LANG_MIT_WERT = new Set([
  '--regexp', '--file', '--include', '--exclude', '--exclude-dir', '--exclude-from',
  '--directories', '--devices', '--context', '--after-context', '--before-context',
  '--max-count', '--label', '--binary-files', '--group-separator',
]);

const DU_MIT_WERT = new Set(['-d', '-B', '-t', '-X', '--exclude', '--max-depth',
  '--threshold', '--block-size', '--time-style', '--files0-from']);

const GCI_MIT_WERT = ['path', 'literalpath', 'pspath', 'lp', 'filter', 'include',
  'exclude', 'attributes', 'depth', 'erroraction', 'ea', 'warningaction', 'wa',
  'outvariable', 'ov', 'errorvariable', 'ev', 'pipelinevariable', 'pv'];

// ------------------------------------------------------------------ Zerlegen

/** Heredoc-Inhalte entfernen — ein Commit-Text mit „grep -r“ ist keine Suche. */
function ohneHeredocs(cmd) {
  const aus = [];
  const offen = [];
  for (const zeile of cmd.split('\n')) {
    if (offen.length) {
      if (zeile.replace(/\r$/, '').trim() === offen[0]) offen.shift();
      continue;
    }
    aus.push(zeile);
    const re = /(?<!<)<<-?(?!<)\s*(['"]?)([A-Za-z_][\w-]*)\1/g;
    let m;
    while ((m = re.exec(zeile))) offen.push(m[2]);
  }
  return aus.join('\n');
}

/** PowerShell-Here-Strings `@'…'@` / `@"…"@` entfernen. */
function ohneHereStrings(cmd) {
  return cmd.replace(/@(['"])\r?\n[\s\S]*?\r?\n\1@/g, "''");
}

/**
 * Zerlegt eine Kommandozeile in Abschnitte (an `; | & ( ) \n` usw.) und jeden
 * Abschnitt in Woerter `{ v, q, q0, glob }`: v = Wert ohne Anfuehrungszeichen,
 * q = irgendein Teil stand in Anfuehrungszeichen, q0 = das erste Zeichen,
 * glob = ein unmaskiertes `* ? [` kam vor.
 */
function zerlege(cmd, shell) {
  const pwsh = shell === 'pwsh';
  const esc = pwsh ? '`' : '\\';
  const trenner = pwsh ? '\n;|&(){}' : '\n;|&()`';
  const abschnitte = [];
  let woerter = [];
  let w = null;
  const neu = (quoted) => { w ??= { v: '', q: false, q0: quoted, glob: false }; };
  const zeichen = (c, quoted) => {
    neu(quoted);
    w.v += c;
    if (quoted) w.q = true;
    else if (c === '*' || c === '?' || c === '[') w.glob = true;
  };
  const wortEnde = () => { if (w) { woerter.push(w); w = null; } };
  const abschnittEnde = () => { wortEnde(); if (woerter.length) abschnitte.push(woerter); woerter = []; };

  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (c === esc) {
      const n = cmd[i + 1];
      if (n === undefined) continue;
      i++;
      if (n === '\n' || (n === '\r' && cmd[i + 1] === '\n')) { if (n === '\r') i++; continue; }
      zeichen(n, true);
      continue;
    }
    if (c === "'") {
      const ende = cmd.indexOf("'", i + 1);
      const stop = ende === -1 ? cmd.length : ende;
      neu(true);
      w.q = true;
      w.v += cmd.slice(i + 1, stop);
      i = stop;
      continue;
    }
    if (c === '"') {
      neu(true);
      w.q = true;
      let j = i + 1;
      while (j < cmd.length && cmd[j] !== '"') {
        if (cmd[j] === esc && j + 1 < cmd.length) {
          // bash: in "…" maskiert \ nur $ ` " \ und Zeilenumbruch.
          if (pwsh || '$`"\\\n'.includes(cmd[j + 1])) { w.v += cmd[j + 1]; j += 2; continue; }
        }
        w.v += cmd[j];
        j++;
      }
      i = j;
      continue;
    }
    if (c === '\r') continue;
    if (c === ' ' || c === '\t') { wortEnde(); continue; }
    if (trenner.includes(c)) {
      // `2>&1`, `&>`, `>&2` sind Umleitungen, keine Trenner.
      if (c === '&' && (cmd[i - 1] === '>' || cmd[i - 1] === '<' || cmd[i + 1] === '>')) {
        zeichen(c, false);
        continue;
      }
      abschnittEnde();
      continue;
    }
    zeichen(c, false);
  }
  abschnittEnde();
  return abschnitte;
}

/** Umleitungen entfernen, Vorsaetze ueberspringen. Liefert die Woerter ab dem Befehl. */
function befehlsWoerter(woerter) {
  const t = [];
  for (let i = 0; i < woerter.length; i++) {
    const w = woerter[i];
    const m = !w.q0 && w.v.match(/^(\d*|&)(>>?|<<?<?|>&|<&|>\|)(.*)$/s);
    if (m) {
      if (m[3] === '') i++;
      continue;
    }
    t.push(w);
  }
  let i = 0;
  while (i < t.length) {
    const v = t[i].v;
    if (!t[i].q0 && /^[A-Za-z_]\w*=/.test(v)) { i++; continue; }
    if (VORSATZ.has(v)) { i++; continue; }
    if (v === 'env' || v === 'stdbuf') {
      i++;
      while (i < t.length && (t[i].v.startsWith('-') || /^[A-Za-z_]\w*=/.test(t[i].v))) {
        if (t[i].v === '-u' || t[i].v === '-C') i++;
        i++;
      }
      continue;
    }
    if (v === 'nice') {
      i++;
      if (t[i]?.v === '-n') i += 2;
      else if (/^(-n?-?\d+|--adjustment=.*)$/.test(t[i]?.v || '')) i++;
      continue;
    }
    if (v === 'timeout') {
      i++;
      while (i < t.length && t[i].v.startsWith('-')) {
        if (t[i].v === '-s' || t[i].v === '-k') i++;
        i++;
      }
      i++; // Dauer
      continue;
    }
    break;
  }
  return t.slice(i);
}

function befehlsName(v) {
  return v.split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');
}

// ------------------------------------------------------------------ Pfade

function kontext(cwd, opts) {
  const platform = opts.platform || process.platform;
  const p = platform === 'win32' ? path.win32 : path.posix;
  const home = opts.home ?? homedir();
  const norm = (x) => x.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const exists = opts.exists || existsSync;
  const kinder = opts.kinder || ((dir) => {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory()).slice(0, 500).map((d) => d.name);
    } catch { return []; }
  });
  return {
    platform, p, home, norm, exists, kinder,
    projektN: opts.projectDir ? norm(p.resolve(toNativePath(opts.projectDir, platform))) : '',
    homeN: home ? norm(p.resolve(home)) : '',
    cwd: cwd ? p.resolve(toNativePath(cwd, platform)) : null,
  };
}

/** Wort → absoluter Pfad, oder null, wenn er sich nicht bestimmen laesst. */
function absolut(v, basis, ctx, shell) {
  let x = v;
  if (x === '~' || /^~[\\/]/.test(x)) x = ctx.home + x.slice(1);
  else if (/^\$(\{HOME\}|HOME)(?=$|[\\/])/.test(x)) x = x.replace(/^\$(\{HOME\}|HOME)/, ctx.home);
  else if (/^\$env:(USERPROFILE|HOME)(?=$|[\\/])/i.test(x)) x = x.replace(/^\$env:\w+/i, ctx.home);
  if (x.includes('$')) return null;
  if (shell === 'bash') x = toNativePath(x, ctx.platform);
  if (ctx.p.isAbsolute(x)) return ctx.p.resolve(x);
  if (!basis) return null;
  return ctx.p.resolve(basis, x);
}

/**
 * Ist ein Suchziel gefaehrlich? Liefert den Grund oder null.
 * tief: auch „enthaelt node_modules direkt oder eine Ebene darunter“ zaehlt
 * (grep/find/gci). du ist reine Groessenabfrage und prueft nur die harten Ziele.
 */
function gefahr(abs, ctx, tief) {
  const n = ctx.norm(abs);
  if (n === '' || /^[a-z]:$/.test(n)) return { art: 'wurzel', text: 'ganzes Laufwerk' };
  for (const [d, name] of [[ctx.projektN, 'Projektordner'], [ctx.homeN, 'Benutzerordner']]) {
    if (!d) continue;
    if (n === d) return { art: d === ctx.projektN ? 'projekt' : 'home', text: `den ${name}` };
    if (d.startsWith(n + '/')) return { art: 'wurzel', text: `einen Oberordner vom ${name}` };
  }
  if (n.split('/').pop() === 'node_modules') return { art: 'nm', text: 'node_modules' };
  if (!tief) return null;
  if (ctx.exists(ctx.p.join(abs, 'node_modules'))) return { art: 'hatnm', text: 'einen Ordner mit node_modules' };
  for (const k of ctx.kinder(abs)) {
    if (k === 'node_modules' || k === '.git') continue;
    if (ctx.exists(ctx.p.join(abs, k, 'node_modules'))) {
      return { art: 'hatnm', text: `einen Ordner mit node_modules darunter (${k})` };
    }
  }
  return null;
}

/** Glob-Muster eines Pfadteils als RegExp. */
function globRe(teil) {
  const s = teil.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  try { return new RegExp(`^${s}$`, 'i'); } catch { return null; }
}

/** Ziel-Wort pruefen (mit Glob-Behandlung). */
function zielGefahr(w, basis, ctx, shell, tief) {
  if (!w.glob) {
    const abs = absolut(w.v, basis, ctx, shell);
    return abs ? gefahr(abs, ctx, tief) : null;
  }
  // `*`, `apps/*`, `/c/*`: fester Teil vor dem ersten Platzhalter + erstes Glob-Stueck.
  const erst = w.v.search(/[*?[]/);
  const schnitt = w.v.slice(0, erst).replace(/[^\\/]*$/, '');
  const stueck = w.v.slice(schnitt.length).split(/[\\/]/)[0];
  const abs = absolut(schnitt || '.', basis, ctx, shell);
  if (!abs) return null;
  const re = globRe(stueck);
  if (re?.test('node_modules') && ctx.exists(ctx.p.join(abs, 'node_modules'))) {
    return { art: 'glob', text: `einen Platzhalter, der node_modules trifft (${w.v})` };
  }
  const g = gefahr(abs, ctx, false);
  if (g && /^(wurzel|home)$/.test(g.art) && /^\*+$/.test(stueck)) {
    return { art: 'wurzel', text: `einen Platzhalter ueber ${g.text} (${w.v})` };
  }
  return null;
}

// ------------------------------------------------------------------ Befehle

function grosseWiederholung(muster, modus) {
  const re = modus === 'G'
    ? /\\\{(\d*)(?:,(\d*))?\\\}/g
    : /(?<!\\)\{(\d*)(?:,(\d*))?\}/g;
  for (const m of String(muster).matchAll(re)) {
    if (Number(m[1] || 0) > WIEDERHOLUNG_MAX || Number(m[2] || 0) > WIEDERHOLUNG_MAX) return m[0];
  }
  return null;
}

function pruefeGrep(name, args, basis, ctx, shell) {
  let rekursiv = name === 'rgrep';
  let modus = name === 'egrep' ? 'E' : name === 'fgrep' ? 'F' : 'G';
  const muster = [];
  let musterPerOption = false;
  let ohneNm = false;
  const pos = [];
  let nurPos = false;
  for (let i = 0; i < args.length; i++) {
    const v = args[i].v;
    if (nurPos || v === '-' || !v.startsWith('-')) { pos.push(args[i]); continue; }
    if (v === '--') { nurPos = true; continue; }
    if (v.startsWith('--')) {
      const gl = v.indexOf('=');
      const opt = gl === -1 ? v : v.slice(0, gl);
      let wert = gl === -1 ? undefined : v.slice(gl + 1);
      if (wert === undefined && GREP_LANG_MIT_WERT.has(opt)) wert = args[++i]?.v;
      if (opt === '--recursive' || opt === '--dereference-recursive') rekursiv = true;
      else if (opt === '--directories' && wert === 'recurse') rekursiv = true;
      else if (opt === '--fixed-strings') modus = 'F';
      else if (opt === '--extended-regexp') modus = 'E';
      else if (opt === '--perl-regexp') modus = 'P';
      else if (opt === '--basic-regexp') modus = 'G';
      else if (opt === '--regexp') { muster.push(wert); musterPerOption = true; }
      else if (opt === '--file') musterPerOption = true;
      else if (opt === '--exclude-dir' && /node_modules/.test(wert || '')) ohneNm = true;
      continue;
    }
    for (let k = 1; k < v.length; k++) {
      const c = v[k];
      if ('efmABCdD'.includes(c)) {
        const rest = v.slice(k + 1);
        const wert = rest !== '' ? rest : args[++i]?.v;
        if (c === 'e') { muster.push(wert); musterPerOption = true; }
        if (c === 'f') musterPerOption = true;
        if (c === 'd' && wert === 'recurse') rekursiv = true;
        break;
      }
      if (c === 'r' || c === 'R') rekursiv = true;
      else if (c === 'F' || c === 'E' || c === 'P' || c === 'G') modus = c;
    }
  }
  if (!musterPerOption && pos.length) muster.push(pos.shift().v);

  if (modus !== 'F') {
    for (const m of muster) {
      const treffer = grosseWiederholung(m, modus);
      if (treffer) {
        return `grep-Muster mit riesiger Wiederholung ${treffer} (mehr als ${WIEDERHOLUNG_MAX}) — wird auf grossen Dateien extrem langsam`;
      }
    }
  }
  if (!rekursiv || ohneNm) return null;
  const ziele = pos.length ? pos : [{ v: '.', q: false, glob: false }];
  for (const z of ziele) {
    const g = zielGefahr(z, basis, ctx, shell, true);
    if (g) return `rekursives grep ueber ${g.text}, ohne --exclude-dir=node_modules`;
  }
  return null;
}

function pruefeFind(args, basis, ctx, shell) {
  let i = 0;
  while (i < args.length && /^-([HLP]|D.*|O\d*)$/.test(args[i].v)) i++;
  const pfade = [];
  while (i < args.length && !/^[-(!]/.test(args[i].v)) pfade.push(args[i++]);
  const ausdruck = args.slice(i).map((w) => w.v);
  const md = ausdruck.indexOf('-maxdepth');
  if (md !== -1 && Number(ausdruck[md + 1]) <= 2) return null;
  const prune = ausdruck.includes('-prune') && ausdruck.some((v) => /node_modules/.test(v));
  if (!pfade.length) pfade.push({ v: '.', q: false, glob: false });
  for (const z of pfade) {
    const g = zielGefahr(z, basis, ctx, shell, true);
    if (!g) continue;
    if (prune && /^(projekt|hatnm|glob)$/.test(g.art)) continue;
    return `find ueber ${g.text}, ohne -maxdepth 2 oder -prune auf node_modules (-not -path schuetzt nicht, find laeuft trotzdem hinein)`;
  }
  return null;
}

function pruefeDu(args, basis, ctx, shell) {
  const ziele = [];
  for (let i = 0; i < args.length; i++) {
    const v = args[i].v;
    if (v.startsWith('-') && v !== '-') {
      if (DU_MIT_WERT.has(v)) i++;
      else if (/^-[a-zA-Z]*[dBtX]$/.test(v) && !v.startsWith('--')) i++;
      continue;
    }
    ziele.push(args[i]);
  }
  if (!ziele.length) ziele.push({ v: '.', q: false, glob: false });
  for (const z of ziele) {
    const g = zielGefahr(z, basis, ctx, shell, false);
    if (g) return `du ueber ${g.text}`;
  }
  return null;
}

function pruefeGci(args, basis, ctx, shell) {
  let rekursiv = false;
  let tiefe = null;
  const ziele = [];
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    const v = args[i].v;
    if (!v.startsWith('-') || v.length < 2 || args[i].q0) { pos.push(args[i]); continue; }
    const doppel = v.indexOf(':');
    const name = (doppel === -1 ? v.slice(1) : v.slice(1, doppel)).toLowerCase();
    const angehaengt = doppel === -1 ? undefined : v.slice(doppel + 1);
    if ('recurse'.startsWith(name)) {
      rekursiv = !/^\$?false$/i.test(angehaengt ?? '');
      continue;
    }
    const mitWert = name.length >= 2 && GCI_MIT_WERT.find((p) => p.startsWith(name));
    if (!mitWert) continue;
    const wert = angehaengt !== undefined ? args[i] && { ...args[i], v: angehaengt } : args[++i];
    if (!wert) continue;
    if (mitWert === 'depth') { tiefe = Number(wert.v); continue; }
    if (/^(path|literalpath|pspath|lp)$/.test(mitWert)) ziele.push(...kommaListe(wert));
  }
  if (!ziele.length && pos.length) ziele.push(...kommaListe(pos[0]));
  if (tiefe !== null) { if (tiefe <= 2) return null; rekursiv = true; }
  if (!rekursiv) return null;
  if (!ziele.length) ziele.push({ v: '.', q: false, glob: false });
  for (const z of ziele) {
    const g = zielGefahr(z, basis, ctx, shell, true);
    if (g) return `Get-ChildItem -Recurse ueber ${g.text} (-Exclude schuetzt nicht, der Ordner wird trotzdem durchlaufen)`;
  }
  return null;
}

function kommaListe(w) {
  return w.v.split(',').filter(Boolean).map((v) => ({ ...w, v: v.trim(), glob: w.glob && /[*?[]/.test(v) }));
}

/** Ziel eines cd/Set-Location → neue Basis (null = unbekannt). */
function cdZiel(name, args, basis, ctx, shell) {
  let ziel = null;
  for (let i = 0; i < args.length; i++) {
    const v = args[i].v;
    if (shell === 'pwsh' && /^-(path|literalpath|lp|pspath)$/i.test(v)) { ziel = args[i + 1]?.v ?? null; break; }
    if (v.startsWith('-') && v !== '-') continue;
    ziel = v;
    break;
  }
  if (ziel === null) return shell === 'bash' && /^(cd|pushd)$/.test(name) ? ctx.home : basis;
  if (ziel === '-') return null;
  return absolut(ziel, basis, ctx, shell);
}

const CD = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl', 'push-location']);

// ------------------------------------------------------------------ Einstieg

/**
 * Prueft einen Shell-Befehl. Liefert `{ grund, abschnitt }` oder null.
 *
 * @param {string} toolName  `Bash` oder `PowerShell`; alles andere → null
 * @param {string} command   die Kommandozeile
 * @param {string} cwd       Arbeitsordner des Befehls (Hook-Input `cwd`)
 * @param {object} opts      projectDir, home, platform, exists, kinder (Tests)
 */
export function checkSearch(toolName, command, cwd, opts = {}) {
  const shell = /^bash$/i.test(toolName || '') ? 'bash' : /^powershell$/i.test(toolName || '') ? 'pwsh' : null;
  if (!shell || typeof command !== 'string' || !command) return null;
  const ctx = kontext(cwd || opts.projectDir, opts);
  const text = shell === 'pwsh' ? ohneHereStrings(command) : ohneHeredocs(command);
  let basis = ctx.cwd;

  for (const woerter of zerlege(text, shell)) {
    const t = befehlsWoerter(woerter);
    if (!t.length) continue;
    const name = befehlsName(t[0].v);
    const args = t.slice(1);
    if (FREMD.has(name)) continue;
    if (CD.has(name)) { basis = cdZiel(name, args, basis, ctx, shell); continue; }

    let grund = null;
    if (/^(grep|egrep|fgrep|rgrep)$/.test(name)) grund = pruefeGrep(name, args, basis, ctx, shell);
    else if (shell === 'bash' && name === 'find') grund = pruefeFind(args, basis, ctx, shell);
    else if (shell === 'bash' && name === 'du') grund = pruefeDu(args, basis, ctx, shell);
    else if (shell === 'pwsh' && /^(get-childitem|gci|ls|dir)$/.test(name)) grund = pruefeGci(args, basis, ctx, shell);
    if (grund) {
      const abschnitt = t.map((w) => w.v).join(' ');
      return { grund, abschnitt: abschnitt.length > 200 ? `${abschnitt.slice(0, 200)}…` : abschnitt };
    }
  }
  return null;
}

/** Ablehnungstext fuer den Hook. */
export function searchDenyText(v) {
  return [
    `Suchsperre: ${v.grund}.`,
    `Befehl: ${v.abschnitt}`,
    'Warum gesperrt: Solche Suchen laufen durch node_modules, ein ganzes Laufwerk oder ein grosses Protokoll. Reisst der Befehl das Zeitlimit, laeuft der Prozess unter Windows als Waise weiter und bremst das Spiel des Users (Vorfall 07.10.2026).',
    'Stattdessen: das Grep- oder Glob-Tool (beachtet .gitignore, endet sauber), ein gezielter Unterordner, --exclude-dir=node_modules, find -maxdepth 2 oder -prune auf node_modules. Grosse Dateien mit node zeilenweise auswerten statt grep-Muster mit {0,3000}.',
    'Notschalter nur auf Anweisung des Users: Umgebungsvariable SEARCH_GATE=0 fuer die Claude-Sitzung.',
  ].join('\n');
}
