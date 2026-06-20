import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { supabase } from '../../../../lib/supabase';
import { tftPatchLabel } from '../../../../lib/tft-patch-label';

// Returns everything the SetTimeline UI needs:
//   - current set metadata (number, name, start, end, current patch)
//   - all patches for this set (major from Riot roadmap, B/mini from our own
//     tft_daily_unit_stats.patch distinct values — those are the ones we saw
//     in actual matches, so hotfix patches that don't show up on Riot's
//     support page are still captured)
//   - today's % progress through the set window
//
// Cached because the data changes at most daily.
// `force-dynamic`: skip statisches Pre-Render beim Build — die Route ruft
// einen Supabase-RPC der gelegentlich > 60s braucht und damit den ganzen
// Vercel-Build kippt (Build-Timeout 2026-06-21). Mit dynamic wird die Route
// erst beim ersten Request evaluiert und über `revalidate` für 1 h gecacht.
export const dynamic = 'force-dynamic';
export const revalidate = 3600;

interface Patch {
  version: string;          // "17.3" / "17.3b"
  date: string;             // ISO YYYY-MM-DD
  isMajor: boolean;         // present in Riot roadmap
  isHotfix: boolean;        // detected in DB but not in roadmap (B/c/mini patch)
}

interface RoadmapPatch { version: string; set: number; date: string }
interface RoadmapShape { patches: RoadmapPatch[]; sets: Record<string, { startDate: string; endDate: string | null; patches: { version: string; date: string }[] }> }

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
  const roadmap = loadJson<RoadmapShape>('tft-roadmap.json');

  const setNumber: number = tftSet.setNumber;
  const setInfo = roadmap?.sets?.[String(setNumber)];
  const startDate = setInfo?.startDate || tftSet.setStartDate || null;
  const endDate = setInfo?.endDate || tftSet.setEndDate || null;

  // Major patches from the roadmap (canonical labels + scheduled dates).
  // We index by base version ("17.3") so DB rows with the same base label
  // can match against them.
  const majorByVersion = new Map<string, string>();
  for (const p of setInfo?.patches || []) {
    majorByVersion.set(p.version, p.date);
  }

  // Hotfix / B-patches: distinct patches we've actually observed in matches
  // for the current set, with their first-seen day. Covers 17.3b / 17.3c
  // style hotfixes the support page doesn't list. The aggregation runs in
  // Postgres (RPC 0029) so the build-time prerender doesn't have to pull
  // every (patch, day) row across the daily stats table.
  let dbPatches: { patch: string; first_day: string }[] = [];
  try {
    const { data } = await supabase
      .rpc('get_tft_distinct_patches_for_set', { p_set: setNumber });
    if (Array.isArray(data)) {
      dbPatches = data
        .filter((r: { patch: string | null }) => !!r.patch)
        .map((r: { patch: string; first_day: string }) => ({ patch: r.patch, first_day: r.first_day }));
    }
  } catch {
    // DB unavailable — degrade to roadmap-only patches
  }

  // Merge: every roadmap major (whether already-live or future) + every DB
  // distinct patch. Roadmap dates take precedence over DB first_day for
  // major patches; DB-only patches get isHotfix=true.
  const patchMap = new Map<string, Patch>();
  for (const [version, date] of majorByVersion) {
    patchMap.set(version, { version, date, isMajor: true, isHotfix: false });
  }
  for (const { patch, first_day } of dbPatches) {
    // DB stores LoL patch labels (e.g. "16.10"); normalise to the TFT
    // marketing label ("17.3") so the timeline shows what the user
    // recognises. tftPatchLabel returns the input unchanged when it's
    // already in TFT form (17.x) or a B-patch ("17.3b").
    const tftPatch = tftPatchLabel(patch);
    if (!tftPatch) continue;
    const existing = patchMap.get(tftPatch);
    if (existing) {
      // major patch already covered by the roadmap — skip
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

  return NextResponse.json({
    setNumber,
    setName: tftSet.setName,
    startDate,
    endDate,
    today,
    progressPct,
    currentPatch: tftSet.latestPatch,
    patches,
  });
}
