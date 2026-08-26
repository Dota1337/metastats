#!/usr/bin/env node
// Detects the current live TFT set and writes public/tft-set.json so the
// frontend + downstream crawlers know which set's data to display.
//
// Source: CommunityDragon's tft/en_us.json (the de-facto authoritative TFT
// metadata mirror — Riot Data Dragon does not expose a set list directly).
// Strategy: find the highest "number" in setData[] whose mutator matches
// /^TFTSet\d+$/ (no TURBO / no subset variants). That is the live ranked set.

import { writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';

const SOURCE_URL = 'https://raw.communitydragon.org/latest/cdragon/tft/en_us.json';
const OUT = 'public/tft-set.json';

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

// Fruehestes Datum (UTC, YYYY-MM-DD), ab dem ein Bump auf das jeweilige Set
// akzeptiert wird. CommunityDragon `latest` folgt dem Live-Client-Build und
// traegt die Set-Daten typischerweise 1-2 Tage VOR dem Release. Ohne dieses
// Gate wuerde der naechtliche Workflow praeemptiv auf das neue Set flippen,
// committen und via deploy-hetzner auf die Box ausrollen — der Crawler
// filtert dann auf ein Set, das noch niemand spielt, und die Aggregate
// laufen leer. Schlimmer: der naechste Lauf wuerde einen manuellen Rollback
// sofort wieder ueberschreiben, es gaebe also faktisch keinen Rueckweg.
// Env-Override SET_BUMP_ALLOWED_AFTER='YYYY-MM-DD' fuer manuelles Vorziehen.
const SET_BUMP_EARLIEST = {
  // Set 18 "Enchanted Wilds": Riot nennt den 2026-08-26 offiziell
  // (teamfighttactics.leagueoflegends.com — Enchanted Wilds Overview:
  // "when the set goes live on August 26th"), bestaetigt via Liquipedia
  // Patch TFT18.1. Der frueher kursierende 12./13.08. war der urspruengliche
  // Plan — Riot hat die PBE-Phase von 2 auf 4 Wochen verlaengert, weil Set 18
  // das erste Set auf der Unreal Engine ist. Viele Sekundaerquellen
  // (tactics.tools, mobalytics) tragen das alte Datum weiterhin.
  18: '2026-08-26',
};

// TFT-Patch numbering is NOT exposed by any Riot API — Match-V1's
// game_version returns the LoL build (e.g. "16.9.772.8292") and Data Dragon
// only lists LoL versions. The user-visible TFT patch ("17.2") is a marketing
// label that follows the convention `${setNumber}.${nthPatchSinceSetLaunch}`,
// where each new LoL patch ≈ a new TFT patch.
//
// Mapping = the LoL patch where each set launched. From that we derive the
// current TFT patch by subtracting from the current LoL minor version.
// Update this when a new set ships — and bump the launch entry, not delete
// the old ones (history pages may reference old set patches).
// Maps each TFT set to the "anchor" LoL patch — i.e. the LoL patch number
// where minor-diff = 0 (so LoL anchor.N maps to TFT set.N for N >= 1).
// For Set 17: launch TFT 17.1 went live alongside LoL 16.8 on 2026-04-15.
// Current TFT 17.3 corresponds to LoL 16.10, so the anchor is LoL 16.7
// (LoL 16.8 = TFT 17.1, LoL 16.10 = TFT 17.3).
const SET_LAUNCH_LOL = {
  17: '16.7',   // Set 17 "Space Gods" anchors at LoL 16.7 → TFT 17.1 = LoL 16.8
  // Set 18 "Enchanted Wilds" (Release 2026-08-26): LoL stand am 2026-07-31 auf
  // 16.15.1; laut LoL-Patch-Schedule faellt der 26.08. auf LoL 16.17 (Riot
  // zaehlt intern weiter 16.x, das Marketing nennt es 26.17 — game_version
  // liefert 16.17). Anchor = Launch-Minor MINUS 1, also 16.16
  // (LoL 16.17 = TFT 18.1).
  // ACHTUNG: das ist eine Ableitung aus dem Patch-Schedule, KEINE direkte
  // Bestaetigung. AM BUMP-TAG gegen ddragon versions.json UND gegen die erste
  // echte Set-18-game_version verifizieren — ein Off-by-one hier verschiebt
  // JEDES Patch-Label des Sets.
  18: '16.16',
};

function tftPatchFromLol(lolVersion, setNumber) {
  const launch = SET_LAUNCH_LOL[setNumber];
  // Fehlender Anchor ist KEIN harmloser Fallback: der rohe LoL-String wandert
  // via tft-set.json.latestPatch in collect-tft-allranks, das daraus einen
  // plausibel aussehenden, aber falschen Patch wie "18.16" baut und nach
  // Supabase schreibt. Genau das musste Migration 0023 beim Set-17-Bump
  // nachtraeglich reparieren. Lieber laut abbrechen und den alten Stand
  // behalten, als still falsche Labels persistieren.
  if (!launch) {
    console.error(`FATAL: kein SET_LAUNCH_LOL-Anchor fuer Set ${setNumber}.`);
    console.error('       Eintrag in scripts/detect-tft-set.mjs ergaenzen.');
    process.exit(1);
  }
  if (!lolVersion) return lolVersion;
  const [curMajor, curMinor] = lolVersion.split('.').slice(0, 2).map(Number);
  const [launchMajor, launchMinor] = launch.split('.').map(Number);
  if ([curMajor, curMinor, launchMajor, launchMinor].some(n => Number.isNaN(n))) return lolVersion;
  // Riot does roughly 25 LoL patches per year. Cross-year math:
  const yearDiff = curMajor - launchMajor;
  const minorDiff = curMinor - launchMinor;
  const tftMinor = yearDiff * 25 + minorDiff;
  if (tftMinor < 0) return lolVersion;
  return `${setNumber}.${tftMinor}`;
}

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

async function main() {
  console.log('[1/3] Fetch latest LoL patch from Data Dragon');
  const lolPatch = await fetchLatestPatch();
  console.log('      LoL patch:', lolPatch);

  console.log('[2/3] Fetch TFT metadata from CommunityDragon');
  const cd = await fetchJSON(SOURCE_URL);
  const setData = cd?.setData || [];
  console.log('      setData entries:', setData.length);

  // Pick the live set: highest "number" with a mutator that is exactly
  // "TFTSet<N>" — this filters out TURBO subsets and beta variants.
  const liveSets = setData.filter(s => /^TFTSet\d+$/.test(s.mutator || ''));
  if (liveSets.length === 0) {
    console.error('ERROR: no live set found in CommunityDragon data');
    process.exit(1);
  }
  let live = liveSets.sort((a, b) => (b.number || 0) - (a.number || 0))[0];

  // --- Bump-Gate -----------------------------------------------------------
  // CDragon zeigt das neue Set schon vor dem Live-Go. Wenn wir ihm blind
  // folgen, flippt die ganze Pipeline praeemptiv. Deshalb: ein Bump auf ein
  // Set mit Datums-Gate wird erst ab diesem Datum akzeptiert; davor bleibt
  // der gespeicherte Stand stehen (kein Write, kein Commit, kein Deploy).
  const storedNow = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
  if (storedNow?.setNumber && live.number > storedNow.setNumber) {
    const gate = process.env.SET_BUMP_ALLOWED_AFTER || SET_BUMP_EARLIEST[live.number];
    const todayUtc = new Date().toISOString().slice(0, 10);
    if (gate && todayUtc < gate) {
      console.warn(`      GATE: CDragon zeigt Set ${live.number}, aber Bump erst ab ${gate} erlaubt (heute ${todayUtc}).`);
      console.warn(`      -> bleibe auf Set ${storedNow.setNumber}. Vorziehen via SET_BUMP_ALLOWED_AFTER.`);
      const held = liveSets.find(s => s.number === storedNow.setNumber);
      if (!held) {
        console.error(`FATAL: Set ${storedNow.setNumber} nicht mehr in CDragon — Gate kann nicht halten.`);
        process.exit(1);
      }
      live = held;
      setOutput('set-changed', 'false');
      setOutput('set-bump-gated', String(live.number));
    } else if (!gate) {
      // Kein Gate hinterlegt: nicht still durchwinken, sondern sichtbar machen.
      console.warn(`      WARN: Bump auf Set ${live.number} ohne SET_BUMP_EARLIEST-Eintrag — ungated.`);
    }
  }
  // -------------------------------------------------------------------------

  const displayName = SET_NAMES[live.number] || `Set ${live.number}`;
  console.log(`      live set: ${live.number} "${displayName}" (mutator ${live.mutator})`);

  // Compute the TFT-style patch label from the LoL version + set-launch table.
  // patchOverride in the existing tft-set.json wins — set it manually when
  // Riot ships a hotfix like "17.2b" that doesn't line up with a LoL patch.
  console.log('[3/3] Compare against existing tft-set.json + write');
  const stored = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
  const changed = !stored || stored.setNumber !== live.number;

  const derivedTftPatch = tftPatchFromLol(lolPatch, live.number);
  const tftPatch = stored?.patchOverride || derivedTftPatch;
  console.log(`      LoL ${lolPatch} → TFT ${tftPatch}${stored?.patchOverride ? ' (override)' : ''}`);

  // Pull set-start / set-end from the Riot patch-schedule roadmap if it's been
  // crawled. Keeps tft-set.json self-contained for /api/tft/sets/current.
  let setStartDate = stored?.setStartDate ?? null;
  let setEndDate = stored?.setEndDate ?? null;
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

  const payload = {
    setNumber: live.number,
    setName: displayName,
    mutator: live.mutator,
    latestPatch: tftPatch,
    lolPatch,                          // kept around for diagnostics
    patchOverride: stored?.patchOverride || null,
    detectedAt: stored?.detectedAt && !changed ? stored.detectedAt : new Date().toISOString(),
    lastCheckedAt: new Date().toISOString(),
    history: stored?.history || [],
    setStartDate,
    setEndDate,
  };
  if (changed && stored?.setNumber) {
    payload.history = [
      { setNumber: stored.setNumber, setName: stored.setName, mutator: stored.mutator, endedAt: new Date().toISOString() },
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
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
  console.log(`      -> ${OUT}`);
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
