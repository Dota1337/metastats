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

import { createHmac } from 'node:crypto';
import { isValidRegion } from './regional-routing.mjs';

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

// "EUW1_7881677153" → "euw1" (null, wenn der Teil vor dem _ keine Region ist)
export function regionFromMatchId(matchId) {
  const p = String(matchId).split('_')[0].toLowerCase();
  return isValidRegion(p) ? p : null;
}

// ---------- Pseudonym statt Riot-Name (ab 10.10.2026) ----------
//
// Ist ein Spiel seiner Comp zugeordnet, braucht niemand mehr den Riot-Namen.
// Der Aggregator schreibt die Zuordnung an die Zeilen und ersetzt den Namen
// durch ein Pseudonym: HMAC ueber Match-ID und Namen mit einem Schluessel, der
// nur auf der Box liegt (COMPANION_PSEUDONYM_KEY). Je Spiel statt je Person —
// zwei Spiele desselben Spielers lassen sich nicht verknuepfen. Gleiche
// Eingabe, gleiches Pseudonym: so erkennt der Aggregator einen spaeten zweiten
// Upload desselben Spiels. Anonym ist das NICHT: Match-ID und Brett fuehren
// ueber Riots oeffentliche Match-Daten zurueck zum Spieler.
//
// Eigene Vorsilbe und kein '#': sonst hielte resolvePuuid im Aggregator das
// Pseudonym fuer eine Konto-ID der alten App.
export const MIN_PSEUDONYM_KEY = 32;
const PSEUDONYM_RE = /^p_[0-9a-f]{24}$/;

export const isPseudonym = (observer) => typeof observer === 'string' && PSEUDONYM_RE.test(observer);

export function pseudonym(matchId, observer, key) {
  if (typeof key !== 'string' || key.length < MIN_PSEUDONYM_KEY) throw new Error('Pseudonym-Schluessel fehlt oder ist zu kurz');
  const who = String(observer).trim().toLowerCase();
  return `p_${createHmac('sha256', key).update(`${matchId}|${who}`).digest('hex').slice(0, 24)}`;
}

// Laenger als 48 h nach dem Hochladen bleibt kein Riot-Name stehen — auch
// wenn die Zuordnung bis dahin nicht geklappt hat (das Spiel zaehlt dann nicht).
export const PRIVACY_DEADLINE_MS = 48 * 60 * 60 * 1000;

// Endgueltig ist nur ein Treffer oder „Spieler steht nicht in diesem Spiel“.
// Alles andere — Riot kennt das Spiel noch nicht (Paket geht beim Ausscheiden
// raus, das Spiel laeuft weiter), Konto nicht gefunden, Comp nicht erkannt,
// Schluessel- oder Netzfehler — wird bis zur Frist wiederholt.
export function isFinalClass(cls) {
  return !!cls && (!!cls.clusterKey || cls.skip === 'not_in_match');
}

/**
 * Soll diese Klartext-Gruppe jetzt versiegelt werden (Zuordnung schreiben,
 * Name raus)? Gruppen ohne eigenes Brett brauchen keine Zuordnung.
 * @param {{own:boolean, oldest:string}} group  oldest = fruehestes observed_at
 */
export function shouldSeal(group, cls, nowMs) {
  if (!group.own) return true;
  return isFinalClass(cls) || nowMs - Date.parse(group.oldest) >= PRIVACY_DEADLINE_MS;
}

/** Spalten, die die Zuordnung an den eigenen Zeilen festhalten. */
export function classColumns(cls, nowIso) {
  return {
    cluster_key: cls?.clusterKey ?? null,
    family_key: cls?.familyKey ?? null,
    queue_id: cls?.queue ?? null,
    classified_at: nowIso,
  };
}

/** Gespeicherte Zuordnung einer eigenen Zeile, oder null wenn noch keine. */
export function storedClass(row) {
  if (!row?.classified_at) return null;
  return { clusterKey: row.cluster_key ?? null, familyKey: row.family_key ?? null, queue: row.queue_id ?? null, stored: true };
}

// Steht dasselbe Spiel schon unter dem Pseudonym (spaeter zweiter Upload),
// scheitert das Umbenennen am Unique-Index. Dann fallen nur die Klartext-
// Zeilen weg, die dort schon stehen; neue Runden kommen dazu — genau wie
// vorher beim Hochladen (ignoreDuplicates in der Submit-Route).
const rowKey = (r) => `${r.kind}|${r.cell}|${r.unit}|${r.round}`;
export function collidingIds(plainRows, sealedRows) {
  const taken = new Set(sealedRows.map(rowKey));
  return plainRows.filter(r => taken.has(rowKey(r))).map(r => r.id);
}

