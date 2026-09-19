#!/usr/bin/env node
// Waechter gegen neue Sicherheitswarnungen in den Abhaengigkeiten.
//
// Warum ueberhaupt: `npm audit` lief bis 19.09.2026 nirgends automatisch. Beim
// ersten Durchgang standen 10 Warnungen offen, zwei davon kritisch. Nach dem
// Aufraeumen (Commit 0077abf, next 16.3.1 -> 16.3.5) ist der Auslieferungsbaum
// nachweislich sauber; nur der Werkzeug-Baum traegt noch Altlast.
//
// Warum der Ausnahme-Block eine Konstante ist und keine Datei, die sich selbst
// schreibt: gleiche Begruendung wie in check-eslint-budget.mjs. Ein Stand, den
// der Waechter selbst fortschreiben darf, ist kein Waechter. Jede Ausnahme
// steht hier mit Begruendung im Klartext und muss von Hand entfernt werden.
//
// Zwei Haerten, bewusst unterschiedlich:
//   * Auslieferungs-Baum (`--omit=dev`): harte Null ab "hoch". Heute erreicht,
//     also festgenagelt. Kein Ausnahme-Block, der greift hier nicht.
//   * Werkzeug-Baum (alles inkl. dev): nur die unten gelisteten Kennungen sind
//     erlaubt, alles Unbekannte ab "hoch" ist rot.
//
// npm wird ueber process.execPath + npm-cli.js gestartet, nicht ueber `npx`
// oder `npm.cmd`: spawn ohne Shell kann .cmd auf Windows nicht starten (EINVAL),
// mit Shell frisst ein Zeitlimit nur die cmd.exe. Siehe der gleiche Trick in
// check-eslint-budget.mjs:28-31.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Bekannte, bewusst offene Warnungen — alle gegen `tar`, alle ueber fastembed.
// fastembed@2.1.0 ist eine reine Entwickler-Abhaengigkeit (lokale AgentDB,
// Vector-Recall auf Port 7878) und landet nie im Vercel-Build. Der einzige Fix
// waere ein Rueckschritt auf fastembed@1.0.0, also eine Hauptversion zurueck.
// Bewusst nicht genommen; erneut pruefen, sobald fastembed eine Version mit
// onnxruntime-node > 1.21 veroeffentlicht.
const BEKANNT = {
  'GHSA-23hp-3jrh-7fpw': 'tar via fastembed (dev) — kritisch',
  'GHSA-34x7-hfp2-rc4v': 'tar via fastembed (dev)',
  'GHSA-83g3-92jg-28cx': 'tar via fastembed (dev)',
  'GHSA-8qq5-rm4j-mr97': 'tar via fastembed (dev)',
  'GHSA-8x88-c5mf-7j5w': 'tar via fastembed (dev)',
  'GHSA-9ppj-qmqm-q256': 'tar via fastembed (dev)',
  'GHSA-qffp-2rhf-9h96': 'tar via fastembed (dev)',
  'GHSA-r292-9mhp-454m': 'tar via fastembed (dev)',
  'GHSA-r6q2-hw4h-h46w': 'tar via fastembed (dev)',
  'GHSA-gvwx-54wh-qm9j': 'tar via fastembed (dev) — mittel',
  'GHSA-vmf3-w455-68vh': 'tar via fastembed (dev) — mittel',
  'GHSA-w8wr-v893-vjvp': 'tar via fastembed (dev) — mittel',
};

const ROT_AB = new Set(['high', 'critical']);

