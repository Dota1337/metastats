// Gemeinsame Zerlegung von Shell-Zeilen fuer Such- und Schreibsperre.
//
// Bis Runde 10 (24.10.2026) gab es zwei: search-policy.mjs zerlegte
// anfuehrungszeichen- und shell-bewusst, gate-policy.mjs grob an Trennern auch
// INNERHALB von Anfuehrungszeichen. Gemessen am selben Tag: `ssh box "cd /opt/x
// && echo a > scripts/y"` blockte als lokales Schreiben, ein Commit-Text mit
// `a | tee app/x.ts` ebenso — waehrend `node - <<'EOF' … writeFileSync` und
// `Get-Content x | Set-Content app/y.ts` durchliefen (logic-flow-critic).
// Eine Zerlegung fuer beide, getestet in beiden Suiten.
//
// Reine Funktionen: kein Dateizugriff, kein Import aus den Policies.

/**
 * Git-Bash-Schreibweise eines Laufwerkspfads in die Windows-Form: `/d/x` ->
 * `D:/x`. Ohne das liest `resolve()` `/d/Metastats/metastats` als Ordner `d`
 * auf dem aktuellen Laufwerk — `cd /d/Metastats/metastats && rm app/x.ts`
 * landete so bei `../../d/Metastats/metastats/app/x.ts` und galt als
 * "ausserhalb des Projekts" (logic-flow-critic, 07.10.2026). `/dev/null`,
 * `/tmp/x` und andere echte POSIX-Pfade bleiben unberuehrt, weil nach dem
 * Buchstaben ein Schraegstrich oder das Ende stehen muss.
 */
export function toNativePath(p, platform = process.platform) {
  if (platform !== 'win32' || typeof p !== 'string') return p;
  const m = p.match(/^\/([a-zA-Z])(\/|$)(.*)$/s);
  return m ? `${m[1].toUpperCase()}:/${m[3]}` : p;
}

/** Marke, die an die Stelle eines Textblocks tritt. */
export const TEXTBLOCK = /^__TEXTBLOCK_(\d+)__$/;

/** Vorsaetze, nach denen erst der eigentliche Befehl kommt. */
const VORSATZ = new Set([
  'time', 'command', 'exec', 'builtin', 'nohup', 'sudo', 'winpty', 'then', 'do', 'else',
  'elif', 'if', 'while', 'until', '!', '{', '}',
]);

/**
 * Textbloecke abtrennen: bash-Heredocs (`<<'EOF'` … `EOF`) bzw. PowerShell-
 * Here-Strings (`@'` … `'@`). Der Block wird durch `__TEXTBLOCK_n__` ersetzt,
 * sein Inhalt steht in `bloecke[n]`. Ob er Daten (Commit-Text, Datei-Inhalt)
 * oder Code (`node - <<'EOF'`) ist, entscheidet der Befehl, an dem die Marke
 * haengt — vorher lief jede Zeile davon als eigener Befehl durch die Pruefung.
 *
 * Der Heredoc-Operator zaehlt nur ausserhalb von Anfuehrungszeichen: ein
 * `"<<EOF"` in einem Commit-Text oeffnet keinen Block. Fehlt die Endzeile,
 * gehoert der Rest zum Block — so liest bash es auch. Ausnahme wie in bash:
 * `"$(cat <<'EOF' … EOF\n)"` — innerhalb von `$(…)` gilt wieder die Zerlegung
 * ohne Anfuehrungszeichen, und genau so steht jede Commit-Botschaft dieses
 * Projekts da.
 *
 * `vorher`: Bloecke eines aeusseren Aufrufs; neue werden dahinter nummeriert,
 * vorhandene Marken bleiben gueltig.
 */
