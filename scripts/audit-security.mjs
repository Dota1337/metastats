#!/usr/bin/env node
// Steuerung der vierteljaehrlichen Sicherheitsdurchsicht.
//
// Die laufenden Waechter (pre-push, CI) pruefen jeweils EINE bekannte
// Fehlerklasse und sind absichtlich stumpf. Was sie strukturell nicht finden,
// ist der Widerspruch zwischen zwei Dateien, die einzeln in Ordnung sind.
//
// Belegter Fall, gefunden im ersten Lauf am 19.09.2026: Migration 0055 Zeile 92
// entzieht anon das Aufrufrecht auf get_tft_comp_stats. Migration 0060 Zeile 49-52
// loescht die Funktion und legt sie neu an — und enthaelt keine einzige grant-
// oder revoke-Zeile (gemessen: grep -ciE "grant|revoke" 0060*.sql = 0). Damit ist
// das Recht wieder da. Der taegliche Vertrags-Check sieht das NICHT: Migration 0056
// stuft Funktionen mit Aufruferrechten als "nur-grant" ein, und
// scripts/lib/contracts.mjs Zeile 235 schlaegt nur bei "offen" an — "nur-grant"
// wandert als Zahl in den Erfolgstext (Zeile 286). Genau dafuer ist die Durchsicht da.
//
// Fuenf Aufrufe:
//   --surface        die Pruefflaeche als JSON (der Nenner der Vollstaendigkeit)
//   --apply <datei>  Ergebnis einer Durchsicht einlesen, mit dem Stand
//                    vergleichen, Aenderungsbericht ausgeben, Stand schreiben
//   --status         Tage seit der letzten Durchsicht
//   --plan           Pruefflaeche + Ablauf fuer den Menschen (npm run audit:security)
//   --alarm          Wecker fuer den pre-push, meldet ab 100 Tagen, blockt nie
//
// Warum die Pruefflaeche ein Skript aufzaehlt und nicht der Agent: ein Agent,
// dem der Platz ausgeht, hoert einfach auf und meldet, was er bis dahin hatte.
// Ohne festen Nenner sieht ein abgebrochener Lauf wie ein sauberer aus, und der
// Stand wird leer geschrieben. Dieselbe Falle hat 2026 schon einmal 700 auf 240
// Eintraege gekuerzt (mergeBaseError in scripts/publish-snapshot-bundle.mjs).
// Deshalb: fehlt zu EINER Datei ein Urteil, ist der Lauf unvollstaendig und
// es wird NICHTS geschrieben.
//
// Warum Befunde ueber Namen gefuehrt werden und nicht ueber Datei:Zeile: eine
// Zeilennummer verschiebt sich bei jedem Edit darueber. Ein Befund, der beim
// naechsten Lauf eine andere Nummer hat, sieht wie ein neuer aus, und der alte
// wie behoben. Der Schluessel ist deshalb der Name der Sache — Routenpfad,
// Tabellenname, Regelname.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const STAND = 'infra/security-baseline.json';
// Vierteljaehrlich, mit Luft: 100 statt 91 Tage, damit der Wecker nicht am
// Tag nach dem Quartalswechsel losgeht und dadurch zum Hintergrundrauschen wird.
const FAELLIG_NACH_TAGEN = 100;

// Die Pruefflaeche. Bewusst eng gefasst: alles, wo ein Fehler Daten oder
// Zugang kostet. Nicht die Oberflaeche, nicht die Auswertungs-Skripte.
const FLAECHE = [
  { gruppe: 'routen', wurzel: 'app/api', passt: (f) => f === 'route.ts',
    frage: 'Wer darf das aufrufen, was schreibt es, was gibt es zurueck?' },
  { gruppe: 'migrationen', wurzel: 'supabase/migrations', passt: (f) => f.endsWith('.sql'),
    frage: 'Wem wird Lesen oder Schreiben erlaubt, und nimmt eine spaetere Migration es zurueck?' },
  { gruppe: 'bibliotheken', wurzel: 'app/lib', passt: (f) => f.endsWith('.ts'),
    frage: 'Wandern Schluessel oder Fremddaten hier an eine Stelle, die sie ausliefert?' },
  { gruppe: 'gatter', wurzel: 'scripts/hooks', passt: (f) => f.endsWith('.mjs'),
    frage: 'Faellt das Gatter still offen aus, wenn etwas fehlt?' },
  { gruppe: 'dienste', wurzel: 'infra/hetzner', passt: (f) => f.endsWith('.service') || f.endsWith('.timer'),
    frage: 'Mit welchen Rechten laeuft der Dienst, welche Geheimnisse sieht er?' },
];

function dateien(dir, passt) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...dateien(p, passt));
    else if (passt(e)) out.push(p.split(sep).join('/'));
  }
  return out.sort();
}

