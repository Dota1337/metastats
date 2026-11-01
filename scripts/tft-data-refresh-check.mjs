#!/usr/bin/env node
/**
 * Erster Schritt von tft-data-refresh.yml: braucht es diese Runde einen Lauf?
 * Schreibt `run` und `alarm` nach $GITHUB_OUTPUT. Quelle nicht erreichbar heisst nur
 * „kein Grund aus dieser Quelle“, nie ein roter Lauf: die Runde danach fragt wieder.
 *
 * Braucht kein `npm ci`, deshalb kostet eine Runde ohne Arbeit Sekunden.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { fetchNotes } from './detect-tft-bpatches.mjs';
import { LISTING_URL, decideRefresh, listingStamp, patchDayAlarm } from './lib/tft-data-freshness.mjs';
import { changesFingerprint, livePatchOf, loadSetChanges, patchesUpTo } from './lib/tft-value-corrections.mjs';

async function attempt(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`WARN ${label}: ${err.message}`);
    return null;
  }
}

const now = new Date();
const meta = JSON.parse(readFileSync('public/tft-set.json', 'utf8'));
const bundle = JSON.parse(readFileSync('public/tft-assets.json', 'utf8'));
const livePatch = livePatchOf(meta, now.toISOString().slice(0, 10));

const listing = await attempt('Listing', async () => {
  const res = await fetch(LISTING_URL, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return listingStamp(await res.text());
});
const notesHash = await attempt('Notes', async () => changesFingerprint(await loadSetChanges(patchesUpTo(meta, livePatch), fetchNotes)));

const { run, reasons } = decideRefresh({
  now,
  manual: process.env.GITHUB_EVENT_NAME === 'workflow_dispatch',
  listing,
  bundleStamp: bundle.sourceStamp ?? null,
  notesHash,
  bundleNotesHash: bundle.notesHash ?? null,
  previousConclusion: process.env.PREVIOUS_CONCLUSION || null,
});
const alarm = patchDayAlarm({ meta, livePatch, bundleStamp: bundle.sourceStamp ?? null, now }) ?? '';

console.log(`Patch ${livePatch}: ${run ? 'Lauf' : 'kein Lauf'} (${reasons.join(', ') || 'nichts Neues'})`);
if (alarm) console.log(`ALARM ${alarm}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${run}\nalarm=${alarm}\n`);