// Normale + Ranglisten-Spiele. Double Up (1160) und Hyper Roll (1130) haben
// andere Bretter und gehoeren nicht in die Aufstellungs-Karte.
export const POSITION_QUEUES = new Set([1090, 1100]);

// Die App liefert Zellen 1-basiert (1-28, gep.ts:21), Heatmap und MetaTFT
// rechnen 0-basiert (Reihe*7+Spalte, Reihe 0 hinten). Geprueft am 2026-10-04
// an zwei Set-18-Spielen: Carrys auf 1-7, Tanks auf 22-28 — Zelle 1 ist
// hinten, also nur verschieben, nicht spiegeln. Dieselbe Umrechnung steht in
// tft_position_unit_cell_data() (Migration 0085).
export const BOARD_CELLS = 28;

/** Rohzelle der App → 0-basierte Brett-Zelle, oder null wenn ausserhalb. */
export function boardCell(rawCell) {
  if (!Number.isInteger(rawCell) || rawCell < 1 || rawCell > BOARD_CELLS) return null;
  return rawCell - 1;
}

// Nur spaete Bretter zeigen die fertige Aufstellung. Runde = Stufe*10+Runde
// (gep.ts:76-80), 41 = Stufe 4-1. Erst ab App 0.3 ist die Runde so kodiert;
// 0.1.0 zaehlte laufend hoch, dort waere 41 eine andere Spielphase.
export const LATE_ROUND = 41;

export function isLateBoard(o) {
  const m = /^(\d+)\.(\d+)/.exec(String(o.client_version || ''));
  if (!m) return false;
  if (Number(m[1]) === 0 && Number(m[2]) < 3) return false;
  return Number(o.round) >= LATE_ROUND;
}

/**
 * Rechnet die Zellen-Tabelle komplett aus Rohbeobachtungen.
 *
 * @param {Array<{match_id:string, observer_puuid:string, unit:string, cell:number, round:number, client_version:string, observed_at:string}>} observations
 *   nur eigene Bretter (kind='own'), Zelle roh aus der App (1-basiert)
 * @param {Map<string, {familyKey?:string|null, queue?:number|null}>} classes
 *   Zuordnung je groupKey(match_id, observer)
 * @returns {{ rows: Array<{cluster_key:string, unit:string, cell:number, observations:number, distinct_matches:number, unit_matches:number, last_observed_at:string}>, used:number, skipped:number }}
 *   `cell` ist 0-basiert. `unit_matches` = Spiele, in denen die Unit in
 *   dieser Comp ueberhaupt stand (auf allen Zeilen der Unit gleich) — daran
 *   entscheidet die Route, ob die eigenen Daten reichen.
 */
export function aggregateCells(observations, classes) {
  const cells = new Map();
  const unitMatches = new Map();
  let used = 0;
  let skipped = 0;
  for (const o of observations) {
    const cls = classes.get(groupKey(o.match_id, o.observer_puuid));
    if (!cls || !cls.familyKey || !POSITION_QUEUES.has(Number(cls.queue))) { skipped++; continue; }
    const cell = boardCell(o.cell);
    if (!o.unit || cell == null || !isLateBoard(o)) { skipped++; continue; }
    const k = `${cls.familyKey}|${o.unit}|${cell}`;
    let c = cells.get(k);
    if (!c) {
      c = { cluster_key: cls.familyKey, unit: o.unit, cell, observations: 0, matches: new Set(), last_observed_at: o.observed_at };
      cells.set(k, c);
    }
    c.observations++;
    c.matches.add(o.match_id);
    if (o.observed_at > c.last_observed_at) c.last_observed_at = o.observed_at;
    const uk = `${cls.familyKey}|${o.unit}`;
    if (!unitMatches.has(uk)) unitMatches.set(uk, new Set());
    unitMatches.get(uk).add(o.match_id);
    used++;
  }
  const rows = [...cells.values()].map(({ matches, ...c }) => ({
    ...c,
    distinct_matches: matches.size,
    unit_matches: unitMatches.get(`${c.cluster_key}|${c.unit}`).size,
  }));
  return { rows, used, skipped };
}

/** Zeilen, die in der Tabelle stehen, aber nicht mehr zum neuen Stand gehoeren. */
export function staleRows(existing, fresh) {
  const keep = new Set(fresh.map(r => `${r.cluster_key}|${r.unit}|${r.cell}`));
  return existing.filter(r => !keep.has(`${r.cluster_key}|${r.unit}|${r.cell}`));
}
