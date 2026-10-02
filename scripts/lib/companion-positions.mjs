// Reine Rechenlogik fuer die Companion-Aufstellungsdaten — ohne DB, ohne
// Riot, damit sie testbar ist. Genutzt von
// scripts/aggregate-position-observations.mjs.
//
// Warum eine Komplett-Neuberechnung statt Aufaddieren: Der alte Aggregator
// las die bestehende Zelle, addierte die neuen Beobachtungen und schrieb
// zurueck. Jede Nachverarbeitung zaehlte damit doppelt, und ein Lesefehler
// (`.catch(() => [])`) ueberschrieb die Summe mit dem Wert eines einzigen
// Laufs. Hier entsteht die Tabelle bei jedem Lauf vollstaendig aus den
// Rohbeobachtungen — zweimal laufen ergibt dasselbe wie einmal.

// Spiegel von app/lib/tft-cluster.ts (parseClusterKey + compTraitFamilyKey).
// Die Box laeuft auf Node 20 und kann die .ts-Datei nicht laden. Der Test in
// companion-positions.test.mjs vergleicht beide Fassungen, damit sie nicht
// auseinanderlaufen.
const CLUSTER_RE = /^(.+)@(\d+)_([^#*~]+)(?:\*(\d))?(?:~([A-Za-z]+))?(?:#(.+))?$/;

/** `<trait>@<level>_<carry>…` → `<trait>__<carry>` (Familie wie auf /tft/comps). */
export function familyKeyFromCluster(clusterKey) {
  if (!clusterKey) return null;
  const m = CLUSTER_RE.exec(clusterKey);
  if (!m) return clusterKey;
  return `${m[1]}__${m[3]}`;
}

// Echte Riot-IDs sehen aus wie EUW1_7857995904 / KR_123 / OC1_99. Behelfs-IDs
// der App (LIVE_<ms>_<name>) und Testzeilen (TEST_…) fallen raus.
export function isRiotMatchId(id) {
  return typeof id === 'string' && /^(?!LIVE_|TEST_)[A-Z]+\d*_\d+$/.test(id);
}

// Die App speichert als Beobachter den Riot-Namen (`Name#TAG`), aeltere
// Versionen teils die Konto-ID. Konto-IDs enthalten nie ein '#'.
export function isRiotHandle(observer) {
  return typeof observer === 'string' && observer.includes('#');
}

export const groupKey = (matchId, observer) => `${matchId}|${observer}`;

// Normale + Ranglisten-Spiele. Double Up (1160) und Hyper Roll (1130) haben
// andere Bretter und gehoeren nicht in die Aufstellungs-Karte.
export const POSITION_QUEUES = new Set([1090, 1100]);

/**
 * Rechnet die Zellen-Tabelle komplett aus Rohbeobachtungen.
 *
 * @param {Array<{match_id:string, observer_puuid:string, unit:string, cell:number, observed_at:string}>} observations
 *   nur eigene Bretter (kind='own')
 * @param {Map<string, {familyKey?:string|null, queue?:number|null}>} classes
 *   Zuordnung je groupKey(match_id, observer)
 * @returns {{ rows: Array<{cluster_key:string, unit:string, cell:number, observations:number, distinct_matches:number, last_observed_at:string}>, used:number, skipped:number }}
 */
export function aggregateCells(observations, classes) {
  const cells = new Map();
  let used = 0;
  let skipped = 0;
  for (const o of observations) {
    const cls = classes.get(groupKey(o.match_id, o.observer_puuid));
    if (!cls || !cls.familyKey || !POSITION_QUEUES.has(Number(cls.queue))) { skipped++; continue; }
    if (!o.unit || !Number.isInteger(o.cell)) { skipped++; continue; }
    const k = `${cls.familyKey}|${o.unit}|${o.cell}`;
    let c = cells.get(k);
    if (!c) {
      c = { cluster_key: cls.familyKey, unit: o.unit, cell: o.cell, observations: 0, matches: new Set(), last_observed_at: o.observed_at };
      cells.set(k, c);
    }
    c.observations++;
    c.matches.add(o.match_id);
    if (o.observed_at > c.last_observed_at) c.last_observed_at = o.observed_at;
    used++;
  }
  const rows = [...cells.values()].map(({ matches, ...c }) => ({ ...c, distinct_matches: matches.size }));
  return { rows, used, skipped };
}

/** Zeilen, die in der Tabelle stehen, aber nicht mehr zum neuen Stand gehoeren. */
export function staleRows(existing, fresh) {
  const keep = new Set(fresh.map(r => `${r.cluster_key}|${r.unit}|${r.cell}`));
  return existing.filter(r => !keep.has(`${r.cluster_key}|${r.unit}|${r.cell}`));
}
