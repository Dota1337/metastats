// Comp-Katalog je Crawl-Tag (Phase 2, .claude/plan-current.md a–c, i).
//
// Vor der Regionen-Schleife: decideDay — klassisch oder mit Katalog sammeln.
//   * Schalter aus (COMP_CATALOG_COLLECT≠1) → klassisch.
//   * Anlauf: die Patch-Familie (18.5 + 18.5b) hat vor dem Zieltag weniger als
//     WARMUP_DAYS Tage → klassisch (zu wenig Daten fuer feste Comps).
//   * Katalog-Tag: Version „gueltig ab D“ = eingefroren aus der neuesten Version
//     der Familie, mit den Tagen davor als Eingabe (neue Familien kommen dazu,
//     fehlende Zielstufen werden nachgefuellt). Unveraendert → alte Kennung.
//   * Nachholtag (im Set gibt es schon spaetere Tage): nie eine neue Version,
//     nur eine vorhandene mit Tag ≤ D, sonst klassisch.
//   Jeder Fehler → klassisch, nie Abbruch.
// Nach der Schleife: buildAfterLoop — an klassischen Tagen (Anlauf oder Schalter
// aus) Version D aus allen Tagen der Familie bis D neu, Mindestspiele skaliert;
// nur fuer den neuesten Tag des Sets.
//
// Der Store (comp-catalog-store.mjs) wird hereingereicht, damit die Regeln ohne
// Datenbank testbar sind (comp-catalog-day.test.mjs).

import { buildCatalog, catalogHash, scaledMinGames, CATALOG_RULES } from '../../app/lib/tft-comp-catalog.mjs';
import { patchFamily } from './comp-catalog-store.mjs';

export const CATALOG_FILE_PROTOCOL = 1;
export const WARMUP_DAYS = 3;

const prevDay = d => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/**
 * @returns {Promise<{ mode: 'classic' | 'catalog', reason: string, set: number, patch: string,
 *   catalogId?: number, hash?: string, catalog?: import('../../app/lib/tft-comp-catalog.mjs').Catalog }>}
 */
export async function decideDay({ day, set, patch, switchOn, store, isUnit, log = () => {} }) {
  const base = { set, patch };
  if (!switchOn) return { mode: 'classic', reason: 'switch-off', ...base };
  const family = patchFamily(patch);
  try {
    const rows = (await store.patchDays(set, family)).filter(r => r.day < day);
    const days = [...new Set(rows.map(r => r.day))];
    if (days.length < WARMUP_DAYS) return { mode: 'classic', reason: 'warmup', ...base };

    let v = await store.version(set, family, day);
    if (!v && (await store.hasLaterDay(set, day))) {
      v = await store.latestVersion(set, { family, beforeDay: day, inclusive: true });
      if (!v) return { mode: 'classic', reason: 'gap-no-catalog', ...base };
    }
    if (!v) {
      const prev = await store.latestVersion(set, { family, beforeDay: day });
      const end = prevDay(day);
      const patches = [...new Set(rows.map(r => r.patch))];
      const { families, totalGames } = await store.loadFamilies(set, patches, days[0], end);
      const minGames = scaledMinGames(totalGames);
      const names = prev ? null : (await store.latestVersion(set, { beforeDay: day }))?.catalog ?? null;
      const catalog = prev
        ? buildCatalog(families, { isUnit, prev: prev.catalog, freeze: true, minGames })
        : buildCatalog(families, { isUnit, names, minGames });
      if (prev && catalogHash(catalog) === prev.hash) {
        v = prev;
        log(`[comp-catalog] ${day}: Katalog unveraendert, weiter mit ${prev.catalogId}`);
      } else {
        v = await store.insertVersion({ set, family, day, catalog, inputFrom: days[0], inputTo: end, families: families.length });
        log(`[comp-catalog] ${day}: Version ${v.catalogId} (${catalog.comps.length} Comps aus ${families.length} Familien, `
          + `${prev ? `eingefroren aus ${prev.catalogId}` : 'neu'}, Mindestspiele ${minGames})`);
      }
    }
    if (!v?.catalogId || !v.catalog?.comps?.length) return { mode: 'classic', reason: 'no-catalog', ...base };
    if (v.catalog.version !== CATALOG_RULES.version) return { mode: 'classic', reason: 'rules-version', ...base };
    return { mode: 'catalog', reason: 'catalog-day', catalogId: v.catalogId, hash: v.hash, catalog: v.catalog, ...base };
  } catch (err) {
    log(`[comp-catalog] Tagesentscheid fuer ${day} fehlgeschlagen, sammle klassisch: ${err.message}`);
    return { mode: 'classic', reason: 'error', ...base };
  }
}

