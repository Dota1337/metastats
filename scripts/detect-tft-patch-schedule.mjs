#!/usr/bin/env node
// Riots TFT-Patch-Terminplan → public/tft-set.json#patchStarts.
//
// Laeuft taeglich in .github/workflows/tft-bpatch-detect.yml VOR der
// B-Patch-Erkennung. Eine Aenderung an tft-set.json wird committet und per
// deploy-hetzner.yml auf die Box gebracht; dort bildet der Sammler daraus den
// Patch-Namen je Sammeltag (scripts/lib/tft-patch-day.mjs).
//
// Danach: Termin erst nach Bestaetigung (G2, Regeln in
// scripts/lib/tft-patch-schedule.mjs confirmStarts). Der juengste gestartete
// Termin der laufenden Set und jeder angehaltene werden gegen Riots Notes,
// MetaTFT und den CDragon-Stempel geprueft; nicht live → `hold`, from_day =
// laufender Sammeltag + 1. PATCH_CONFIRM=0 schaltet die Pruefung ab (bestehende
// Halte-Eintraege bleiben dann unveraendert).
//
// Exit 0  gelesen, bei Aenderung geschrieben
// Exit 1  Fehler, NICHTS geschrieben (Seite unlesbar, Termine widerspruechlich,
//         vergangener Termin geaendert, B-Patches passen nicht mehr dazu)
// Exit 2  geschrieben, aber mit Befund fuer einen Menschen:
//         - oben auf der Seite steht ein NEUER Hinweis auf eine
//           Patch-Verschiebung. Riot verspricht ihn bis 48 h vor dem Termin —
//           die Tabelle zieht womoeglich erst spaeter nach. Ein Mensch prueft und
//           setzt den Termin notfalls mit `pinned: true`. Derselbe Hinweis loest
//           nur einmal aus (gemerkt in patchScheduleAlerts).
//         - ein Termin wurde angehalten, nach einem Halt freigegeben, oder er
//           muesste naeher als 6 Tage an den naechsten ruecken (von Hand
//           entscheiden). Die Auswertung in tft-bpatch-detect.yml macht daraus
//           das Befund-Issue (Zeilen mit BEFUND).
//
//   node scripts/detect-tft-patch-schedule.mjs                  # live
//   node scripts/detect-tft-patch-schedule.mjs --dry-run        # nur anzeigen
//   node scripts/detect-tft-patch-schedule.mjs --file seite.html --today 2026-10-05 --set-file x.json \
//     --now 2026-10-05T02:17:00Z --votes-file stimmen.json      # ohne Netz
//
// --votes-file: eingespielte Quellen-Antworten statt der Abrufe, Aufbau wie
// `observations` in patchVotes: { "notes": { "18.7": "nein" },
// "metatft": { "patch": "18.6", "b_patch_version": "", "start": "…" },
// "cdragon": "2026-11-04T00:47:00.000Z" }. Fehlende Teile zaehlen als unbekannt.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEDULE_URL, parseScheduleHtml, mergeSchedule, isDelayAlert, confirmCandidates, confirmStarts } from './lib/tft-patch-schedule.mjs';
import { scheduleProblems } from './lib/tft-patch-day.mjs';
import { LISTING_URL, listingStamp } from './lib/tft-data-freshness.mjs';
import { currentWindowDay } from './lib/tft-crawl-window.mjs';
import { fetchMetatft, fetchNotes } from './detect-tft-bpatches.mjs';

const UA = 'metastats-bot/1.0 (https://metastats.gg; info@metastats.gg)';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function fetchPage() {
  for (let attempt = 1; ; attempt++) {
    let retry;
    try {
      const r = await fetch(SCHEDULE_URL, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000),
      });
      if (r.ok) return await r.text();
      retry = r.status === 429 || r.status >= 500;
      if (!retry || attempt >= 3) throw new Error(`Terminplan-Seite HTTP ${r.status}`);
    } catch (e) {
      if (retry === false || attempt >= 3) throw e;
    }
    await new Promise((res) => setTimeout(res, 5_000 * attempt));
  }
}

