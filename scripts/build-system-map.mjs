#!/usr/bin/env node
/**
 * Erzeugt infra/system-map.json aus den echten Quellen im Repo.
 *
 * Warum generiert und nicht von Hand gepflegt: eine handgeschriebene
 * Architektur-Karte driftet innerhalb von Wochen von der Realität weg und ist
 * dann schlimmer als keine, weil man ihr glaubt. Diese Karte wird aus
 * systemd-Units, GH-Workflows, Script-Aufrufen und den Laufzeit-Verträgen
 * abgeleitet — `scripts/check-system-map.mjs` prüft sie gegen den Code.
 *
 * Erfasst:
 *   • systemd-Units (infra/hetzner/*.service|*.timer) samt Beziehungen
 *     OnSuccess/OnFailure/Conflicts/After/Wants und den Scripts hinter ALLEN
 *     Exec*-Zeilen (ExecStart, ExecStartPre/Post, ExecStop/StopPost,
 *     ExecReload, ExecCondition)
 *   • Unit→Unit-Kanten aus `systemctl start|stop|restart <unit>` in diesen
 *     Exec*-Zeilen (z.B. stoppt das ExecStartPre des Daily-Crawls den
 *     Marktwert-Lauf) — from ist dort der Unit-Name, nicht ein Script
 *   • GitHub-Workflows (.github/workflows/*.yml) samt Schedule + Scripts
 *   • Script→Script-Kanten: systemctl-Starts und spawn()-Aufrufe im Code
 *     (das sind die Kanten, die man in den Units NICHT sieht — z.B. startet
 *     der Daily-Crawl den Snapshot-Publisher aus dem Code heraus)
 *   • welche Unit einen Laufzeit-Vertrag hat (infra/contracts.json)
 *
 * Usage: node scripts/build-system-map.mjs [--check]
 *   --check  schreibt nicht, sondern meldet per Exit-Code, ob die
 *            committete Karte noch zum Code passt (für pre-push / CI)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const UNIT_DIR = resolve(ROOT, 'infra', 'hetzner');
const WF_DIR = resolve(ROOT, '.github', 'workflows');
const MAP_PATH = resolve(ROOT, 'infra', 'system-map.json');

const CHECK_ONLY = process.argv.includes('--check');

// ---------------------------------------------------------------- Helpers

const read = (p) => readFileSync(p, 'utf8');
const listDir = (d, re) => (existsSync(d) ? readdirSync(d).filter(f => re.test(f)).sort() : []);

/**
 * Zieht das Repo-Script aus einer Exec*-Zeile (Praefixe wie `-`/`+` stoeren
 * nicht, gesucht wird ab Leerzeichen/Quote/Slash).
 * Formen: `/usr/bin/node scripts/x.mjs --flag`, `/usr/bin/node /opt/.../scripts/x.mjs`,
 *         `/usr/local/bin/foo.sh` (deployt aus infra/hetzner/foo.sh),
 *         `/bin/sh -c '... node scripts/x.mjs ...'`
 */