function flaeche() {
  const out = [];
  for (const g of FLAECHE) {
    const fs_ = dateien(g.wurzel, g.passt);
    if (fs_.length === 0) {
      console.error(`Pruefflaeche "${g.gruppe}": keine Datei unter ${g.wurzel} — Pfad falsch?`);
      process.exit(1);
    }
    for (const f of fs_) out.push({ gruppe: g.gruppe, datei: f, frage: g.frage });
  }
  return out;
}

function ladeStand() {
  if (!existsSync(STAND)) return { letzterLauf: null, befunde: [] };
  const j = JSON.parse(readFileSync(STAND, 'utf8'));
  if (!Array.isArray(j.befunde)) {
    console.error(`${STAND}: kein befunde-Feld — Datei von Hand kaputt gemacht?`);
    process.exit(1);
  }
  return j;
}

const arg = process.argv[2];

// Einstieg fuer den Menschen: was zu tun ist, in welcher Aufteilung.
if (arg === '--plan') {
  const f = flaeche();
  const nach = new Map();
  for (const x of f) nach.set(x.gruppe, (nach.get(x.gruppe) || 0) + 1);
  const stand = ladeStand();

  console.log(`\nSicherheitsdurchsicht — Pruefflaeche: ${f.length} Datei(en)\n`);
  for (const g of FLAECHE) {
    console.log(`  ${g.gruppe.padEnd(14)} ${String(nach.get(g.gruppe)).padStart(4)}   ${g.wurzel}`);
  }
  console.log(stand.letzterLauf
    ? `\nLetzter Lauf: ${stand.letzterLauf.slice(0, 10)}, ${stand.befunde.filter((b) => b.status === 'offen').length} offene(r) Befund(e).`
    : `\nLetzter Lauf: noch keiner.`);

  console.log(`
So laeuft die Durchsicht:

  1. Je Gruppe einen metastats-security-auditor starten, alle in EINER
     Nachricht. Jeder bekommt SEINE Dateiliste aus --surface, vollstaendig.
  2. Die JSON-Antworten zu einer Datei zusammenfuehren: "geprueft" ist die
     Vereinigung aller Listen, "befunde" die Summe aller Befunde.
  3. Jeden Befund selbst nachmessen, bevor er in den Stand wandert. Ein
     Agent-Urteil ist eine Behauptung, keine Messung.
  4. node scripts/audit-security.mjs --apply <ergebnis.json>

Fehlt zu einer Datei ein Urteil, schreibt Schritt 4 nichts. Das ist Absicht:
ein abgebrochener Lauf darf nicht wie ein sauberer aussehen.`);
  process.exit(0);
}

if (arg === '--surface') {
  const f = flaeche();
  console.log(JSON.stringify({ anzahl: f.length, dateien: f }, null, 2));
  process.exit(0);
}

if (arg === '--status') {
  const stand = ladeStand();
  if (!stand.letzterLauf) {
    console.log('Sicherheitsdurchsicht: noch nie gelaufen.');
    process.exit(0);
  }
  const tage = Math.floor((Date.now() - Date.parse(stand.letzterLauf)) / 86_400_000);
  const offen = stand.befunde.filter((b) => b.status === 'offen').length;
  console.log(`Sicherheitsdurchsicht: vor ${tage} Tag(en), ${offen} offene(r) Befund(e).`);
  process.exit(0);
}

// Wecker fuer den pre-push. Schweigt, solange die Durchsicht frisch ist,
// und endet IMMER mit 0 — der Push darf daran nicht scheitern.
if (arg === '--alarm') {
  const stand = ladeStand();
  if (!stand.letzterLauf) {
    console.log(`  Hinweis: Sicherheitsdurchsicht noch nie gelaufen (npm run audit:security).`);
    process.exit(0);
  }
  const tage = Math.floor((Date.now() - Date.parse(stand.letzterLauf)) / 86_400_000);
  if (tage > FAELLIG_NACH_TAGEN) {
    console.log(`  Hinweis: Sicherheitsdurchsicht ist ${tage} Tage alt (faellig nach ${FAELLIG_NACH_TAGEN}). npm run audit:security`);
  }
  process.exit(0);
}

