// Ladepruefung der Disziplin-Hooks: laesst sich jedes registrierte Skript
// ueberhaupt laden, und steht nirgends ein Schalter, der alle abschaltet?
//
// Warum: ein Hook, der beim Laden stirbt (fehlende Datei, Tippfehler in einem
// importierten Namen), endet mit Exit 1. Claude Code wertet das als
// nicht-blockierenden Fehler — das Gate ist aus, und niemand merkt es. Die
// Anwesenheitspruefung in check-discipline-hooks.mjs fragte nur, ob die Datei
// existiert (Sicherheitsdurchsicht 24.10.2026,
// gate-faellt-offen-bei-fehlender-datei). Dazu eine Zeile `disableAllHooks` in
// .claude/settings.local.json: alle Waechter aus, ohne Spur im Repo
// (hooks-abschaltbar-settings-local).
//
// Die Pruefung LAEDT die Hooks nicht: ein Hook-Skript liest beim Import stdin
// und beendet den Prozess. Stattdessen `node --check` je Datei und ein
// Textabgleich der Importe gegen die Exporte. Das deckt die Fehlerklasse ab,
// die hier zaehlt — Datei weg, Syntax kaputt, Name umbenannt —, und kostet
// keinen einzigen Seiteneffekt.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

const HOOK_QUELLE = join('infra', 'claude-settings', 'hooks.json');

/** Kommentare weg — ein Beispiel-Import im Kommentar ist kein Import. */
function ohneKommentare(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((z) => z.replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n');
}

/** Namen, die ein Modul exportiert. `null`, wenn `export *` die Liste offen laesst. */
export function exporte(roh) {
  const text = ohneKommentare(roh);
  if (/^\s*export\s*\*/m.test(text)) return null;
  const namen = new Set();
  for (const m of text.matchAll(/^\s*export\s+(?:async\s+)?function\s*\*?\s*([\w$]+)/gm)) namen.add(m[1]);
  for (const m of text.matchAll(/^\s*export\s+(?:const|let|var|class)\s+([\w$]+)/gm)) namen.add(m[1]);
  if (/^\s*export\s+default\b/m.test(text)) namen.add('default');
  for (const m of text.matchAll(/^\s*export\s*\{([^}]*)\}/gm)) {
    for (const teil of m[1].split(',')) {
      const t = teil.trim();
      if (!t) continue;
      const als = t.split(/\s+as\s+/);
      namen.add((als[1] || als[0]).trim());
    }
  }
  return namen;
}

