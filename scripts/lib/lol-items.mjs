/**
 * Gemeinsame Item-Regeln fuer LoL (Sammler, Verdichtung, Build-Aggregator).
 *
 * Warum eine eigene Datei: Die alte Regel "into leer und >= 2000 Gold" traf auf
 * DDragon 16.19.1 genau 154 Items, davon 24x 32xxxx (Arena) und 15x 66xxxx
 * (Sondermodi); Mejai (1600 Gold) fehlte, und Verwandlungen wie Muramana (3042)
 * zaehlten doppelt neben Manamune (3004). Gunmetal Greaves (3172) fehlte in den
 * Stiefel-Listen, weil es in item.json keinen Boots-Tag traegt.
 *
 * Fertiges Item =
 *   id < 10000, auf Summoner's Rift (maps['11']), im Laden (inStore !== false),
 *   nicht weiter baubar ausser per Verwandlung (jedes into-Ziel hat specialRecipe
 *   == diese id), Gesamtgold >= 1400, kein Stiefel, kein Verbrauchs-/Trinket-Item,
 *   kein champion-gebundenes Item.
 * Verwandlungen werden auf ihre Grundform abgebildet (VARIANT_TO_BASE).
 */

export const VARIANT_TO_BASE = new Map([
  [3042, 3004], // Muramana -> Manamune
  [3040, 3003], // Seraph's Embrace -> Archangel's Staff
  [3121, 3119], // Fimbulwinter -> Winter's Approach
  [2530, 2526], // Verwandlungsstufe -> Grundform (DDragon 16.19.1)
]);

export const BOOTS_BASE = 1001;
export const MIN_FINISHED_GOLD = 1400;

export async function fetchItemData(version) {
  const url = `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/item.json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`item.json HTTP ${res.status}`);
  return (await res.json()).data || {};
}

export async function latestDdragonVersion() {
  const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json', { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`versions.json HTTP ${res.status}`);
  return (await res.json())[0];
}

// Die n juengsten Patches als {major, minor}, neuester zuerst. DDragon fuehrt
// mehrere Builds je Patch ('16.19.1', '16.19.0'), deshalb wird entdoppelt.
export async function recentPatches(n = 2) {
  const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json', { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`versions.json HTTP ${res.status}`);
  const out = [];
  for (const v of await res.json()) {
    const m = String(v).match(/^(\d+)\.(\d+)\./);
    if (!m) continue;
    const p = { major: Number(m[1]), minor: Number(m[2]) };
    if (!out.some((q) => q.major === p.major && q.minor === p.minor)) out.push(p);
    if (out.length >= n) break;
  }
  return out;
}

// Schicht fuer das Item-Urteil (app/lib/lol-item-verdict.ts):
// (fertigeItems-1)*3 + Dauerstufe (<25 / 25-30 / >30 min), also 0..17.
// -1 = kein fertiges Item; solche Spiele zaehlen nur zur Gesamtsumme.
export function stratumOf(finishedCount, durationSec) {
  if (!finishedCount) return -1;
  const n = Math.min(6, finishedCount);
  const d = durationSec < 1500 ? 0 : durationSec <= 1800 ? 1 : 2;
  return (n - 1) * 3 + d;
}

// Stiefel = 1001 oder alles, was (auch ueber Zwischenstufen) daraus gebaut wird.
export function bootIds(items) {
  const boots = new Set([BOOTS_BASE]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [id, it] of Object.entries(items)) {
      const n = Number(id);
      if (boots.has(n)) continue;
      if ((it.from || []).some((f) => boots.has(Number(f)))) { boots.add(n); grew = true; }
    }
  }
  return boots;
}

export function finishedItemIds(items) {
  const boots = bootIds(items);
  const out = new Set();
  for (const [id, it] of Object.entries(items)) {
    const n = Number(id);
    if (!(n < 10000)) continue;
    if (!it.maps?.['11']) continue;
    if (it.inStore === false) continue;
    if (it.requiredChampion) continue;
    const tags = it.tags || [];
    if (tags.includes('Consumable') || tags.includes('Trinket')) continue;
    if (boots.has(n)) continue;
    const into = it.into || [];
    const onlyTransforms = into.every((t) => Number(items[t]?.specialRecipe) === n);
    if (!onlyTransforms) continue;
    if ((it.gold?.total || 0) < MIN_FINISHED_GOLD) continue;
    out.add(VARIANT_TO_BASE.get(n) ?? n);
  }
  // Verwandlungsformen haben selbst ein specialRecipe und landen oben evtl.
  // nicht im Set (inStore false). Sie werden ueber normalizeItem abgebildet.
  return out;
}

export function normalizeItem(id) {
  const n = Number(id) || 0;
  return VARIANT_TO_BASE.get(n) ?? n;
}

/**
 * Aus den sechs Inventarplaetzen (item0-5; item6 ist das Trinket) die fertigen
 * Items (Grundform, ohne Doppelte) und den Stiefel ziehen.
 */
export function classifyInventory(slots, finishedSet, bootSet) {
  const finished = [];
  let boots = null;
  for (const raw of slots.slice(0, 6)) {
    const n = Number(raw) || 0;
    if (!n) continue;
    if (bootSet.has(n)) { if (boots == null) boots = n; continue; }
    const base = normalizeItem(n);
    if (finishedSet.has(base) && !finished.includes(base)) finished.push(base);
  }
  return { finished, boots };
}