if (arg === '--apply') {
  const datei = process.argv[3];
  if (!datei || !existsSync(datei)) {
    console.error('Aufruf: node scripts/audit-security.mjs --apply <ergebnis.json>');
    process.exit(1);
  }

  let erg;
  try {
    erg = JSON.parse(readFileSync(datei, 'utf8'));
  } catch (e) {
    console.error(`${datei} ist kein lesbares JSON: ${e.message}`);
    process.exit(1);
  }
  if (!Array.isArray(erg.geprueft) || !Array.isArray(erg.befunde)) {
    console.error(`${datei}: erwartet werden die Felder "geprueft" (Liste von Dateipfaden) und "befunde".`);
    process.exit(1);
  }

  // Vollstaendigkeit. Ohne diesen Block ist der ganze Mechanismus wertlos.
  const soll = new Set(flaeche().map((x) => x.datei));
  const ist = new Set(erg.geprueft);
  const fehlend = [...soll].filter((f) => !ist.has(f));
  const fremd = [...ist].filter((f) => !soll.has(f));

  if (fehlend.length) {
    console.error(`\nLauf UNVOLLSTAENDIG: zu ${fehlend.length} von ${soll.size} Dateien fehlt ein Urteil.`);
    for (const f of fehlend.slice(0, 20)) console.error(`  ${f}`);
    if (fehlend.length > 20) console.error(`  … und ${fehlend.length - 20} weitere`);
    console.error('\nEs wurde NICHTS geschrieben. Der Rest der Pruefflaeche muss nachgeholt');
    console.error('werden, sonst wuerde ein abgebrochener Lauf den Stand leer raeumen.');
    process.exit(1);
  }
  if (fremd.length) {
    console.error(`\nFEHLER: ${fremd.length} geprueft(e) Datei(en) gehoeren nicht zur Pruefflaeche:`);
    for (const f of fremd.slice(0, 10)) console.error(`  ${f}`);
    console.error('Tippfehler im Pfad, oder die Flaeche in diesem Skript ist veraltet.');
    process.exit(1);
  }

  for (const b of erg.befunde) {
    for (const feld of ['id', 'titel', 'ort', 'schwere']) {
      if (!b[feld]) {
        console.error(`Befund ohne ${feld}: ${JSON.stringify(b).slice(0, 200)}`);
        process.exit(1);
      }
    }
    if (/:\d+$/.test(b.id)) {
      console.error(`Befund-Schluessel "${b.id}" endet auf eine Zeilennummer.`);
      console.error('Schluessel muessen ueber Namen laufen (Routenpfad, Tabelle, Regel),');
      console.error('sonst gilt derselbe Befund nach dem naechsten Edit als neu.');
      process.exit(1);
    }
  }

  const alt = ladeStand();
  const alteIds = new Map(alt.befunde.map((b) => [b.id, b]));
  const neueIds = new Map(erg.befunde.map((b) => [b.id, b]));

  const neu = erg.befunde.filter((b) => !alteIds.has(b.id));
  // Nicht wiedergefunden heisst NICHT behoben. Vielleicht hat die Durchsicht
  // diesmal anders hingesehen. Der Befund bleibt stehen, bis jemand ihn von
  // Hand auf "behoben" setzt und dazuschreibt, womit er das belegt.
  const verschwunden = alt.befunde.filter((b) => b.status === 'offen' && !neueIds.has(b.id));

  const zusammen = [];
  for (const b of erg.befunde) {
    const a = alteIds.get(b.id);
    zusammen.push({
      id: b.id,
      titel: b.titel,
      ort: b.ort,
      schwere: b.schwere,
      status: b.status || 'offen',
      belegt_mit: b.belegt_mit || '',
      seit: a?.seit || new Date().toISOString().slice(0, 10),
      zuletzt_gesehen: new Date().toISOString().slice(0, 10),
    });
  }
  for (const b of verschwunden) {
    zusammen.push({ ...b, status: 'nicht_wiedergefunden' });
  }
  // Frueher behobene Befunde bleiben als Gedaechtnis stehen.
  for (const b of alt.befunde) {
    if (b.status !== 'offen' && !neueIds.has(b.id) && !verschwunden.some((v) => v.id === b.id)) {
      zusammen.push(b);
    }
  }

  zusammen.sort((a, b) => a.id.localeCompare(b.id));

  const stand = {
    _hinweis: 'Von scripts/audit-security.mjs --apply geschrieben. Status von Hand auf "behoben" setzen ist erlaubt, dann aber belegt_mit ausfuellen.',
    letzterLauf: new Date().toISOString(),
    geprueft: soll.size,
    befunde: zusammen,
  };
  writeFileSync(STAND, JSON.stringify(stand, null, 2) + '\n');

  console.log(`\nDurchsicht vollstaendig: ${soll.size} Datei(en) beurteilt.`);
  console.log(`  neu:                 ${neu.length}`);
  console.log(`  nicht wiedergefunden: ${verschwunden.length}`);
  console.log(`  Stand gesamt:        ${zusammen.length}`);
  for (const b of neu) console.log(`  + [${b.schwere}] ${b.id} — ${b.titel}`);
  for (const b of verschwunden) console.log(`  ? ${b.id} — war offen, diesmal nicht gesehen (nicht automatisch behoben)`);
  console.log(`\n${STAND} geschrieben.`);
  process.exit(0);
}

console.error('Aufruf: node scripts/audit-security.mjs [--plan | --surface | --apply <datei> | --status | --alarm]');
process.exit(1);