/** Relative Importe eines Moduls mit den Namen, die davon benutzt werden. */
export function importe(roh) {
  const text = ohneKommentare(roh);
  const out = [];
  const namenAus = (liste) => liste.split(',').map((t) => t.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
  // Die Klausel darf kein Anfuehrungszeichen und kein Semikolon enthalten —
  // sonst laeuft das Muster vom `import … from 'node:fs'` davor bis hierher.
  for (const m of text.matchAll(/^\s*import\s+([^'";]*?)\s+from\s+['"]([^'"]+)['"]/gm)) {
    if (!/^\.{1,2}\//.test(m[2])) continue;
    const klausel = m[1].trim();
    const namen = [];
    const geschweift = klausel.match(/\{([^}]*)\}/);
    if (geschweift) namen.push(...namenAus(geschweift[1]));
    const standard = klausel.replace(/\{[^}]*\}/, '').replace(/\*\s+as\s+[\w$]+/, '').replace(/,/g, '').trim();
    if (standard) namen.push('default');
    out.push({ spec: m[2], namen });
  }
  for (const m of text.matchAll(/^\s*import\s+['"](\.{1,2}\/[^'"]+)['"]/gm)) out.push({ spec: m[1], namen: [] });
  for (const m of text.matchAll(/^\s*export\s*\{([^}]*)\}\s*from\s+['"](\.{1,2}\/[^'"]+)['"]/gm)) {
    out.push({ spec: m[2], namen: namenAus(m[1]) });
  }
  // Dynamisch: `x = await import('./lib/y.mjs')` und danach `x.name`, oder
  // `const { a, b } = await import(…)`.
  for (const m of text.matchAll(/(?:\{([^}]*)\}|([\w$]+))\s*=\s*await\s+import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
    const namen = m[1] ? namenAus(m[1].replace(/:\s*[\w$]+/g, '')) : [];
    if (m[2]) {
      const re = new RegExp(`\\b${m[2].replace(/\$/g, '\\$')}\\.([\\w$]+)`, 'g');
      for (const n of text.matchAll(re)) namen.push(n[1]);
    }
    out.push({ spec: m[3], namen: [...new Set(namen)] });
  }
  for (const m of text.matchAll(/import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
    if (!out.some((o) => o.spec === m[1])) out.push({ spec: m[1], namen: [] });
  }
  return out;
}

function syntax(datei) {
  const r = spawnSync(process.execPath, ['--check', datei], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
  if (r.error) return `nicht pruefbar (${r.error.code || r.error.message})`;
  if (r.status !== 0) return (r.stderr || '').split('\n').find((z) => /Error/.test(z)) || `node --check Exit ${r.status}`;
  return null;
}

/** Schalter, mit denen sich alle oder einzelne Waechter abschalten lassen. */
export function schalter(projectDir, home = homedir(), env = process.env) {
  const warnungen = [];
  const dateien = [
    join(projectDir, '.claude', 'settings.json'),
    join(projectDir, '.claude', 'settings.local.json'),
    join(home, '.claude', 'settings.json'),
  ];
  for (const f of dateien) {
    let j;
    try { j = JSON.parse(readFileSync(f, 'utf8')); } catch (err) {
      if (err?.code !== 'ENOENT') warnungen.push(`${f} nicht lesbar (${err?.code || 'kein gueltiges JSON'})`);
      continue;
    }
    if (j?.disableAllHooks === true) warnungen.push(`${f}: "disableAllHooks": true — ALLE Waechter sind aus`);
    for (const k of ['WRITE_GATE', 'SEARCH_GATE', 'PROCESS_WATCHER']) {
      if (String(j?.env?.[k]) === '0') warnungen.push(`${f}: env.${k}=0 — dieser Waechter ist dauerhaft aus`);
    }
  }
  for (const k of ['WRITE_GATE', 'SEARCH_GATE']) {
    if (env[k] === '0') warnungen.push(`Umgebung: ${k}=0 — dieser Waechter ist in dieser Sitzung aus`);
  }
  return warnungen;
}

/**
 * Prueft alle in infra/claude-settings/hooks.json registrierten Skripte samt
 * ihrer relativen Importe. Liefert { fehler, warnungen, geprueft }.
 */
export function pruefeHooks(projectDir, { home, env } = {}) {
  const fehler = [];
  const quelle = join(projectDir, HOOK_QUELLE);
  let roh = '';
  try { roh = readFileSync(quelle, 'utf8'); } catch {
    return { fehler: [`${HOOK_QUELLE} fehlt`], warnungen: schalter(projectDir, home, env), geprueft: 0 };
  }
  const start = new Set();
  for (const m of roh.matchAll(/scripts\/[A-Za-z0-9_./-]+\.mjs/g)) start.add(resolve(projectDir, m[0]));

  const gesehen = new Set();
  const offen = [...start];
  const name = (f) => relative(projectDir, f).replace(/\\/g, '/');
  while (offen.length) {
    const datei = offen.shift();
    if (gesehen.has(datei)) continue;
    gesehen.add(datei);
    if (!existsSync(datei)) { fehler.push(`${name(datei)} fehlt`); continue; }
    const s = syntax(datei);
    if (s) { fehler.push(`${name(datei)}: ${s}`); continue; }
    const text = readFileSync(datei, 'utf8');
    for (const imp of importe(text)) {
      const ziel = resolve(dirname(datei), imp.spec);
      if (!existsSync(ziel)) { fehler.push(`${name(datei)} importiert ${imp.spec} — Datei fehlt`); continue; }
      // Hook-Skripte selbst werden nie geladen (sie lesen stdin), nur ihre Bibliotheken.
      if (!start.has(ziel)) offen.push(ziel);
      if (!imp.namen.length) continue;
      const ex = exporte(readFileSync(ziel, 'utf8'));
      if (!ex) continue;
      const fehlend = imp.namen.filter((n) => !ex.has(n));
      if (fehlend.length) fehler.push(`${name(datei)} braucht aus ${imp.spec}: ${fehlend.join(', ')} — dort nicht exportiert`);
    }
  }
  return { fehler, warnungen: schalter(projectDir, home, env), geprueft: gesehen.size };
}
