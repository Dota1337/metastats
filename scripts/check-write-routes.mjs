#!/usr/bin/env node
// Waechter ueber Routen, die mit dem Allmachts-Schluessel in die Datenbank
// schreiben.
//
// Warum: app/lib/supabase.ts gibt einen Client heraus, der an jeder
// Zeilen-Schutzregel vorbeigeht (SUPABASE_SERVICE_ROLE_KEY). Wer ihn hat, darf
// alles. Lesen damit ist Absicht — der halbe oeffentliche Teil der Seite haengt
// daran. Schreiben ist die gefaehrliche Haelfte: eine neue oeffentliche Route,
// die schreibt und niemanden fragt, ist ein offenes Scheunentor, und heute
// faellt das niemandem auf.
//
// Die Pruefung ist bewusst grob und rein textlich: sie sucht Schreib-Aufrufe
// (.insert/.upsert/.update/.delete) in app/api/**/route.ts und verlangt fuer
// jeden Fund EINEN von drei Nachweisen:
//   1. die Route liegt unter app/api/internal/ (durch die Sitzung geschuetzt)
//   2. sie ruft eine der unten gelisteten Zugangspruefungen auf
//   3. sie steht mit schriftlicher Begruendung in AUSNAHMEN
// Alles andere ist rot.
//
// Grob heisst: sie kann eine Route melden, die in Wahrheit sicher ist. Das ist
// die gewollte Richtung — ein Eintrag mit Begruendung kostet zwei Minuten, eine
// uebersehene offene Schreibroute kostet die Datenbank. Gleiches Muster wie der
// Deckel in check-eslint-budget.mjs: die Liste steht hier im Code, nicht in
// einer Datei, die sich selbst fortschreibt.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const WURZEL = join('app', 'api');

// Schreib-Aufrufe auf dem Supabase-Client. .rpc() steht bewusst NICHT hier:
// die allermeisten RPCs lesen nur, und jeden Aufruf einzeln zu begruenden waere
// Laerm, der den Waechter unglaubwuerdig macht.
const SCHREIBT = /\.(insert|upsert|update|delete)\s*\(/;

// Anerkannte Zugangspruefungen. Erweitern ist erlaubt — aber nur um etwas, das
// den Aufrufer wirklich prueft, nicht um ein selbst ausgestelltes Cookie.
const PRUEFUNGEN = [
  { muster: /cronAuthFailure\s*\(/, name: 'cronAuthFailure() — Vercel-Cron-Geheimnis' },
  { muster: /timingSafeEqual\s*\(/, name: 'HMAC-Signatur ueber den Rumpf' },
];

const AUSNAHMEN = {
  'app/api/summoner/route.ts':
    'Legt beim Abruf die eigenen Match-Daten ab (Cache-Fuellung). Schreibt nur ' +
    'in Zeilen des angefragten Spielers, keine Fremddaten, kein Loeschen.',
  'app/api/player-season-stats/route.ts':
    'Legt die berechnete Saison-Zeile des angefragten Spielers ab. Gleiches ' +
    'Muster wie /api/summoner: Ergebnis-Cache, keine Fremddaten.',
  'app/api/champions/collect/route.ts':
    'Sammelt Champion-Statistik aus High-Elo-Matches und legt das Ergebnis ab. ' +
    'Oeffentlich lesbare Aggregate, keine Nutzerdaten.',
  'app/api/tft/comps/share/route.ts':
    'Oeffentliches Einreichen von Comps ist gewollt. Gedrosselt ueber 5 Eintraege ' +
    'je author_token in 24 h, Zaehlung gegen die Datenbank.',
  'app/api/tft/comps/community/[id]/upvote/route.ts':
    'Oeffentliches Hochstimmen ist gewollt. Ein Primaerschluessel auf ' +
    '(comp_id, author_token) laesst genau eine Stimme zu.',
};

function routen(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...routen(p));
    else if (e === 'route.ts') out.push(p);
  }
  return out;
}

const alle = routen(WURZEL).map((p) => p.split(sep).join('/'));
if (alle.length === 0) {
  console.error(`Keine Routen unter ${WURZEL} gefunden — Pfad falsch oder Baum leer.`);
  process.exit(1);
}

const offen = [];
const gedeckt = [];
const benutzteAusnahmen = new Set();

for (const p of alle) {
  const src = readFileSync(p, 'utf8');
  if (!SCHREIBT.test(src)) continue;

  if (p.startsWith('app/api/internal/')) {
    gedeckt.push(`${p} — unter internal/`);
    continue;
  }
  const treffer = PRUEFUNGEN.find((c) => c.muster.test(src));
  if (treffer) {
    gedeckt.push(`${p} — ${treffer.name}`);
    continue;
  }
  if (AUSNAHMEN[p]) {
    benutzteAusnahmen.add(p);
    gedeckt.push(`${p} — Ausnahme`);
    continue;
  }
  offen.push(p);
}

const totAusnahmen = Object.keys(AUSNAHMEN).filter((p) => !benutzteAusnahmen.has(p));

let fehler = false;

if (offen.length) {
  fehler = true;
  console.error(`\nFEHLER: ${offen.length} oeffentliche Route(n) schreiben ohne erkennbare Zugangspruefung:`);
  for (const p of offen) console.error(`  ${p}`);
  console.error('  Entweder nach app/api/internal/ verschieben, eine Zugangspruefung');
  console.error('  einbauen, oder mit schriftlicher Begruendung in AUSNAHMEN in');
  console.error('  scripts/check-write-routes.mjs eintragen.');
}

if (totAusnahmen.length) {
  fehler = true;
  console.error(`\nFEHLER: ${totAusnahmen.length} Ausnahme(n) greifen nicht mehr:`);
  for (const p of totAusnahmen) console.error(`  ${p}`);
  console.error('  Route umgebaut oder geloescht? Dann den Eintrag aus AUSNAHMEN');
  console.error('  streichen, damit die Liste nicht zur Attrappe wird.');
}

if (fehler) process.exit(1);

console.log(`  Schreib-Routen geprueft (${gedeckt.length} von ${alle.length} schreiben, alle gedeckt).`);
