import 'server-only';
// Startdaten der TFT-Uebersichtsseiten, die das Asset-Bundle brauchen: Rising,
// Augments, Builder, Patch-Liste und Patch-Gewinner (Plan 26.10.2026, Regeln in
// start-core.ts). Getrennt von page-start-mirror.ts, damit die Bundles
// (tft-assets-*.json, je ~2 MB) nicht in LoL-Funktionen landen.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Lang } from '../lang-path';
import { CURRENT_SET } from '../current-set';
import { tftAssets } from '../og/data';
import { tftPlayableChampions, type TftAssetsBundle, type TftAugment } from '../tft-cdragon';
import type { AugmentStagesOverride } from '../tft-augment-stages';
import { subsetBundle } from './initial-data';
import { getAvailablePatches, expandBuckets, ALL_REGIONS, type PatchInfo } from '../tft-supabase-reader';
import { previousPatchOf, sumPatchDiffLevels } from '../snapshot-matrix';
import { loadPatchDiff } from '../meta-pulse-diff-snapshot';
import { patchDiffEntries, type PatchDiffEntry } from '../tft-patch-winners';
import { PATCH_WINNERS_START, RISING_START } from '../page-start-queries';
import type { RisingPlayer } from '../tft-hetzner-matches';
import { mirrorStart } from './page-start-mirror';
import { pageStartOn, PAGE_START_BUDGET_MS, rememberStart, withTimeout } from './start-core';

// Kennungen wie die Seiten nachschlagen: findChampion/findItem/findTrait
// (tft-cdragon.ts) suchen zuerst genau, dann ohne Gross/Klein — die DB fuehrt
// manche Kennung klein (`tft17_bardfollower`).
function bundleKeys<T>(map: Record<string, T> | undefined, ids: Iterable<string>): string[] {
  if (!map) return [];
  let lower: Map<string, string> | null = null;
  const out: string[] = [];
  for (const id of ids) {
    if (!id) continue;
    if (map[id]) { out.push(id); continue; }
    if (!lower) lower = new Map(Object.keys(map).map(k => [k.toLowerCase(), k]));
    const k = lower.get(id.toLowerCase());
    if (k) out.push(k);
  }
  return out;
}

// ---------- Aufsteiger ----------

export interface RisingBody {
  hasData?: boolean;
  players: RisingPlayer[];
}

export interface RisingStart {
  body: RisingBody;
  assets: TftAssetsBundle;
}

export async function risingStart(): Promise<RisingStart | null> {
  const bundle = tftAssets();
  if (!bundle) return null;
  const hit = await mirrorStart<RisingBody>('rising', RISING_START);
  if (!hit) return null;
  const units = hit.body.players.flatMap(p => p.topComp?.units || []);
  const assets = subsetBundle(bundle, {
    champions: bundleKeys(bundle.champions, units.map(u => u.characterId)),
    items: bundleKeys(bundle.items, units.flatMap(u => u.items)),
    traitIds: bundleKeys(bundle.traits, hit.body.players.flatMap(p => (p.topComp?.traits || []).map(t => t.name))),
    withAbility: false,
  });
  return { body: hit.body, assets };
}

// ---------- Augments (Katalog, keine Statistik) ----------

export interface AugmentsStart {
  /** Bundle nur mit den gezeigten Augments, Texte nur in `lang` (+ en als Rueckfall). */
  assets: TftAssetsBundle;
  stages: AugmentStagesOverride | null;
  lang: Lang;
}

function readAugmentStages(): AugmentStagesOverride | null {
  try {
    const file = path.join(process.cwd(), 'public', `tft-augment-stages-${CURRENT_SET}.json`);
    const j = JSON.parse(readFileSync(file, 'utf8')) as AugmentStagesOverride;
    return j && typeof j.stages === 'object' ? j : null;
  } catch {
    return null;
  }
}