export function textbloecke(cmd, shell = 'bash', vorher = []) {
  const bloecke = [...vorher];
  if (typeof cmd !== 'string' || !cmd) return { text: cmd || '', bloecke };
  if (shell === 'pwsh') {
    const text = cmd.replace(/@(['"])[ \t]*\r?\n([\s\S]*?)\r?\n\1@/g, (_, q, body) => {
      bloecke.push(body);
      return `'__TEXTBLOCK_${bloecke.length - 1}__'`;
    });
    return { text, bloecke };
  }
  let aus = '';
  let quote = null;
  const offen = [];
  // Offene `$(` innerhalb von "…": wohin nach der schliessenden Klammer zurueck.
  const ebenen = [];
  let i = 0;
  while (i < cmd.length) {
    const c = cmd[i];
    if (quote === '"' && c === '$' && cmd[i + 1] === '(' && cmd[i + 2] !== '(') {
      ebenen.push({ zurueck: '"', klammern: 0 });
      quote = null;
      aus += '$(';
      i += 2;
      continue;
    }
    if (quote) {
      aus += c;
      if (c === '\\' && quote === '"' && i + 1 < cmd.length) { aus += cmd[i + 1]; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '\\' && i + 1 < cmd.length) { aus += c + cmd[i + 1]; i += 2; continue; }
    if (c === '#' && (i === 0 || /\s/.test(cmd[i - 1]))) {
      // Kommentar bis Zeilenende: ein Apostroph darin oeffnet nichts.
      const e = cmd.indexOf('\n', i);
      const stop = e === -1 ? cmd.length : e;
      aus += cmd.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; aus += c; i++; continue; }
    if (c === '<' && cmd[i + 1] === '<' && cmd[i + 2] !== '<' && cmd[i - 1] !== '<') {
      const m = /^<<(-?)[ \t]*(['"]?)([A-Za-z_][\w.-]*)\2/.exec(cmd.slice(i));
      if (m && TEXTBLOCK.test(m[3])) { aus += m[0]; i += m[0].length; continue; }
      if (m) {
        bloecke.push('');
        offen.push({ ende: m[3], tabs: m[1] === '-', nr: bloecke.length - 1 });
        aus += `<<__TEXTBLOCK_${bloecke.length - 1}__`;
        i += m[0].length;
        continue;
      }
    }
    if (c === '\n' && offen.length) {
      aus += '\n';
      i++;
      for (const h of offen) {
        const zeilen = [];
        while (i < cmd.length) {
          let e = cmd.indexOf('\n', i);
          if (e === -1) e = cmd.length;
          const z = cmd.slice(i, e).replace(/\r$/, '');
          i = e + 1;
          if ((h.tabs ? z.replace(/^\t+/, '') : z) === h.ende) break;
          zeilen.push(z);
        }
        bloecke[h.nr] = zeilen.join('\n');
      }
      offen.length = 0;
      continue;
    }
    if (ebenen.length && (c === '(' || c === ')')) {
      const e = ebenen[ebenen.length - 1];
      if (c === '(') e.klammern++;
      else if (e.klammern > 0) e.klammern--;
      else { ebenen.pop(); quote = e.zurueck; }
    }
    aus += c;
    i++;
  }
  return { text: aus, bloecke };
}

/**
 * Zerlegt eine Kommandozeile in Abschnitte (an `; | & ( ) \n` usw.) und jeden
 * Abschnitt in Woerter `{ v, q, q0, dq, glob, op }`: v = Wert ohne
 * Anfuehrungszeichen, q = irgendein Teil stand in Anfuehrungszeichen, q0 = das
 * erste Zeichen, dq = ein Teil stand in doppelten (dort laufen `$(…)` weiter),
 * glob = ein unmaskiertes `* ? [` kam vor, op = Umleitung
 * (`>`, `2>>`, `2>&1`, `<<`, `&>` …) als eigenes Wort.
 *
 * Am Ergebnis: `abschnitt.pipe` = der Abschnitt liest die Ausgabe des vorigen
 * (einfache Pipe), `ergebnis.offen` = ein Anfuehrungszeichen wurde nie
 * geschlossen, die Zerlegung kann sich also verzaehlt haben.
 */
export function zerlege(cmd, shell) {
  const pwsh = shell === 'pwsh';
  const esc = pwsh ? '`' : '\\';
  const trenner = pwsh ? '\n;|&(){}' : '\n;|&()`';
  const abschnitte = [];
  let woerter = [];
  let w = null;
  let pipeIn = false;
  const neu = (quoted) => { w ??= { v: '', q: false, q0: quoted, glob: false }; };
  const zeichen = (c, quoted) => {
    neu(quoted);
    w.v += c;
    if (quoted) w.q = true;
    else if (c === '*' || c === '?' || c === '[') w.glob = true;
  };
  const wortEnde = () => { if (w) { woerter.push(w); w = null; } };
  const abschnittEnde = (naechsterGepiped = false) => {
    wortEnde();
    if (woerter.length) { woerter.pipe = pipeIn; abschnitte.push(woerter); }
    woerter = [];
    pipeIn = naechsterGepiped;
  };

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
      if (ende === -1) abschnitte.offen = true;
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
      w.dq = true;                     // nur hier laufen `$(…)` und Backticks noch
      let j = i + 1;
      while (j < cmd.length && cmd[j] !== '"') {
        if (cmd[j] === esc && j + 1 < cmd.length) {
          // bash: in "…" maskiert \ nur $ ` " \ und Zeilenumbruch.
          if (pwsh || '$`"\\\n'.includes(cmd[j + 1])) { w.v += cmd[j + 1]; j += 2; continue; }
        }
        w.v += cmd[j];
        j++;
      }
      if (j >= cmd.length) abschnitte.offen = true;
      i = j;
      continue;
    }
    if (c === '\r') continue;
    if (c === ' ' || c === '\t') { wortEnde(); continue; }
    if (c === '#' && !w) {
      // Kommentar am Wortanfang bis Zeilenende (bash und PowerShell).
      const e = cmd.indexOf('\n', i);
      i = (e === -1 ? cmd.length : e) - 1;
      continue;
    }
    // Umleitungen als eigenes Wort: `a>b`, `2>&1`, `&>x`, `<<MARKE`. Vorher
    // klebten sie am Nachbarwort, und `echo x>app/y` war kein Schreibziel.
    if (c === '>' || c === '<' || (c === '&' && cmd[i + 1] === '>')) {
      let op = '';
      if (w && !w.q && /^(\d+|\*)$/.test(w.v)) { op = w.v; w = null; } else wortEnde();
      let j = i;
      if (cmd[j] === '&') { op += '&'; j++; }
      const r = cmd[j];
      op += r;
      j++;
      if (r === '<' && cmd[j] === '<') {
        op += '<'; j++;
        if (cmd[j] === '<' || cmd[j] === '-') { op += cmd[j]; j++; }
      } else if (r === '>' && (cmd[j] === '>' || cmd[j] === '|')) {
        op += cmd[j]; j++;
      }
      if (cmd[j] === '&' && /[\d-]/.test(cmd[j + 1] || '')) {
        op += '&'; j++;
        while (/[\d-]/.test(cmd[j] || '')) { op += cmd[j]; j++; }
      }
      woerter.push({ v: op, q: false, q0: false, glob: false, op: true });
      i = j - 1;
      continue;
    }
    if (trenner.includes(c)) {
      if (c === '|' && cmd[i + 1] === '|') { abschnittEnde(false); i++; continue; }
      if (c === '|') { if (cmd[i + 1] === '&') i++; abschnittEnde(true); continue; }
      if (c === '&' && cmd[i + 1] === '&') { abschnittEnde(false); i++; continue; }
      abschnittEnde(false);
      continue;
    }
    zeichen(c, false);
  }
  abschnittEnde();
  return abschnitte;
}

/** Ist das Umleitungs-Wort eine Kanal-Verdopplung (`2>&1`, `>&2`) ohne eigenes Ziel? */
export function istVerdopplung(op) {
  return /&(\d+|-)$/.test(op);
}

/** Umleitungen entfernen, Vorsaetze ueberspringen. Liefert die Woerter ab dem Befehl. */
export function befehlsWoerter(woerter) {
  const t = [];
  for (let i = 0; i < woerter.length; i++) {
    const w = woerter[i];
    if (w.op) {
      if (!istVerdopplung(w.v) && woerter[i + 1] && !woerter[i + 1].op) i++;
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

/** `C:\Programme\nodejs\node.exe` -> `node`, `npm.cmd` -> `npm`. */
export function befehlsName(v) {
  return v.split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|cmd|bat|com)$/, '');
}