// Quellen-Antworten fuer die Bestaetigung. Jeder Fehler macht nur seine Quelle
// "unbekannt", nie den ganzen Lauf rot.
async function observe(candidates) {
  const [metatft, cdragon] = await Promise.all([
    fetchMetatft().catch((e) => { console.warn(`  WARN MetaTFT nicht lesbar — ${e.message}`); return null; }),
    (async () => {
      const r = await fetch(LISTING_URL, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return listingStamp(await r.text());
    })().catch((e) => { console.warn(`  WARN CDragon-Listing nicht lesbar — ${e.message}`); return null; }),
  ]);
  const notes = {};
  for (const c of candidates) {
    try {
      notes[c.patch] = (await fetchNotes(c.patch)) ? 'ja' : 'nein';
    } catch (e) {
      notes[c.patch] = 'unbekannt';
      console.warn(`  WARN Notes ${c.patch} nicht lesbar — ${e.message}`);
    }
  }
  return { notes, metatft, cdragon };
}

async function main() {
  const setFile = arg('--set-file') || 'public/tft-set.json';
  const file = arg('--file');
  const votesFile = arg('--votes-file');
  const now = arg('--now') ? new Date(arg('--now')) : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error(`--now ungueltig: ${arg('--now')}`);
  const nowIso = now.toISOString();
  const today = arg('--today') || nowIso.slice(0, 10);
  const dry = process.argv.includes('--dry-run');

  const html = file ? readFileSync(file, 'utf8') : await fetchPage();
  const { rows, skipped, alerts } = parseScheduleHtml(html);
  console.log(`Terminplan: ${rows.length} Patches, ${rows[0].patch} am ${rows[0].from_day} bis ${rows.at(-1).patch} am ${rows.at(-1).from_day}`);
  for (const s of skipped) console.log(`  uebersprungen: ${s.label} (${s.date}) — ${s.reason}`);
  for (const a of alerts) console.log(`  Hinweis oben auf der Seite: ${a}`);

  const stored = JSON.parse(readFileSync(setFile, 'utf8'));
  const merged = mergeSchedule(stored.patchStarts, rows, today, nowIso);
  for (const c of merged.changes) console.log(`  ${c}`);
  for (const n of merged.notes) console.warn(`  WARN ${n}`);

  const problems = scheduleProblems({ ...stored, patchStarts: merged.starts });
  if (problems.length) throw new Error(`Terminplan passt nicht zu den gespeicherten Daten: ${problems.join(' | ')}`);

  // Bestaetigung. Was sie aendert, wird gegen die B-Patches geprueft; passt es
  // nicht, bleibt der Terminplan ohne sie stehen und ein Mensch sieht den Befund.
  let starts = merged.starts;
  const findings = [];
  if (process.env.PATCH_CONFIRM === '0') {
    console.log('Bestaetigung abgeschaltet (PATCH_CONFIRM=0) — Halte-Eintraege bleiben, wie sie sind');
  } else {
    const set = Number(stored.setNumber);
    const candidates = confirmCandidates(starts, set, now);
    if (!candidates.length) console.log('Bestaetigung: kein offener Termin');
    else {
      const observations = votesFile ? JSON.parse(readFileSync(votesFile, 'utf8')) : await observe(candidates);
      try {
        const c = confirmStarts(starts, { set, now, nowIso, observations });
        const fresh = scheduleProblems({ ...stored, patchStarts: c.starts });
        if (fresh.length) throw new Error(`passt nicht zu den B-Patches: ${fresh.join(' | ')}`);
        console.log(`Bestaetigung (laufender Sammeltag ${currentWindowDay(now)}, geprueft: ${candidates.map((x) => x.patch).join(', ')}):`);
        for (const x of c.changes) console.log(`  ${x}`);
        for (const x of c.notes) console.log(`  Hinweis: ${x}`);
        findings.push(...c.alerts);
        starts = c.starts;
      } catch (e) {
        findings.push(`Bestaetigung nicht angewendet — ${e.message}`);
      }
    }
  }
  for (const f of findings) console.error(`  BEFUND ${f}`);

  const delays = alerts.filter(isDelayAlert);
  const known = Array.isArray(stored.patchScheduleAlerts) ? stored.patchScheduleAlerts : [];
  const fresh = delays.filter((a) => !known.includes(a));
  const next = { ...stored, patchStarts: starts };
  if (delays.length || 'patchScheduleAlerts' in stored) next.patchScheduleAlerts = delays;

  if (JSON.stringify(next) === JSON.stringify(stored)) console.log(`${setFile} unveraendert`);
  else if (dry) console.log('--dry-run: nichts geschrieben');
  else {
    writeFileSync(setFile, JSON.stringify(next, null, 2) + '\n');
    console.log(`geschrieben: ${setFile}`);
  }

  if (fresh.length) {
    console.error(`ACHTUNG: Riot meldet eine Patch-Verschiebung: ${fresh.join(' | ')}`);
    console.error('  Pruefen, ob die Tabelle das neue Datum schon traegt. Sonst den Termin in public/tft-set.json von Hand setzen (pinned: true).');
  }
  if (fresh.length || findings.length) process.exitCode = 2;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