function npmCli() {
  const d = dirname(process.execPath);
  const kandidaten = [
    join(d, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(d, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const treffer = kandidaten.find((p) => existsSync(p));
  if (!treffer) {
    console.error('npm-cli.js nicht gefunden neben', process.execPath);
    console.error('Gesucht in:\n  ' + kandidaten.join('\n  '));
    process.exit(1);
  }
  return treffer;
}

const CLI = npmCli();

// Gibt die Befunde als Map GHSA-Kennung -> { paket, schwere, titel } zurueck.
// Bricht hart ab, wenn die Ausgabe leer oder unlesbar ist: `npm audit` endet
// IMMER mit Code 1, sobald irgendetwas offen ist — der Exit-Code taugt also
// nicht als Signal, nur der geparste Inhalt zaehlt. Eine kaputte Ausgabe darf
// nicht als "nichts gefunden" durchgehen.
function audit(extraArgs, label) {
  const r = spawnSync(process.execPath, [CLI, 'audit', '--json', ...extraArgs], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 180_000,
  });

  if (r.error) {
    console.error(`npm audit (${label}) liess sich nicht starten: ${r.error.message}`);
    process.exit(1);
  }
  const raw = (r.stdout || '').trim();
  if (!raw) {
    console.error(`npm audit (${label}) hat nichts ausgegeben.`);
    if (r.stderr) console.error(r.stderr.trim().split('\n').slice(0, 10).join('\n'));
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error(`npm audit (${label}) hat kein lesbares JSON geliefert: ${e.message}`);
    console.error(raw.slice(0, 400));
    process.exit(1);
  }
  if (!data || typeof data.vulnerabilities !== 'object' || data.vulnerabilities === null) {
    console.error(`npm audit (${label}): unerwartetes Format, kein vulnerabilities-Block.`);
    process.exit(1);
  }

  const befunde = new Map();
  for (const [paket, eintrag] of Object.entries(data.vulnerabilities)) {
    for (const via of eintrag.via || []) {
      if (typeof via !== 'object' || !via.url) continue; // String = nur Weiterleitung auf ein anderes Paket
      const m = /GHSA-[0-9a-z-]+/i.exec(via.url);
      if (!m) continue;
      befunde.set(m[0], {
        paket: via.name || paket,
        schwere: via.severity || eintrag.severity || 'unknown',
        titel: via.title || '',
      });
    }
  }
  return befunde;
}

const prod = audit(['--omit=dev'], 'Auslieferung');
const alle = audit([], 'inkl. Werkzeuge');

const prodRot = [...prod].filter(([, v]) => ROT_AB.has(v.schwere));
const neu = [...alle].filter(([id, v]) => ROT_AB.has(v.schwere) && !BEKANNT[id]);
const verschwunden = Object.keys(BEKANNT).filter((id) => !alle.has(id));

let fehler = false;

if (prodRot.length) {
  fehler = true;
  console.error(`\nFEHLER: ${prodRot.length} Warnung(en) im ausgelieferten Code — hier gilt harte Null.`);
  for (const [id, v] of prodRot) {
    console.error(`  ${v.schwere.padEnd(8)} ${v.paket} — ${id}${v.titel ? ' — ' + v.titel : ''}`);
  }
  console.error('  Behebung: `npm audit fix`. Haengt es an einer festgeschriebenen');
  console.error('  Version in package.json, dort die Version anheben und `npm install`.');
}

if (neu.length) {
  fehler = true;
  console.error(`\nFEHLER: ${neu.length} neue Warnung(en) ab "hoch", die hier nicht gelistet sind.`);
  for (const [id, v] of neu) {
    console.error(`  ${v.schwere.padEnd(8)} ${v.paket} — ${id}${v.titel ? ' — ' + v.titel : ''}`);
  }
  console.error('  Entweder beheben (`npm audit fix`) oder — mit schriftlicher');
  console.error('  Begruendung — in BEKANNT in scripts/check-npm-audit.mjs aufnehmen.');
}

if (verschwunden.length) {
  fehler = true;
  console.error(`\nFEHLER: ${verschwunden.length} Eintrag/Eintraege in BEKANNT sind erledigt.`);
  for (const id of verschwunden) console.error(`  ${id} — ${BEKANNT[id]}`);
  console.error('  Aus BEKANNT in scripts/check-npm-audit.mjs streichen, damit der');
  console.error('  Deckel nicht heimlich wieder Luft bekommt.');
}

if (fehler) process.exit(1);

console.log(
  `✓ Abhaengigkeiten: Auslieferung sauber (${prod.size} Befund(e), davon 0 ab "hoch"), ` +
    `${Object.keys(BEKANNT).length} bekannte Ausnahme(n) im Werkzeug-Baum.`
);