export function augmentsStart(lang: Lang): Promise<AugmentsStart | null> {
  if (!pageStartOn()) return Promise.resolve(null);
  const bundle = tftAssets();
  if (!bundle) return Promise.resolve(null);
  return rememberStart(`augments:${lang}:${bundle.fetchedAt}`, async () => {
    // Dieselbe Auswahl wie die Seite (augments/page.tsx): active.augments ohne
    // Kopien alter Kennungen.
    const whitelist = bundle.active?.augments;
    if (!whitelist?.length) return null;
    const augments: Record<string, TftAugment> = {};
    for (const id of whitelist) {
      const a = bundle.augments?.[id];
      if (!a || a.aliasOf) continue;
      const i18n: TftAugment['i18n'] = {};
      if (a.i18n?.[lang]) i18n[lang] = a.i18n[lang];
      if (a.i18n?.en) i18n.en = a.i18n.en;
      augments[id] = { ...a, i18n };
    }
    if (Object.keys(augments).length === 0) return null;
    const assets: TftAssetsBundle = {
      ...subsetBundle(bundle, {}),
      augments,
      active: { augments: whitelist.filter(id => !!augments[id]) },
    };
    return { assets, stages: readAugmentStages(), lang };
  });
}

// ---------- Builder: Champion-Pool ----------

export function builderStart(): TftAssetsBundle | null {
  if (!pageStartOn()) return null;
  const bundle = tftAssets();
  if (!bundle) return null;
  // Faehigkeit bleibt drin: der Builder zeigt sie im Champion-Tooltip.
  // Traits fuer die Trait-Leiste geteilter Bretter (?b=). Items laedt der
  // Browser wie bisher mit dem vollen Bundle.
  const pool = tftPlayableChampions(bundle);
  return subsetBundle(bundle, {
    champions: pool.map(c => c.id),
    traitNames: pool.flatMap(c => c.champion.traits ?? []),
  });
}

// ---------- Patch-Liste ----------

export async function patchListStart(): Promise<PatchInfo[] | null> {
  if (!pageStartOn()) return null;
  // Wie /api/tft/available-patches?days=180 — Patchliste je Prozess 6 h
  // zwischengespeichert (tft-supabase-reader.ts), beim Seitenaufbau schon von
  // den Listen genutzt (initial-data.ts).
  const patches = await withTimeout(getAvailablePatches(180), PAGE_START_BUDGET_MS);
  return patches && patches.length > 0 ? patches : null;
}

// ---------- Patch-Gewinner ----------

export interface PatchWinnersBody {
  hasData: boolean;
  currentPatch: string;
  previousPatch: string;
  entity: 'unit';
  patches: PatchInfo[];
  sampleSize: number;
  winners: PatchDiffEntry[];
  losers: PatchDiffEntry[];
}

export interface PatchWinnersStart {
  body: PatchWinnersBody;
  assets: TftAssetsBundle;
}

/**
 * Standardansicht (Units, Master+, alle Regionen) wie /api/tft/patch-diff —
 * aber NUR aus den Dateien der Box. Fehlt eine Seite, gibt es keine
 * Startdaten; der Live-Rueckfall der Route (fetchEntityRows) bleibt dort.
 */
export async function patchWinnersStart(): Promise<PatchWinnersStart | null> {
  if (!pageStartOn()) return null;
  const bundle = tftAssets();
  if (!bundle) return null;
  const bucketLabel = PATCH_WINNERS_START.bucket;
  return rememberStart(`winners:${bucketLabel}`, () => withTimeout((async (): Promise<PatchWinnersStart | null> => {
    const patches = await getAvailablePatches(180);
    if (patches.length === 0) return null;
    const currentPatch = patches[0].patch;
    const previousPatch = previousPatchOf(patches, currentPatch)?.patch ?? null;
    if (!previousPatch || previousPatch === currentPatch) return null;
    const infoOf = (p: string) => patches.find(x => x.patch === p);
    const setNumber = infoOf(currentPatch)?.set_number ?? patches[0].set_number;
    const buckets = expandBuckets(bucketLabel);
    const side = (p: string) => {
      const info = infoOf(p);
      return info
        ? loadPatchDiff({
          entity: 'unit', regions: ALL_REGIONS, bucketLabel, buckets,
          patch: info, set: Number(setNumber), closed: p !== patches[0].patch,
        })
        : Promise.resolve(null);
    };
    const [curr, prev] = await Promise.all([side(currentPatch), side(previousPatch)]);
    if (!curr || !prev) return null;
    const { sampleSize, winners, losers } = patchDiffEntries(sumPatchDiffLevels(curr), sumPatchDiffLevels(prev));
    if (sampleSize === 0) return null;
    const keys = [...winners, ...losers].map(e => e.key);
    return {
      body: { hasData: true, currentPatch, previousPatch, entity: 'unit', patches, sampleSize, winners, losers },
      assets: subsetBundle(bundle, { champions: bundleKeys(bundle.champions, keys), withAbility: false }),
    };
  })(), PAGE_START_BUDGET_MS));
}
