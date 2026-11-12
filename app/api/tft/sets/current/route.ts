import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { supabaseAdmin } from '../../../../lib/supabase';
import { tftPatchLabel } from '../../../../lib/tft-patch-label';
import { cachedJson, SLOW_CACHE_CONTROL } from '../../../../lib/api-cache';

// Returns everything the SetTimeline UI needs:
//   - current set metadata (number, name, start, end, current patch)
//   - all patches for this set (major from Riot's patch schedule in
//     tft-set.json#patchStarts, B/mini from our own
//     tft_daily_unit_stats.patch distinct values — those are the ones we saw
//     in actual matches, so hotfix patches that don't show up on Riot's
//     support page are still captured)
//   - today's % progress through the set window
//
// `force-dynamic`: skip statisches Pre-Render beim Build — die Route ruft
// einen Supabase-RPC der gelegentlich > 60s braucht und damit den ganzen
// Vercel-Build kippt (Build-Timeout 2026-06-21).
//
// Das frühere `export const revalidate = 3600` stand daneben und war
// wirkungslos: force-dynamic schaltet den Route-Cache ab, den revalidate
// steuern würde. Die Route hat damit seit 2026-06-21 jeden Request voll
// bezahlt — zwei Datei-Reads plus get_tft_distinct_patches_for_set. Die
// Frische regelt jetzt der Cache-Control-Header unten, den der Edge auch
// wirklich auswertet.
export const dynamic = 'force-dynamic';

interface Patch {
  version: string;          // "17.3" / "17.3b"
  date: string;             // ISO YYYY-MM-DD
  isMajor: boolean;         // present in Riot's patch schedule
  isHotfix: boolean;        // detected in DB but not in the schedule (B/c/mini patch)
}

// Riots Terminplan, gepflegt von detect-tft-patch-schedule.mjs (gleiche Quelle
// wie startsFor in scripts/lib/tft-patch-day.mjs). Ersetzt seit 08.11.2026 die
// eingefrorene tft-roadmap.json (Stand Mai 2026, ohne Set 19).
interface PatchStart { set: number; patch: string; from_day: string }
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PATCH = /^\d+\.\d+$/;

function loadJson<T = any>(rel: string): T | null {
  const p = resolve(process.cwd(), 'public', rel);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')) as T; }
  catch { return null; }
}

export async function GET() {
  const tftSet = loadJson<any>('tft-set.json');
  if (!tftSet) {
    return NextResponse.json({ error: 'tft-set.json missing' }, { status: 503 });
  }
  const setNumber: number = tftSet.setNumber;
  const starts: PatchStart[] = (Array.isArray(tftSet.patchStarts) ? tftSet.patchStarts : [])
    .filter((p: PatchStart) => p && p.set === setNumber && PATCH.test(String(p.patch)) && DAY.test(String(p.from_day)))
    .sort((a: PatchStart, b: PatchStart) => a.from_day.localeCompare(b.from_day));
  const startDate = tftSet.setStartDate || starts[0]?.from_day || null;
  // Set-Ende bewusst nur aus tft-set.json: ohne Ende blendet MarketValueHero die
  // Set-Zeitleiste aus, so wie bisher (die Roadmap trug fuer Set 18 auch keins).
  const endDate = tftSet.setEndDate || null;

  // Major patches from Riot's schedule (canonical labels + scheduled dates).
  // We index by base version ("17.3") so DB rows with the same base label
  // can match against them.
  const majorByVersion = new Map<string, string>();
  for (const p of starts) {
    majorByVersion.set(p.patch, p.from_day);
  }

  // Hotfix / B-patches: distinct patches we've actually observed in matches
  // for the current set, with their first-seen day. Covers 17.3b / 17.3c
  // style hotfixes the support page doesn't list. The aggregation runs in
  // Postgres (RPC 0029) so the build-time prerender doesn't have to pull
  // every (patch, day) row across the daily stats table.
  let dbPatches: { patch: string; first_day: string }[] = [];
  try {
    const { data } = await supabaseAdmin
      .rpc('get_tft_distinct_patches_for_set', { p_set: setNumber });
    if (Array.isArray(data)) {
      dbPatches = data
        .filter((r: { patch: string | null }) => !!r.patch)
        .map((r: { patch: string; first_day: string }) => ({ patch: r.patch, first_day: r.first_day }));
    }
  } catch {
    // DB unavailable — degrade to schedule-only patches
  }

  // Merge: every scheduled major (whether already-live or future) + every DB
  // distinct patch. Schedule dates take precedence over DB first_day for
  // major patches; DB-only patches get isHotfix=true.
  const patchMap = new Map<string, Patch>();
  for (const [version, date] of majorByVersion) {
    patchMap.set(version, { version, date, isMajor: true, isHotfix: false });
  }
  for (const { patch, first_day } of dbPatches) {
    // Die DB traegt nur TFT-Namen ("18.5", "18.3b"); tftPatchLabel
    // normalisiert nur die Schreibweise der laufenden Set.
    const tftPatch = tftPatchLabel(patch);
    if (!tftPatch) continue;
    const existing = patchMap.get(tftPatch);
    if (existing) {
      // major patch already covered by the schedule — skip
      continue;
    }
    const base = tftPatch.match(/^(\d+\.\d+)/)?.[1];
    const isMajorBase = base && majorByVersion.has(base) && base === tftPatch;
    patchMap.set(tftPatch, { version: tftPatch, date: first_day, isMajor: !!isMajorBase, isHotfix: !isMajorBase });
  }
  const patches = [...patchMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  // Today's progress through the set window
  const today = new Date().toISOString().slice(0, 10);
  let progressPct: number | null = null;
  if (startDate && endDate) {
    const startMs = new Date(startDate + 'T00:00:00Z').getTime();
    const endMs = new Date(endDate + 'T00:00:00Z').getTime();
    const todayMs = new Date(today + 'T00:00:00Z').getTime();
    if (endMs > startMs) {
      progressPct = Math.max(0, Math.min(100, ((todayMs - startMs) / (endMs - startMs)) * 100));
    }
  }

  // 1h frisch reicht: ein Patch-Drop ist damit binnen einer Stunde in der
  // Timeline. `degraded`, wenn weder Terminplan noch DB Patches geliefert haben —
  // dann waere die Timeline leer, und genau das darf sich nicht festsetzen.
  return cachedJson({
    setNumber,
    setName: tftSet.setName,
    startDate,
    endDate,
    today,
    progressPct,
    currentPatch: tftSet.latestPatch,
    patches,
  }, { cache: SLOW_CACHE_CONTROL, degraded: patches.length === 0 });
}
