#!/usr/bin/env node
// Detects the current live TFT set and writes public/tft-set.json so the
// frontend + downstream crawlers know which set's data to display.
//
// Source: CommunityDragon's tft/en_us.json (the de-facto authoritative TFT
// metadata mirror — Riot Data Dragon does not expose a set list directly).
// Strategy: find the highest "number" in setData[] whose mutator matches
// /^TFTSet\d+$/ (no TURBO / no subset variants). That is the live ranked set.
//
// latestPatch kommt aus Riots Terminplan (patchStarts, geschrieben von
// detect-tft-patch-schedule.mjs): patchForDay fuer den Sammeltag, der gerade
// laeuft. ddragon ist nur noch Rueckfall und steht zur Diagnose in
// `ddragonVersion` — der LoL-Patch erscheint dort bis zu zwei Tage nach dem
// TFT-Go-Live, so landeten der 23. und 24.09.2026 als 18.2b in der Datenbank.
// Schluessel, die andere Skripte schreiben (patchStarts, patchScheduleAlerts),
// bleiben erhalten.
//
//   node scripts/detect-tft-set.mjs
//   node scripts/detect-tft-set.mjs --dry-run
//   node scripts/detect-tft-set.mjs --now 2026-10-07T06:00:00Z --ddragon-version 16.20.1 \
//     --cdragon-file cd.json --set-file x.json        # Tests, ohne Netz

import { writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import { SET_LAUNCH_LOL, baseOf, lolPatchFor, patchForDay, startsFor, tftBaseFromLol } from './lib/tft-patch-day.mjs';
import { currentWindowDay } from './lib/tft-crawl-window.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const SOURCE_URL = 'https://raw.communitydragon.org/latest/cdragon/tft/en_us.json';
const OUT = arg('--set-file') || 'public/tft-set.json';

// Riot's CommunityDragon mirror only exposes the internal mutator name
// ("Set17") — the marketing-facing name ("Space Gods") is not in the JSON.
// Hardcoded mapping for the user-visible label, fallback "Set N".
const SET_NAMES = {
  10: 'Remix Rumble',
  11: 'Inkborn Fables',
  12: 'Magic n\' Mayhem',
  13: 'Into the Arcane',
  14: 'Cyber City',
  15: 'K.O. Coliseum',
  16: 'Lore & Legends',
  17: 'Space Gods',
  // Nicht geraten: Riots eigene Stringtable fuehrt DisplayName_TFT_Set18 =
  // "Enchanted Wilds" (game/en_us/data/menu/en_us/tft.stringtable.json,
  // gelesen 2026-08-26). Gegenstelle: crawl-tft-tournaments.mjs TFT_SET_NAMES.
  18: 'Enchanted Wilds',
};

// Fruehester Sammeltag (YYYY-MM-DD), ab dem ein Bump auf das jeweilige Set
// akzeptiert wird. CommunityDragon `latest` folgt dem Live-Client-Build und
// traegt die Set-Daten typischerweise 1-2 Tage VOR dem Release. Ohne dieses
// Gate wuerde der naechtliche Workflow praeemptiv auf das neue Set flippen,
// committen und via deploy-hetzner auf die Box ausrollen — der Crawler
// filtert dann auf ein Set, das noch niemand spielt, und die Aggregate
// laufen leer. Schlimmer: der naechste Lauf wuerde einen manuellen Rollback
// sofort wieder ueberschreiben, es gaebe also faktisch keinen Rueckweg.
// Env-Override SET_BUMP_ALLOWED_AFTER='YYYY-MM-DD' fuer manuelles Vorziehen.
// bumpGate nimmt den spaeteren Wert aus dieser Tabelle und Riots Terminplan.
const SET_BUMP_EARLIEST = {
  // Set 18 "Enchanted Wilds": Riot nennt den 2026-08-26 offiziell
  // (teamfighttactics.leagueoflegends.com — Enchanted Wilds Overview:
  // "when the set goes live on August 26th"), bestaetigt via Liquipedia
  // Patch TFT18.1. Der frueher kursierende 12./13.08. war der urspruengliche
  // Plan — Riot hat die PBE-Phase von 2 auf 4 Wochen verlaengert, weil Set 18
  // das erste Set auf der Unreal Engine ist. Viele Sekundaerquellen
  // (tactics.tools, mobalytics) tragen das alte Datum weiterhin.
  18: '2026-08-26',
  // Set 19: Riots Terminplan nennt TFT 19.1 am 2026-12-01 (gelesen 2026-10-05).
  // Zieht Riot den Termin VOR, warnt bumpGate — dann hier von Hand anpassen.
  19: '2026-12-01',
};

// Der LoL-Anker je Set (SET_LAUNCH_LOL) liegt seit 2026-10-05 in
// scripts/lib/tft-patch-day.mjs — dort rechnen auch Sammler und Umbenennung.

function lookupIPv4(host) {
  return new Promise((resolve, reject) => {
    dnsLookup(host, { family: 4 }, (err, addr) => err ? reject(err) : resolve(addr));
  });
}

async function fetchJSON(url) {
  const u = new URL(url);
  const ip = await lookupIPv4(u.hostname);
  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      host: ip,
      servername: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { Host: u.hostname, 'User-Agent': 'metastats-crawler/1.0' },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

async function fetchLatestPatch() {
  // Riot Data Dragon's versions.json is the authoritative patch list; first entry is latest.
  const url = 'https://ddragon.leagueoflegends.com/api/versions.json';
  const v = await fetchJSON(url);
  return Array.isArray(v) ? v[0] : null;
}

function setOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${key}=${value}\n`);
}

// Ab welchem Sammeltag ein Wechsel auf `set` erlaubt ist: der spaetere Wert aus
// Riots Terminplan (erster Patch der Set) und SET_BUMP_EARLIEST. Der Terminplan
// allein reicht nicht — eine Tabellenzeile, die Riot zu frueh eintraegt, darf
// das Set nicht vorziehen. Die Konstante allein auch nicht — verschiebt Riot
// nach hinten, wartet das Gate mit.
function bumpGate(set, stored) {
  if (process.env.SET_BUMP_ALLOWED_AFTER) return process.env.SET_BUMP_ALLOWED_AFTER;
  const first = startsFor(stored, set)[0]?.from_day;
  const fixed = SET_BUMP_EARLIEST[set];
  if (first && fixed && first < fixed) {
    console.warn(`      WARN: Riots Terminplan nennt fuer Set ${set} den ${first}, SET_BUMP_EARLIEST sagt ${fixed} — Riot hat vorgezogen? Konstante von Hand anpassen.`);
  }
  return [first, fixed].filter(Boolean).sort().at(-1) ?? null;
}

// Basis-Patch ("18.3") fuer den Sammeltag. latestPatch wird bewusst NICHT als
// Rueckfall gelesen: das Skript schriebe sonst seinen eigenen alten Wert fort.
function currentBase(stored, setNumber, ddragonFresh, day) {
  const r = patchForDay(day, { ...stored, setNumber, latestPatch: null }, setNumber);
  if (r.source !== 'fallback') {
    for (const w of r.warnings) console.warn(`      WARN ${w}`);
    return { base: r.base, how: 'Terminplan' };
  }
  // "weder Terminplan noch latestPatch" kommt vom absichtlich geleerten latestPatch.
  for (const w of r.warnings.filter((w) => !w.startsWith('weder Terminplan'))) console.warn(`      WARN ${w}`);
  console.warn(`      WARN Terminplan kennt den Sammeltag ${day} fuer Set ${setNumber} nicht — Rueckfall auf ddragon`);
  if (!SET_LAUNCH_LOL[setNumber]) {
    throw new Error(`Set ${setNumber}: weder Terminplan noch LoL-Anker — node scripts/detect-tft-patch-schedule.mjs laufen lassen oder SET_LAUNCH_LOL in scripts/lib/tft-patch-day.mjs ergaenzen`);
  }
  if (!ddragonFresh) throw new Error(`Set ${setNumber}: kein Termin fuer den Sammeltag ${day} und ddragon nicht erreichbar — nichts geschrieben`);
  const base = tftBaseFromLol(ddragonFresh, setNumber);
  if (!base) throw new Error(`ddragon ${ddragonFresh} passt nicht zum LoL-Anker von Set ${setNumber}`);
  return { base, how: `ddragon ${ddragonFresh} (kein Termin im Terminplan)` };
}

async function main() {
  const now = process.argv.includes('--now') ? new Date(arg('--now')) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error(`--now ungueltig: ${arg('--now')}`);
  const nowIso = now.toISOString();
  const day = currentWindowDay(now);
  const dry = process.argv.includes('--dry-run');
  const stored = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;

  console.log('[1/3] Fetch latest LoL patch from Data Dragon (nur Rueckfall + Diagnose)');
  let ddragonFresh = null;
  if (process.argv.includes('--ddragon-version')) ddragonFresh = arg('--ddragon-version') || null;
  else {
    try { ddragonFresh = await fetchLatestPatch(); }
    catch (e) { console.warn(`      WARN ddragon nicht erreichbar: ${e.message}`); }
  }
  const ddragonVersion = ddragonFresh ?? stored?.ddragonVersion ?? null;
  console.log('      ddragon:', ddragonFresh ?? '—');

  console.log('[2/3] Fetch TFT metadata from CommunityDragon');
  const cdFile = arg('--cdragon-file');
  const cd = cdFile ? JSON.parse(readFileSync(cdFile, 'utf8')) : await fetchJSON(SOURCE_URL);
  const setData = cd?.setData || [];
  console.log('      setData entries:', setData.length);

  // Pick the live set: highest "number" with a mutator that is exactly
  // "TFTSet<N>" — this filters out TURBO subsets and beta variants.
  const liveSets = setData.filter(s => /^TFTSet\d+$/.test(s.mutator || ''));
  if (liveSets.length === 0) throw new Error('no live set found in CommunityDragon data');
  let live = [...liveSets].sort((a, b) => (b.number || 0) - (a.number || 0))[0];
  const cdragonNumber = live.number;

  // Sets laufen nie rueckwaerts. Zeigt CDragon ein aelteres Set, ist die
  // Quelle kaputt — ein Wechsel wuerde das laufende Set in die Historie
  // schieben und alle Sammler auf das alte umstellen.
  if (stored?.setNumber && live.number < stored.setNumber) {
    throw new Error(`CommunityDragon zeigt hoechstens Set ${live.number}, gespeichert ist Set ${stored.setNumber} — nichts geschrieben`);
  }

  // --- Bump-Gate -----------------------------------------------------------
  // CDragon zeigt das neue Set schon vor dem Live-Go. Wenn wir ihm blind
  // folgen, flippt die ganze Pipeline praeemptiv. Deshalb: ein Bump auf ein
  // Set mit Datums-Gate wird erst ab diesem Sammeltag akzeptiert; davor bleibt
  // das gespeicherte Set stehen. Verglichen wird der laufende Sammeltag
  // (Fenster ab 05:00 UTC), nicht der Kalendertag — sonst flippte ein Lauf
  // zwischen 00:00 und 05:00 UTC einen Sammeltag zu frueh.
  if (stored?.setNumber && live.number > stored.setNumber) {
    const gate = bumpGate(live.number, stored);
    if (gate && day < gate) {
      console.warn(`      GATE: CDragon zeigt Set ${live.number}, aber Bump erst ab Sammeltag ${gate} erlaubt (laufender Sammeltag ${day}).`);
      console.warn(`      -> bleibe auf Set ${stored.setNumber}. Vorziehen via SET_BUMP_ALLOWED_AFTER.`);
      const held = liveSets.find(s => s.number === stored.setNumber);
      if (!held) throw new Error(`Set ${stored.setNumber} nicht mehr in CDragon — Gate kann nicht halten.`);
      live = held;
      setOutput('set-bump-gated', String(cdragonNumber));
    } else if (!gate) {
      // Kein Gate hinterlegt: nicht still durchwinken, sondern sichtbar machen.
      console.warn(`      WARN: Bump auf Set ${live.number} ohne SET_BUMP_EARLIEST-Eintrag und ohne Terminplan — ungated.`);
    }
  }
  // -------------------------------------------------------------------------

  const displayName = SET_NAMES[live.number] || `Set ${live.number}`;
  console.log(`      live set: ${live.number} "${displayName}" (mutator ${live.mutator})`);

  console.log('[3/3] Patch fuer den laufenden Sammeltag + write');
  const changed = !stored || stored.setNumber !== live.number;
  const { base, how } = currentBase(stored, live.number, ddragonFresh, day);
  // patchOverride ist der Hand-Eingriff fuer Sonderfaelle. Ein Set-Wechsel
  // raeumt ihn ab — sonst truege Set 19 noch ein "18.6b".
  const override = changed ? null : (stored?.patchOverride || null);
  if (override && baseOf(override) !== base) {
    console.warn(`      WARN patchOverride ${override} passt nicht zum Terminplan (${base}) — veraltet? In ${OUT} von Hand entfernen.`);
  }
  const latestPatch = override || base;
  const lolPatch = lolPatchFor(latestPatch);
  if (!lolPatch) console.warn(`      WARN kein LoL-Anker fuer ${latestPatch} — SET_LAUNCH_LOL in scripts/lib/tft-patch-day.mjs ergaenzen, sonst bleibt lolPatch leer.`);
  console.log(`      Sammeltag ${day}: TFT ${latestPatch}${override ? ' (override)' : ''} aus ${how}, LoL ${lolPatch ?? '—'}`);
  if (ddragonVersion && lolPatch && baseOf(ddragonVersion) !== lolPatch) {
    console.log(`      Hinweis: ddragon meldet ${ddragonVersion}, der Terminplan LoL ${lolPatch} — ddragon hinkt nach einem Go-Live bis zu zwei Tage hinterher.`);
  }

  // Set-Start/-Ende aus der Riot-Roadmap, falls gecrawlt. Bei einem Set-Wechsel
  // gelten die alten Daten nicht mehr; ohne Roadmap-Eintrag liefert Riots
  // Terminplan den Start (erster Patch der Set).
  let setStartDate = changed ? null : (stored?.setStartDate ?? null);
  let setEndDate = changed ? null : (stored?.setEndDate ?? null);
  const ROADMAP = 'public/tft-roadmap.json';
  if (existsSync(ROADMAP)) {
    try {
      const roadmap = JSON.parse(readFileSync(ROADMAP, 'utf8'));
      const info = roadmap.sets?.[String(live.number)];
      if (info) {
        setStartDate = info.startDate || setStartDate;
        setEndDate = info.endDate || setEndDate;
      }
    } catch {}
  }
  setStartDate ??= startsFor(stored, live.number)[0]?.from_day ?? null;

  const payload = {
    setNumber: live.number,
    setName: displayName,
    mutator: live.mutator,
    latestPatch,
    lolPatch,                          // LoL-Patch derselben Woche, aus latestPatch gerechnet
    ddragonVersion,                    // nur Diagnose: was ddragon zuletzt gemeldet hat
    patchOverride: override,
    detectedAt: stored?.detectedAt && !changed ? stored.detectedAt : nowIso,
    lastCheckedAt: nowIso,
    history: stored?.history || [],
    setStartDate,
    setEndDate,
    // B-Patch-Schnitte (scripts/detect-tft-bpatches.mjs) erhalten, bei Set-Wechsel leeren.
    patchCuts: changed ? [] : (stored?.patchCuts || []),
  };
  if (changed && stored?.setNumber) {
    payload.history = [
      { setNumber: stored.setNumber, setName: stored.setName, mutator: stored.mutator, endedAt: nowIso },
      ...(stored.history || []),
    ];
    console.log(`      DETECTED: set ${stored.setNumber} -> ${live.number}`);
    setOutput('set-changed', 'true');
    setOutput('previous-set', String(stored.setNumber));
    setOutput('new-set', String(live.number));
  } else {
    console.log('      no bump');
    setOutput('set-changed', 'false');
  }

  // Schluessel anderer Skripte (patchStarts, patchScheduleAlerts, …) bleiben
  // unveraendert, in ihrer bisherigen Reihenfolge hinten.
  const next = { ...payload };
  for (const [k, v] of Object.entries(stored ?? {})) if (!(k in next)) next[k] = v;
  if (dry) {
    console.log('      --dry-run: nichts geschrieben');
    return;
  }
  writeFileSync(OUT, JSON.stringify(next, null, 2) + '\n');
  console.log(`      -> ${OUT}`);
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
