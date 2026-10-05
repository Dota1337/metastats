#!/usr/bin/env node
// Riots TFT-Patch-Terminplan → public/tft-set.json#patchStarts.
//
// Laeuft taeglich in .github/workflows/tft-bpatch-detect.yml VOR der
// B-Patch-Erkennung. Eine Aenderung an tft-set.json wird committet und per
// deploy-hetzner.yml auf die Box gebracht; dort bildet der Sammler daraus den
// Patch-Namen je Sammeltag (scripts/lib/tft-patch-day.mjs).
//
// Exit 0  gelesen, bei Aenderung geschrieben
// Exit 1  Fehler, NICHTS geschrieben (Seite unlesbar, Termine widerspruechlich,
//         vergangener Termin geaendert, B-Patches passen nicht mehr dazu)
// Exit 2  geschrieben, aber oben auf der Seite steht ein NEUER Hinweis auf eine
//         Patch-Verschiebung. Riot verspricht ihn bis 48 h vor dem Termin —
//         die Tabelle zieht womoeglich erst spaeter nach. Ein Mensch prueft und
//         setzt den Termin notfalls mit `pinned: true`. Derselbe Hinweis loest
//         nur einmal aus (gemerkt in patchScheduleAlerts).
//
//   node scripts/detect-tft-patch-schedule.mjs                  # live
//   node scripts/detect-tft-patch-schedule.mjs --dry-run        # nur anzeigen
//   node scripts/detect-tft-patch-schedule.mjs --file seite.html --today 2026-10-05 --set-file x.json

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEDULE_URL, parseScheduleHtml, mergeSchedule, isDelayAlert } from './lib/tft-patch-schedule.mjs';
import { scheduleProblems } from './lib/tft-patch-day.mjs';

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

async function main() {
  const setFile = arg('--set-file') || 'public/tft-set.json';
  const file = arg('--file');
  const today = arg('--today') || new Date().toISOString().slice(0, 10);
  const dry = process.argv.includes('--dry-run');

  const html = file ? readFileSync(file, 'utf8') : await fetchPage();
  const { rows, skipped, alerts } = parseScheduleHtml(html);
  console.log(`Terminplan: ${rows.length} Patches, ${rows[0].patch} am ${rows[0].from_day} bis ${rows.at(-1).patch} am ${rows.at(-1).from_day}`);
  for (const s of skipped) console.log(`  uebersprungen: ${s.label} (${s.date}) — ${s.reason}`);
  for (const a of alerts) console.log(`  Hinweis oben auf der Seite: ${a}`);

  const stored = JSON.parse(readFileSync(setFile, 'utf8'));
  const { starts, changes, notes } = mergeSchedule(stored.patchStarts, rows, today, new Date().toISOString());
  for (const c of changes) console.log(`  ${c}`);
  for (const n of notes) console.warn(`  WARN ${n}`);

  const problems = scheduleProblems({ ...stored, patchStarts: starts });
  if (problems.length) throw new Error(`Terminplan passt nicht zu den gespeicherten Daten: ${problems.join(' | ')}`);

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
    process.exitCode = 2;
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