function scriptFromExecStart(line) {
  const shell = line.match(/\/usr\/local\/bin\/([\w.-]+\.sh)/);
  if (shell) return `infra/hetzner/${shell[1]}`;
  const node = line.match(/(?:^|[\s'"/])(scripts\/[\w./-]+\.mjs)/);
  if (node) return node[1];
  return null;
}

// Bis 2026-10 las die Karte nur ExecStart. Dadurch fehlte z.B.
// precompute-comp-windows.mjs (laeuft als ExecStartPre des Snapshot-Publishers)
// und galt als "Script ohne Aufrufer", und der Stopp des Marktwert-Laufs im
// ExecStartPre des Daily-Crawls war in keiner Kante zu sehen.
export const EXEC_KEYS = [
  'ExecCondition', 'ExecStartPre', 'ExecStart', 'ExecStartPost',
  'ExecReload', 'ExecStop', 'ExecStopPost',
];

/**
 * `systemctl start|stop|restart <unit…>` aus einer Exec*-Zeile. Optionen vor
 * oder nach dem Verb (`--no-block`) und mehrere Units je Aufruf sind erlaubt.
 * Andere Verben (is-active, try-restart, …) sind keine Kante.
 */
export function systemctlActions(line) {
  const out = [];
  const opt = String.raw`-{1,2}[\w-]+(?:=\S+)?`;
  const re = new RegExp(
    String.raw`\bsystemctl\s+(?:${opt}\s+)*(start|stop|restart)((?:\s+(?:${opt}|[\w@.-]+\.(?:service|timer)))+)`,
    'g',
  );
  for (const m of line.matchAll(re)) {
    for (const u of m[2].matchAll(/[\w@.-]+\.(?:service|timer)/g)) {
      out.push({ action: m[1], unit: u[0] });
    }
  }
  return out;
}

export function parseUnitText(file, text) {
  const get = (key) => {
    const out = [];
    // systemd erlaubt mehrere Zeilen derselben Direktive (additiv).
    const re = new RegExp(`^${key}=(.*)$`, 'gm');
    let m;
    while ((m = re.exec(text))) out.push(m[1].trim());
    return out;
  };
  const execByKey = EXEC_KEYS.map(k => [k, get(k)]);
  const execs = execByKey.flatMap(([, lines]) => lines);
  const edges = [];
  for (const [key, lines] of execByKey) {
    for (const line of lines) {
      for (const { action, unit } of systemctlActions(line)) {
        if (unit !== file) edges.push({ from: file, to: unit, via: `systemctl-${action}`, exec: key });
      }
    }
  }
  const rels = {};
  for (const key of ['OnSuccess', 'OnFailure', 'Conflicts', 'Wants', 'After', 'Requires', 'Before']) {
    // Werte können mehrere Units in einer Zeile enthalten (leerzeichengetrennt).
    const vals = get(key).flatMap(v => v.split(/\s+/)).filter(Boolean)
      .filter(v => v.endsWith('.service') || v.endsWith('.timer'));
    if (vals.length) rels[key] = [...new Set(vals)];
  }
  const unit = {
    name: file,
    kind: file.endsWith('.timer') ? 'timer' : 'service',
    description: (get('Description')[0] || '').trim() || null,
    scripts: [...new Set(execs.map(scriptFromExecStart).filter(Boolean))],
    ...rels,
  };
  if (unit.kind === 'timer') {
    // Nicht jeder Timer ist kalendarisch — Intervall-Timer nutzen OnBootSec /
    // OnUnitActiveSec. Beides erfassen, sonst sieht die Karte sie als ungeplant.
    unit.onCalendar = get('OnCalendar');
    unit.interval = [...get('OnBootSec').map(v => `OnBootSec=${v}`),
                     ...get('OnUnitActiveSec').map(v => `OnUnitActiveSec=${v}`)];
    unit.activates = (get('Unit')[0] || file.replace(/\.timer$/, '.service')).trim();
    unit.persistent = /^Persistent=true/m.test(text);
  }
  return { unit, edges };
}

function parseUnit(file) {
  return parseUnitText(file, read(resolve(UNIT_DIR, file)));
}

function parseWorkflow(file) {
  const text = read(resolve(WF_DIR, file));
  const name = (text.match(/^name:\s*(.+)$/m) || [])[1]?.trim() || file;
  const crons = [...text.matchAll(/-\s*cron:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  const scripts = [...new Set(
    [...text.matchAll(/(scripts\/[\w./-]+\.mjs)/g)].map(m => m[1]),
  )];
  const dispatch = /workflow_dispatch/.test(text);
  const onPush = /^\s*push:/m.test(text);
  return { file, name, schedule: crons, scripts, manualDispatch: dispatch, onPush };
}

/** Script→Script- und Script→Unit-Kanten, die in keiner Unit stehen. */
function parseScriptEdges() {
  const edges = [];
  const dir = resolve(ROOT, 'scripts');
  // Generator und Checker führen Script- und Unit-Namen als DATEN (Regex-
  // Literale, Whitelists). Würde man sie mitlesen, gälte jedes dort gelistete
  // Script als "aufgerufen" — die Whitelist würde den Detektor blind machen,
  // der sie befüllt.
  // check-drift.mjs gehört seit 2026-08-04 dazu: seine ALLOWED-Liste der
  // Limiter-Literale nennt drei Scripts, die es nie startet. Es ruft selbst
  // nichts auf — der Verlust an Erkennung ist damit null.
  const SELF = new Set([
    'build-system-map.mjs', 'check-system-map.mjs', 'check-drift.mjs',
    // Der Test fuehrt Unit-Zeilen als Beispieldaten (systemctl start a.service).
    'build-system-map.test.mjs',
    // Die api-map-Werkzeuge laufen aus dem pre-push und aus package.json, nicht
    // aus einer Unit — ohne sie hier stuenden sie dauerhaft als „Skript ohne
    // Aufrufer" im Bericht.
    'build-api-map.mjs', 'check-api-map.mjs',
  ]);
  const files = listDir(dir, /\.mjs$/).filter(f => !SELF.has(f));
  for (const f of files) {
    const text = read(resolve(dir, f));
    const from = `scripts/${f}`;

    // Unit-Start aus dem Code heraus. Die Argumente stehen je nach Aufrufform
    // verstreut (`spawnSync('systemctl', ['start','--no-block','x.service'])`),
    // deshalb ein Fenster um jedes `systemctl` statt einer starren Argumentfolge.
    for (const m of text.matchAll(/systemctl/g)) {
      const win = text.slice(m.index, m.index + 240);
      if (!/['"]start['"]|\bstart\b/.test(win)) continue;
      for (const u of win.matchAll(/([\w.-]+\.(?:service|timer))/g)) {
        edges.push({ from, to: u[1], via: 'systemctl-start' });
      }
    }
    // Direkter Aufruf eines anderen Scripts via spawn/execFile/fork.
    for (const m of text.matchAll(/['"](scripts\/[\w./-]+\.mjs)['"]/g)) {
      if (m[1] !== from) edges.push({ from, to: m[1], via: 'spawn' });
    }
    // Aufruf über den blossen Dateinamen — so führt validate-tft-pros-loop.mjs
    // seine Schritt-Registry (`{ script: 'crawl-tft-pro-players.mjs' }`). Ohne
    // diesen Fall meldet die Karte acht aktive Scripts als verwaist.
    for (const m of text.matchAll(/['"]([\w-]+\.mjs)['"]/g)) {
      const target = `scripts/${m[1]}`;
      if (target !== from && existsSync(resolve(ROOT, target))) {
        edges.push({ from, to: target, via: 'spawn' });
      }
    }
  }
  // Duplikate zusammenfassen.
  const seen = new Set();
  return edges.filter(e => {
    const k = `${e.from}|${e.to}|${e.via}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------- Build

function build() {
  const parsed = listDir(UNIT_DIR, /\.(service|timer)$/).map(parseUnit);
  const units = parsed.map(p => p.unit);
  const workflows = listDir(WF_DIR, /\.ya?ml$/).map(parseWorkflow);
  // Kanten aus dem Code zuerst, dahinter die aus den Exec*-Zeilen der Units.
  // via `systemctl-start` aus einer Unit prueft check-system-map (Schritt 4)
  // genauso wie einen Start aus dem Code.
  const scriptEdges = [...parseScriptEdges(), ...parsed.flatMap(p => p.edges)];

  const contracts = JSON.parse(read(resolve(ROOT, 'infra', 'contracts.json'))).contracts;
  const contractsByOwner = {};
  for (const c of contracts) {
    (contractsByOwner[c.owner] ||= []).push(c.id);
  }

  // npm-Scripts zählen als Einstiegspunkt — sie sind ein bewusster Aufrufer.
  const pkg = JSON.parse(read(resolve(ROOT, 'package.json')));
  const npmScripts = Object.entries(pkg.scripts || {})
    .map(([k, v]) => ({ name: k, scripts: [...new Set([...String(v).matchAll(/(scripts\/[\w./-]+\.mjs)/g)].map(m => m[1]))] }))
    .filter(x => x.scripts.length);

  return {
    $comment: [
      'GENERIERT von scripts/build-system-map.mjs — nicht von Hand editieren.',
      'Neu bauen: npm run build:system-map. Prüfen: npm run check:system-map.',
      'Die Karte beantwortet: welcher Timer startet welchen Service, welches',
      'Script laeuft dort, wer triggert wen aus dem Code heraus, und welche',
      'Pipeline hat einen Laufzeit-Vertrag (infra/contracts.json).',
    ],
    units,
    timers: units.filter(u => u.kind === 'timer').map(t => ({ timer: t.name, activates: t.activates, onCalendar: t.onCalendar })),
    workflows,
    scriptEdges,
    npmScripts,
    contractsByOwner,
  };
}

// Nur als Script ausfuehren, nicht beim Import (Test: build-system-map.test.mjs).
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const map = build();
  const serialized = JSON.stringify(map, null, 2) + '\n';

  if (CHECK_ONLY) {
    if (!existsSync(MAP_PATH)) {
      console.error('infra/system-map.json fehlt — `npm run build:system-map` ausführen.');
      process.exit(1);
    }
    const current = read(MAP_PATH);
    if (current.replace(/\r\n/g, '\n') !== serialized) {
      console.error('infra/system-map.json ist veraltet — `npm run build:system-map` ausführen und committen.');
      process.exit(1);
    }
    console.log('system-map ist aktuell.');
  } else {
    writeFileSync(MAP_PATH, serialized);
    console.log(
      `system-map geschrieben: ${map.units.length} Units, ${map.workflows.length} Workflows, `
      + `${map.scriptEdges.length} Code-Kanten.`,
    );
  }
}