/** Version D nach einem klassischen Tag (Anlauf oder Schalter aus). */
export async function buildAfterLoop({ day, set, patch, decision, store, isUnit, log = () => {} }) {
  if (decision?.mode === 'catalog') return { built: false, reason: 'catalog-day' };
  const family = patchFamily(patch);
  if (await store.hasLaterDay(set, day)) return { built: false, reason: 'not-newest' };
  if (await store.version(set, family, day)) return { built: false, reason: 'exists' };
  const rows = (await store.patchDays(set, family)).filter(r => r.day <= day);
  const days = [...new Set(rows.map(r => r.day))];
  if (!days.includes(day)) return { built: false, reason: 'no-data' };
  const patches = [...new Set(rows.map(r => r.patch))];
  const { families, totalGames } = await store.loadFamilies(set, patches, days[0], day);
  const own = await store.latestVersion(set, { family, beforeDay: day });
  const names = own?.catalog ?? (await store.latestVersion(set, { beforeDay: day }))?.catalog ?? null;
  const minGames = scaledMinGames(totalGames);
  const catalog = buildCatalog(families, { isUnit, names, minGames });
  if (catalog.comps.length === 0) return { built: false, reason: 'empty' };
  if (own && catalogHash(catalog) === own.hash) return { built: false, reason: 'unchanged' };
  const v = await store.insertVersion({ set, family, day, catalog, inputFrom: days[0], inputTo: day, families: families.length });
  log(`[comp-catalog] ${day}: Version ${v.catalogId} nach dem Lauf (${catalog.comps.length} Comps aus ${families.length} Familien, `
    + `${totalGames} Spiele, Mindestspiele ${minGames})`);
  return { built: true, catalogId: v.catalogId, comps: catalog.comps.length, families: families.length };
}

/** Inhalt der Katalog-Datei fuer die Kinder (--catalog). */
export function catalogFileBody({ day, decision }) {
  return {
    protocol: CATALOG_FILE_PROTOCOL,
    rulesVersion: decision.catalog.version,
    set: decision.set,
    patch: decision.patch,
    day,
    catalogId: decision.catalogId,
    hash: decision.hash,
    comps: decision.catalog.comps,
  };
}

/**
 * Katalog-Datei im Kind pruefen. Falsch → { ok: false } und das Kind endet mit
 * Exit 3 (der Treiber schreibt die Datei neu und wiederholt einmal).
 */
export function checkCatalogFile(body, { set, patch, day }) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'keine Katalog-Datei' };
  if (body.protocol !== CATALOG_FILE_PROTOCOL) return { ok: false, error: `Protokoll ${body.protocol} statt ${CATALOG_FILE_PROTOCOL}` };
  if (body.rulesVersion !== CATALOG_RULES.version) return { ok: false, error: `Regeln ${body.rulesVersion} statt ${CATALOG_RULES.version}` };
  if (body.set !== set || body.patch !== patch || body.day !== day) {
    return { ok: false, error: `Datei fuer ${body.set}/${body.patch}/${body.day}, Lauf ${set}/${patch}/${day}` };
  }
  if (!Number.isInteger(body.catalogId) || body.catalogId <= 0) return { ok: false, error: 'Katalog-Kennung fehlt' };
  if (!Array.isArray(body.comps) || body.comps.length === 0) return { ok: false, error: 'Katalog ohne Comps' };
  const catalog = { version: body.rulesVersion, comps: body.comps };
  if (catalogHash(catalog) !== body.hash) return { ok: false, error: 'Pruefsumme passt nicht' };
  return { ok: true, catalog, catalogId: body.catalogId, hash: body.hash };
}
