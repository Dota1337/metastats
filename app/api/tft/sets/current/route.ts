import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { supabase } from '../../../../lib/supabase';

// Returns everything the SetTimeline UI needs:
//   - current set metadata (number, name, start, end, current patch)
//   - all patches for this set (major from Riot roadmap, B/mini from our own
//     tft_daily_unit_stats.patch distinct values — those are the ones we saw
//     in actual matches, so hotfix patches that don't show up on Riot's
//     support page are still captured)
//   - today's % progress through the set window
//
// Cached because the data changes at most daily.

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

  // Hotfix / B-patches: SELECT DISTINCT patch FROM tft_daily_unit_stats
  // WHERE set_number = current. These are the patch labels that actually
  // appeared in matches — covers 17.3b / 17.3c style hotfixes the support
  // page doesn't list. min(day) gives us when each first showed up.
  let dbPatches: { patch: string; first_day: string }[] = [];
  try {
    const { data } = await supabase
      .from('tft_daily_unit_stats')
      .select('patch, day')
      .eq('set_number', setNumber)
      .order('day', { ascending: true });
    if (Array.isArray(data)) {
      const seen = new Map<string, string>();
      for (const row of data) {
        if (!row.patch) continue;
        if (!seen.has(row.patch)) seen.set(row.patch, row.day);
      }
      dbPatches = [...seen.entries()].map(([patch, first_day]) => ({ patch, first_day }));
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
    const existing = patchMap.get(patch);
    if (existing) {
      // major patch — keep roadmap date as the canonical one
      continue;
    }
    // Strip trailing letter for the base label match (e.g. "17.3b" → "17.3")
    const base = patch.match(/^(\d+\.\d+)/)?.[1];
    const isMajorBase = base && majorByVersion.has(base) && base === patch;
    patchMap.set(patch, { version: patch, date: first_day, isMajor: !!isMajorBase, isHotfix: !isMajorBase });
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
