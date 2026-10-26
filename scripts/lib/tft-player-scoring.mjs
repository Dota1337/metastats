// Spieler-Bewertung fuer den Spielervergleich /tft/compare (Plan 2026-10-26,
// Vorlage „TFT Player Scoring Framework — API edition").
//
// Reines Rechenmodul ohne Datenbank und ohne Riot. Der Nachtlauf
// (scripts/build-player-scoring-population.mjs) baut damit die Bezugswerte,
// der Box-Endpunkt /player-scoring bewertet damit einen Spieler. Beide nutzen
// dieselben Funktionen, damit Bezugsspieler und Spieler gleich gemessen werden.
//
// Set-unabhaengig: Kosten und Trait-Stufen kommen aus
// public/tft-assets-<set>.json, der Patch eines Spiels aus public/tft-set.json
// (Sammeltag → Patch-Basis). Kein Set-Literal in diesem Modul.
//
// Abweichungen von der Vorlage (Review 2026-10-26, Gruende im Plan):
//   - Carry und Comp ueber classifyComp, Comp = Familie <trait>__<carry>
//     (die Dokument-Regel waehlt oft den Tank). Archetyp ohne Level-Klausel.
//   - Trait-Punkte = Stufen-Rang aus dem Bundle (Bronze 1 … Prismatisch 4),
//     ohne Traits, die schon ab 1 Unit greifen; Nenner max(Level, Units).
//   - Restgold als Perzentil gegen die Bezugsgruppe statt G_ref = 30.
//   - Lobby ohne bekannte Raenge: E = 4,5 (User-Option d, 2026-10-26).
//   - 1.3/3.2: Differenz schrumpfen, nicht die Teile; nach bekannt/unbekannt
//     geschichtet.
//   - Jeder Spielerwert wird zum Platz unter den Bezugsspielern (50 = typisch).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyComp } from './tft-classify-comp.mjs';
import { familyKeyFromCluster } from './companion-positions.mjs';
import { isOutcomeFinishedItem } from './tft-build-aggregator.mjs';
import { currentWindowDay } from './tft-crawl-window.mjs';
import { patchForDay, startsFor } from './tft-patch-day.mjs';
import { rankScore } from '../../app/lib/tft-rank-score.mjs';

export const SCORING_VERSION = 1;
export const K = 20;                  // Schrumpfung: der Bezugswert zaehlt wie 20 Spiele
export const LAMBDA_ITEMS = 2;        // Brettstaerke: Gewicht je fertigem Item
export const Q_POINTS = 101;          // Stuetzstellen je Verteilung
export const MIN_CELL_N = 30;         // darunter → naechste Stufe der Rueckfallkette
export const MIN_ROW_GAMES = 400;
export const MIN_ROW_PLAYERS = 200;
export const MIN_PAIR_OBS = 300;      // 2.3: Unit-Item-Paar
export const VIABLE_SHARE = 0.01;     // 3.1: spielbare Comp ab 1 % Anteil ...
export const VIABLE_AVG = 4.6;        // ... und Ø-Platz hoechstens 4,6
export const FAM_MIN_GAMES = 30;
export const KNOWN_MIN_RANKS = 6;     // bekannte Lobby: mindestens 6 von 8 Raengen
export const LOBBY_MIN = 1000;        // Lobby-Modell erst ab so vielen bekannten Lobbys
export const LOBBY_FIT_MAX = 20000;   // β aus hoechstens so vielen (gleichmaessig gezogen)
export const BETA_MAX_REL_SE = 0.1;
export const BETA_BOOT = 30;
export const BUCKET_WIDTH = 0.25;
export const BUCKET_MIN = 500;
export const PI_MIN = 100;
export const UNKNOWN_E = 4.5;
export const UNKNOWN_B7 = 0.25;
export const UNKNOWN_C1 = 0.25;
export const PRESENT_MIN_SHARE = 0.05; // Schaden/K.o.s gelten als geliefert ab 5 % Werten > 0
export const BOOT_REPS = 200;
export const BAND_MIN_SHARE = 0.8;
export const RECENT_GAMES = 20;
export const RANGE_GAMES = 60;
export const EARLY_GAMES = 15;
export const REF_SKIP_SET_DAYS = 7;   // Bezugsgruppe: erste Set-Tage nach dem Rang-Reset raus

// Unterwerte. `variantOf`: dieselbe Groesse nur aus Spielen mit bekannter
// Lobby — im Vergleich nutzen alle Spieler dieselbe Fassung.
export const METRICS = Object.freeze([
  { id: '1.1', main: 'results', min: 20 },
  { id: '1.2', main: 'results', min: 20 },
  { id: '1.3', main: 'results', min: 40 },
  { id: '2.1', main: 'board', min: 20 },
  { id: '2.2', main: 'board', min: 20 },
  { id: '2.3', main: 'board', min: 20 },
  { id: '3.1', main: 'range', min: RANGE_GAMES },
  { id: '3.1k', main: 'range', min: RANGE_GAMES, variantOf: '3.1' },
  { id: '3.2', main: 'range', min: 2 },
  { id: '3.3', main: 'range', min: 10 },
  { id: '4.1', main: 'economy', min: 20 },
  { id: '4.2', main: 'economy', min: 20 },
  { id: '5.1', main: 'ceiling', min: 20 },
  { id: '5.1k', main: 'ceiling', min: 40, variantOf: '5.1' },
  { id: '5.2', main: 'ceiling', min: 10 },   // Fallzahl = Top-4-Spiele
  { id: '5.2k', main: 'ceiling', min: 20, variantOf: '5.2' },
  { id: '6.1', main: 'tempo', min: 20 },
  { id: '6.2', main: 'tempo', min: 20 },
]);
export const MAIN_METRICS = Object.freeze(['results', 'board', 'range', 'economy', 'ceiling', 'tempo']);
const MIN_OF = Object.fromEntries(METRICS.map((m) => [m.id, m.min]));

const THIEFS_RE = /thiefsgloves/i;

// ── Kleinkram ───────────────────────────────────────────────────────────────

const clip = (x, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, x));
const round = (x, d) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

/** Startwert fuer den Zufall: FNV-1a ueber einen Text. */
export function seedOf(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Reproduzierbarer Zufall (mulberry32). */
export function rngOf(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Verteilungen ────────────────────────────────────────────────────────────

/** Verteilung als Stuetzstellen: { n, q } mit q[i] = Quantil i/(Q_POINTS-1). */
export function quantiles(values) {
  const v = Float64Array.from(values.filter(Number.isFinite)).sort();
  const n = v.length;
  if (n === 0) return null;
  const q = new Array(Q_POINTS);
  for (let i = 0; i < Q_POINTS; i++) {
    const pos = (i / (Q_POINTS - 1)) * (n - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(n - 1, lo + 1);
    q[i] = round(v[lo] + (v[hi] - v[lo]) * (pos - lo), 4);
  }
  return { n, q };
}

/**
 * Anteil der Verteilung unter x, 0..1. Bei Gleichstand der Mittelrang (wichtig
 * fuer ganze Zahlen wie Level-Abstand oder Restgold): liegen 30 % bei 0, ergibt
 * x = 0 den Wert 0,15.
 */
export function percentileOf(dist, x) {
  const q = dist?.q;
  if (!q || !Number.isFinite(x)) return null;
  const m = q.length - 1;
  if (x < q[0]) return 0;
  if (x > q[m]) return 1;
  let lo = 0;
  while (lo <= m && q[lo] < x) lo++;
  let hi = lo;
  while (hi <= m && q[hi] <= x) hi++;
  if (hi > lo) return (lo + hi - 1) / 2 / m;
  const a = q[lo - 1];
  const b = q[lo];
  return (lo - 1 + (x - a) / (b - a)) / m;
}

// ── Kontext aus Bundle und Patch-Plan ───────────────────────────────────────

const CTX_TTL_MS = 10 * 60_000;
const ctxCache = new Map();

/** Kontext je Set, 10 Minuten zwischengespeichert (Deploys tauschen die Dateien). */
export function loadScoringContext(set, root = process.cwd()) {
  const key = `${set}|${root}`;
  const hit = ctxCache.get(key);
  if (hit && Date.now() - hit.at < CTX_TTL_MS) return hit.ctx;
  const bundle = JSON.parse(readFileSync(resolve(root, `public/tft-assets-${set}.json`), 'utf8'));
  const meta = JSON.parse(readFileSync(resolve(root, 'public/tft-set.json'), 'utf8'));
  const ctx = contextFrom(bundle, meta, set);
  ctxCache.set(key, { at: Date.now(), ctx });
  return ctx;
}

/**
 * Kosten je Unit und Stufen-Rang je Trait. Der Rang ist die Stelle des
 * Bundle-`style` unter allen Stilen der Mehr-Unit-Traits (Set 18: 1,3,5,6 →
 * 1..4). Riots `style` im Match taugt nicht: dort steht 3 fuer Einzel-Traits
 * und 4 fuer Gold (Stichprobe 2026-10-26, 2.878 Traits).
 */
export function contextFrom(bundle, meta, set) {
  const cost = new Map();
  for (const [id, ch] of Object.entries(bundle?.champions || {})) {
    if (typeof ch?.cost === 'number') cost.set(id, ch.cost);
  }
  const multi = Object.entries(bundle?.traits || {}).filter(([, t]) =>
    Array.isArray(t?.tiers) && t.tiers.length > 0 && (t.tiers[0]?.minUnits ?? 0) >= 2);
  const styles = [...new Set(multi.flatMap(([, t]) => t.tiers.map((x) => x?.style)).filter(Number.isFinite))]
    .sort((a, b) => a - b);
  const traitRank = new Map(multi.map(([name, t]) => [name, t.tiers.map((x) => styles.indexOf(x?.style) + 1)]));
  return {
    set: Number(set),
    cost,
    traitRank,
    meta,
    patchOrder: startsFor(meta, set).map((s) => s.patch),
    dayPatch: new Map(),
    strings: new Map(),
  };
}

function patchOfDay(day, ctx) {
  let p = ctx.dayPatch.get(day);
  if (p === undefined) {
    p = patchForDay(day, ctx.meta, ctx.set).base ?? null;
    ctx.dayPatch.set(day, p);
  }
  return p;
}

/** Patch-Basis eines Spiels (Sammeltag, 05:00 UTC), null ausserhalb des Terminplans. */
export function patchOfGame(gameMs, ctx) {
  return patchOfDay(currentWindowDay(new Date(gameMs)), ctx);
}

export function previousPatch(patch, ctx) {
  const i = ctx.patchOrder.indexOf(patch);
  return i > 0 ? ctx.patchOrder[i - 1] : null;
}

function intern(ctx, s) {
  const hit = ctx.strings.get(s);
  if (hit !== undefined) return hit;
  ctx.strings.set(s, s);
  return s;
}

// ── Spiele in einer Form ────────────────────────────────────────────────────

/** Zeile aus tft_player_match_cache. */
export function gameFromCacheRow(r) {
  return {
    matchId: r.match_id,
    region: r.region,
    gameMs: Number(r.game_datetime) || 0,
    placement: Number(r.placement) || 0,
    level: Number(r.level) || 0,
    lastRound: Number(r.last_round) || 0,
    goldLeft: r.gold_left == null ? null : Number(r.gold_left),
    damage: r.total_damage == null ? null : Number(r.total_damage),
    elims: r.players_eliminated == null ? null : Number(r.players_eliminated),
    units: (Array.isArray(r.units) ? r.units : []).map((u) => ({
      id: String(u.characterId || u.character_id || ''),
      star: Number(u.tier) || 1,
      items: Array.isArray(u.items) ? u.items : Array.isArray(u.itemNames) ? u.itemNames : [],
    })),
    traits: (Array.isArray(r.traits) ? r.traits : []).map((t) => ({
      name: String(t.name || ''),
      tier: Number(t.tier_current) || 0,
      num: Number(t.num_units) || 0,
      style: Number(t.style) || 0,
    })),
  };
}

/** Teilnehmer i einer Zeile aus tft_match_lobby (Schluessel siehe tft-match-lobby.mjs). */
export function gameFromLobby(row, i) {
  const p = row.participants[i];
  return {
    matchId: row.match_id,
    region: row.region,
    gameMs: Number(row.game_datetime) || 0,
    placement: Number(p.pl) || 0,
    level: Number(p.lv) || 0,
    lastRound: Number(p.lr) || 0,
    goldLeft: p.g == null ? null : Number(p.g),
    damage: null,
    elims: null,
    units: (p.u || []).map(([id, star, items]) => ({ id: String(id || ''), star: Number(star) || 1, items: items || [] })),
    traits: (p.t || []).map(([name, tier, num, style]) => ({
      name: String(name || ''), tier: Number(tier) || 0, num: Number(num) || 0, style: Number(style) || 0,
    })),
  };
}

function classifyShape(g) {
  return {
    level: g.level,
    traits: g.traits.map((t) => ({ name: t.name, style: t.style, tier_current: t.tier, num_units: t.num })),
    units: g.units.map((u) => ({ character_id: u.id, tier: u.star, itemNames: u.items })),
  };
}

function classify(g, ctx) {
  return classifyComp(classifyShape(g), { currentSet: ctx.set, withAugmentSuffix: false });
}

/** Carry eines Bretts (dieselbe Regel wie die Comp-Seiten). */
export function carryOf(g, ctx) {
  return classify(g, ctx)?.carryUnit || null;
}

/**
 * Merkmale eines Spiels. Traegt alles, was Bezugswerte und Bewertung brauchen,
 * damit der Nachtlauf das Rohspiel danach verwerfen kann.
 */
export function gameFeatures(g, ctx) {
  const day = currentWindowDay(new Date(g.gameMs));
  const cls = classify(g, ctx);
  const carry = cls?.carryUnit || null;
  const carryCost = carry ? ctx.cost.get(carry) ?? null : null;
  const reroll = carryCost != null && carryCost >= 1 && carryCost <= 3 && (cls?.carryStar ?? 0) >= 3;

  let bsi = 0;
  let items = 0;
  let units = 0;
  const pairs = [];
  const itemUnits = [];
  for (const u of g.units) {
    const c = ctx.cost.get(u.id);
    if (!(c >= 1 && c <= 5)) continue;
    units++;
    bsi += c * 3 ** (Math.max(1, u.star) - 1);
    // Thief's Gloves zaehlt als ein Item; die zufaelligen Items darunter
    // sagen nichts ueber die Wahl und fallen fuer 2.3 raus.
    if (u.items.some((i) => THIEFS_RE.test(i))) {
      items++;
      continue;
    }
    const finished = u.items.filter(isOutcomeFinishedItem);
    items += finished.length;
    if (finished.length > 0) {
      itemUnits.push(intern(ctx, u.id));
      for (const it of new Set(finished)) pairs.push(intern(ctx, `${u.id}|${it}`));
    }
  }
  bsi += LAMBDA_ITEMS * items;

  let tp = 0;
  for (const t of g.traits) {
    if (t.tier < 1) continue;
    const r = ctx.traitRank.get(t.name);
    if (r && r[t.tier - 1] > 0) tp += r[t.tier - 1];
  }

  return {
    matchId: g.matchId,
    region: g.region,
    gameMs: g.gameMs,
    patch: patchOfDay(day, ctx),
    P: g.placement,
    level: g.level,
    lr: g.lastRound,
    gold: g.goldLeft,
    dmg: g.damage,
    elims: g.elims,
    carry: carry ? intern(ctx, carry) : null,
    family: cls ? intern(ctx, familyKeyFromCluster(cls.clusterKey)) : null,
    arch: reroll ? 'r' : 'f',
    bsi,
    te: tp / Math.max(g.level, units, 1),
    pairs,
    itemUnits,
  };
}

/**
 * Lobby eines Spiels aus Sicht eines Spielers: Leiterpunkte (vom Nachtlauf
 * nachgetragen, `ranks` in Teilnehmer-Reihenfolge) und Carry aller 8.
 */
export function lobbyEntry(row, puuid, ctx) {
  const parts = Array.isArray(row?.participants) ? row.participants : null;
  if (!parts || parts.length !== 8) return null;
  const selfIdx = parts.findIndex((p) => p.p === puuid);
  if (selfIdx < 0) return null;
  const lpts = Array.isArray(row.ranks) && row.ranks.length === 8
    ? row.ranks.map((v) => (Number.isFinite(v) ? v : null))
    : null;
  const carries = parts.map((_, i) => {
    const c = carryOf(gameFromLobby(row, i), ctx);
    return c ? intern(ctx, c) : null;
  });
  return { selfIdx, lpts, carries, placements: parts.map((p) => Number(p.pl) || 0) };
}

/**
 * Leiterpunkte je Lobby aus den Ranglisten-Treffern des Nachtlaufs
 * ({match_id, idx, tier, rank, lp}, idx = Stelle in participants).
 * @returns {Map<string, (number|null)[]>}
 */
export function lobbyRanks(rows) {
  const out = new Map();
  for (const r of rows) {
    let a = out.get(r.match_id);
    if (!a) {
      a = new Array(8).fill(null);
      out.set(r.match_id, a);
    }
    const i = Number(r.idx);
    const v = rankScore(r.tier, r.rank, Number(r.lp) || 0);
    if (v != null && i >= 0 && i < 8) a[i] = v;
  }
  return out;
}

// ── Lobby-Modell ────────────────────────────────────────────────────────────

/**
 * Erwarteter Platz von Teilnehmer i: 1 + (7/m)·Σ σ(β·(LPt_j − LPt_i)) ueber
 * die m bekannten Gegner. null, wenn die Lobby nicht bekannt ist.
 */
export function expectedPlacement(lpts, i, beta) {
  if (!lpts || !(beta > 0) || lpts[i] == null) return null;
  let known = 0;
  for (const v of lpts) if (v != null) known++;
  if (known < KNOWN_MIN_RANKS) return null;
  let s = 0;
  let m = 0;
  for (let j = 0; j < lpts.length; j++) {
    if (j === i || lpts[j] == null) continue;
    s += sigmoid(beta * (lpts[j] - lpts[i]));
    m++;
  }
  return m > 0 ? 1 + (7 / m) * s : null;
}

// Paare (j vor i?) einer Lobby: x = (LPt_j − LPt_i)/100, y = 1 wenn j vorne.
function lobbyPairs(l) {
  const out = [];
  for (let i = 0; i < 8; i++) {
    if (l.lpts[i] == null) continue;
    for (let j = i + 1; j < 8; j++) {
      if (l.lpts[j] == null) continue;
      out.push((l.lpts[j] - l.lpts[i]) / 100, l.placements[j] < l.placements[i] ? 1 : 0);
    }
  }
  return out;
}

function fitBeta(pairLists, start = 0.5) {
  let b = start;
  for (let it = 0; it < 50; it++) {
    let g = 0;
    let h = 0;
    for (const xs of pairLists) {
      for (let k = 0; k < xs.length; k += 2) {
        const x = xs[k];
        const p = sigmoid(b * x);
        g += (xs[k + 1] - p) * x;
        h += p * (1 - p) * x * x;
      }
    }
    if (!(h > 0)) return null;
    const step = g / h;
    b += step;
    if (Math.abs(step) < 1e-9) break;
  }
  return Number.isFinite(b) ? b : null;
}

/**
 * β, E-Stufen und Konkurrenz-Abschlag π(C) aus bekannten Lobbys.
 * @param {Array<{lpts: (number|null)[], placements: number[], carries: (string|null)[]}>} lobbies
 * @returns {null | {lobbies, beta, se, buckets, pi}} null = zu wenig oder zu unsicher
 */
export function fitLobbyModel(lobbies, seed = 1) {
  const known = lobbies.filter((l) => l.lpts && l.lpts.filter((v) => v != null).length >= KNOWN_MIN_RANKS);
  if (known.length < LOBBY_MIN) return null;
  const step = Math.max(1, Math.ceil(known.length / LOBBY_FIT_MAX));
  const pairLists = known.filter((_, i) => i % step === 0).map(lobbyPairs);
  const b100 = fitBeta(pairLists);
  if (!(b100 > 0)) return null;
  const rng = rngOf(seed);
  const boots = [];
  for (let r = 0; r < BETA_BOOT; r++) {
    const sample = pairLists.map(() => pairLists[Math.floor(rng() * pairLists.length)]);
    const bb = fitBeta(sample, b100);
    if (bb != null) boots.push(bb);
  }
  const mb = mean(boots);
  const se = Math.sqrt(boots.reduce((s, x) => s + (x - mb) ** 2, 0) / Math.max(1, boots.length - 1));
  if (!(se / b100 <= BETA_MAX_REL_SE)) return null;
  const beta = b100 / 100;

  // E-Stufen: 0,25 breit, schwach besetzte mit dem Nachbarn zusammengelegt.
  const raw = new Map();
  const piAcc = new Map();
  for (const l of known) {
    for (let i = 0; i < 8; i++) {
      const E = expectedPlacement(l.lpts, i, beta);
      if (E == null) continue;
      const P = l.placements[i];
      const k = Math.floor((E - 1) / BUCKET_WIDTH);
      const s = raw.get(k) || { n: 0, n7: 0, n4: 0, n1: 0 };
      s.n++;
      if (P >= 7) s.n7++;
      if (P <= 4) s.n4++;
      if (P === 1) s.n1++;
      raw.set(k, s);
      const me = l.carries?.[i];
      if (me) {
        let C = 0;
        for (let j = 0; j < 8; j++) if (j !== i && l.carries[j] === me) C++;
        if (C >= 1) {
          const lvl = Math.min(C, 3);
          const a = piAcc.get(lvl) || { n: 0, s: 0 };
          a.n++;
          a.s += E - P;
          piAcc.set(lvl, a);
        }
      }
    }
  }
  const buckets = [];
  let cur = null;
  for (const k of [...raw.keys()].sort((a, b) => a - b)) {
    const s = raw.get(k);
    if (!cur) cur = { lo: 1 + k * BUCKET_WIDTH, n: 0, n7: 0, n4: 0, n1: 0 };
    cur.n += s.n; cur.n7 += s.n7; cur.n4 += s.n4; cur.n1 += s.n1;
    cur.hi = 1 + (k + 1) * BUCKET_WIDTH;
    if (cur.n >= BUCKET_MIN) { buckets.push(cur); cur = null; }
  }
  if (cur) {
    const last = buckets[buckets.length - 1];
    if (last) { last.n += cur.n; last.n7 += cur.n7; last.n4 += cur.n4; last.n1 += cur.n1; last.hi = cur.hi; }
    else buckets.push(cur);
  }
  const pi = {};
  for (const [lvl, a] of piAcc) if (a.n >= PI_MIN) pi[lvl] = { n: a.n, m: round(a.s / a.n, 4) };
  return {
    lobbies: known.length,
    beta: round(beta, 8),
    se: round(se / 100, 8),
    buckets: buckets.map((b) => ({
      lo: b.lo, hi: b.hi, n: b.n,
      b7: round(b.n7 / b.n, 4),
      c1: b.n4 > 0 ? round(b.n1 / b.n4, 4) : UNKNOWN_C1,
    })),
    pi,
  };
}

function bucketOf(model, E) {
  const bs = model.buckets;
  for (const b of bs) if (E < b.hi) return b;
  return bs[bs.length - 1];
}

function piOf(model, C) {
  for (let l = Math.min(C, 3); l >= 1; l--) if (model.pi?.[l]) return model.pi[l].m;
  return null;
}

// ── Bezugswerte ─────────────────────────────────────────────────────────────

function pushTo(map, key, v) {
  const a = map.get(key);
  if (a) a.push(v);
  else map.set(key, [v]);
}

/** Bezugswerte auf Spielebene aus einer Menge Spiele (Merkmale). */
export function gameCells(list) {
  const byLr = new Map();
  const teBy = new Map();
  const lvlBy = new Map();
  const gold = { 24: [], 58: [] };
  const unitAcc = new Map();
  const pairAcc = new Map();
  const famAcc = new Map();
  const dmgBy = new Map();
  const elimBy = new Map();
  let dmgSeen = 0, dmgPos = 0, elimSeen = 0, elimPos = 0;

  for (const f of list) {
    pushTo(byLr, f.lr, f.bsi);
    pushTo(teBy, `${f.level}|${f.arch}`, f.te);
    pushTo(lvlBy, `${f.lr}|${f.arch}`, f.level);
    if (f.P >= 2 && f.gold != null) gold[f.P <= 4 ? 24 : 58].push(f.gold);
    for (const u of f.itemUnits) {
      const a = unitAcc.get(u) || [0, 0];
      a[0]++; a[1] += f.P;
      unitAcc.set(u, a);
    }
    for (const p of f.pairs) {
      const a = pairAcc.get(p) || [0, 0];
      a[0]++; a[1] += f.P;
      pairAcc.set(p, a);
    }
    if (f.family) {
      const a = famAcc.get(f.family) || [0, 0];
      a[0]++; a[1] += f.P;
      famAcc.set(f.family, a);
    }
    if (f.dmg != null) { dmgSeen++; if (f.dmg > 0) dmgPos++; pushTo(dmgBy, f.P, f.dmg); }
    if (f.elims != null) { elimSeen++; if (f.elims > 0) elimPos++; pushTo(elimBy, f.P, f.elims); }
  }

  // Runden und Mittelwerte mit den Nachbarrunden (±1) gepoolt.
  const pooled = (map, key, keyOf) => {
    const out = [];
    for (const d of [-1, 0, 1]) {
      const a = map.get(keyOf(key + d));
      if (a) for (const v of a) out.push(v);
    }
    return out;
  };
  const bsi = {};
  for (const lr of byLr.keys()) bsi[lr] = quantiles(pooled(byLr, lr, (x) => x));
  const te = {};
  for (const [k, a] of teBy) te[k] = quantiles(a);
  const lvl = {};
  for (const k of lvlBy.keys()) {
    const [lr, arch] = k.split('|');
    const a = pooled(lvlBy, Number(lr), (x) => `${x}|${arch}`);
    lvl[k] = { n: a.length, m: round(mean(a), 4) };
  }
  const dlBy = { r: [], f: [] };
  for (const f of list) {
    const L = lvl[`${f.lr}|${f.arch}`];
    if (L && L.n >= MIN_CELL_N) dlBy[f.arch].push(f.level - L.m);
  }
  const dl = { r: quantiles(dlBy.r), f: quantiles(dlBy.f) };

  // 2.3: δ(u,i) = Ø(u mit ≥ 1 fertigem Item) − Ø(u mit i), ab MIN_PAIR_OBS.
  const delta = {};
  for (const [p, [n, s]] of pairAcc) {
    if (n < MIN_PAIR_OBS) continue;
    const u = unitAcc.get(p.slice(0, p.indexOf('|')));
    if (!u) continue;
    delta[p] = round(u[1] / u[0] - s / n, 4);
  }
  const ifs = [];
  for (const f of list) {
    const v = itemFit(f.pairs, delta);
    if (v != null) ifs.push(v);
  }

  const total = list.length;
  const fam = {};
  for (const [k, [n, s]] of famAcc) if (n >= FAM_MIN_GAMES) fam[k] = [round(n / total, 5), round(s / n, 3), n];

  const byPlacement = (map) => Object.fromEntries([...map].map(([P, a]) => [P, quantiles(a)]));
  return {
    games: total,
    bsi, te, lvl, dl,
    gold: { 24: quantiles(gold[24]), 58: quantiles(gold[58]) },
    delta,
    if: quantiles(ifs),
    fam,
    dmg: dmgSeen > 0 && dmgPos / dmgSeen >= PRESENT_MIN_SHARE ? byPlacement(dmgBy) : null,
    elim: elimSeen > 0 && elimPos / elimSeen >= PRESENT_MIN_SHARE ? byPlacement(elimBy) : null,
  };
}

/** 2.3 je Spiel: Ø δ ueber die Items mit Bezugswert. null ohne solche Items. */
export function itemFit(pairs, delta) {
  let s = 0;
  let n = 0;
  for (const p of pairs) {
    const d = delta?.[p];
    if (d != null) { s += d; n++; }
  }
  return n > 0 ? s / n : null;
}

/**
 * Nachschlagen mit Rueckfallkette: (Patch, Region) → (Patch, alle) →
 * (Vorpatch, alle) → (Set, alle). Nie das Vorset — die Zeilen gehoeren alle
 * zum laufenden Set. Spielerverteilungen: (Region, Set) → (alle, Set).
 */
export function populationLookup(rows, region, ctx) {
  const byKey = new Map(rows.map((r) => [`${r.region}|${r.patch}`, r.dists]));
  const chains = new Map();
  const chain = (patch) => {
    const key = patch ?? '*';
    let c = chains.get(key);
    if (!c) {
      const prev = patch ? previousPatch(patch, ctx) : null;
      c = [
        patch && byKey.get(`${region}|${patch}`),
        patch && byKey.get(`all|${patch}`),
        prev && byKey.get(`all|${prev}`),
        byKey.get('all|*'),
      ].filter(Boolean);
      chains.set(key, c);
    }
    return c;
  };
  const playerRows = [byKey.get(`${region}|*`), byKey.get('all|*')].filter(Boolean);
  return {
    /** erste Stufe, deren Verteilung genug Beobachtungen hat */
    dist(patch, pick) {
      for (const d of chain(patch)) {
        const x = pick(d);
        if (x && x.n >= MIN_CELL_N) return x;
      }
      return null;
    },
    /** erste Stufe, die `test` besteht (zusammengehoerige Teile aus EINER Zeile) */
    row(patch, test) {
      for (const d of chain(patch)) if (test(d)) return d;
      return null;
    },
    lobby(patch) {
      for (const d of chain(patch)) if (d.lobby?.beta > 0) return d.lobby;
      return null;
    },
    players(id) {
      for (const d of playerRows) {
        const x = d.players?.[id];
        if (x && x.n >= MIN_CELL_N) return x;
      }
      return null;
    },
    empty: !byKey.has('all|*'),
  };
}

// ── Bewertung eines Spielers ────────────────────────────────────────────────

/**
 * Werte je Spiel und Merker fuer die Fenster.
 * @param {Array<{f: object, lobby: object|null}>} entries  neuestes Spiel zuerst
 */
export function prepareGames(entries, pop, ctx) {
  const games = entries.map(({ f, lobby }, idx) => {
    const model = pop.lobby(f.patch);
    let E = null;
    let C = null;
    if (lobby) {
      if (model) E = expectedPlacement(lobby.lpts, lobby.selfIdx, model.beta);
      const me = lobby.carries[lobby.selfIdx];
      if (me) C = lobby.carries.filter((c, i) => i !== lobby.selfIdx && c === me).length;
    }
    const known = E != null;
    const P = f.P;
    const R = (known ? E : UNKNOWN_E) - P;

    const bsiD = pop.dist(f.patch, (d) => d.bsi?.[f.lr]);
    const teD = pop.dist(f.patch, (d) => d.te?.[`${f.level}|${f.arch}`]);
    const ifRow = pop.row(f.patch, (d) => d.if?.n >= MIN_CELL_N);
    const IF = ifRow ? itemFit(f.pairs, ifRow.delta) : null;
    const lvlKey = `${f.lr}|${f.arch}`;
    const lvlRow = pop.row(f.patch, (d) => d.lvl?.[lvlKey]?.n >= MIN_CELL_N && d.dl?.[f.arch]?.n >= MIN_CELL_N);
    const goldD = P >= 2 && f.gold != null ? pop.dist(f.patch, (d) => d.gold?.[P <= 4 ? 24 : 58]) : null;
    const bucket = known ? bucketOf(model, E) : null;
    const pi = known && C != null && C >= 1 ? piOf(model, C) : null;
    const X = pi != null ? R - pi : null;
    const dmgD = f.dmg != null ? pop.dist(f.patch, (d) => d.dmg?.[P]) : null;
    const elimD = f.elims != null ? pop.dist(f.patch, (d) => d.elim?.[P]) : null;

    const pct = (d, x) => {
      const p = d ? percentileOf(d, x) : null;
      return p == null ? null : 100 * p;
    };
    const gold = goldD ? pct(goldD, f.gold) : null;
    return {
      idx,
      f,
      P,
      known,
      E,
      R,
      C,
      X,
      s11: (100 * (8 - P)) / 7,
      s12: known ? clip(50 + 12.5 * R) : null,
      g21: pct(bsiD, f.bsi),
      g22: pct(teD, f.te),
      g23: IF != null ? pct(ifRow.if, IF) : null,
      g41: lvlRow ? pct(lvlRow.dl[f.arch], f.level - lvlRow.lvl[lvlKey].m) : null,
      g42: gold == null ? null : 100 - gold,
      w42: P >= 5 ? 1.5 : 1,
      s33: X != null ? clip(50 + 25 * X) : null,
      g61: pct(dmgD, f.dmg),
      g62: pct(elimD, f.elims),
      b7: bucket ? bucket.b7 : UNKNOWN_B7,
      c1: bucket ? bucket.c1 : UNKNOWN_C1,
    };
  });

  // Fenster am ORIGINAL festmachen — der Bootstrap mischt danach nur innerhalb
  // gleicher Merker, damit z. B. „letzte 20" immer 20 Spiele bleiben.
  let knownIdx = 0;
  for (const x of games) {
    x.recent = x.idx < RECENT_GAMES;
    x.win = x.idx < RANGE_GAMES;
    x.wink = x.known && knownIdx++ < RANGE_GAMES;
  }
  // 3.2: erste 15 Spiele je Patch, nur Patches mit vollem Fenster und einem
  // Spiel im Vorpatch (sonst fehlt der Anfang: Set-Start oder kurzer Verlauf).
  const byPatch = new Map();
  for (const x of games) if (x.f.patch) pushTo(byPatch, x.f.patch, x);
  for (const [patch, list] of byPatch) {
    const prev = previousPatch(patch, ctx);
    const ok = list.length >= EARLY_GAMES && prev != null && byPatch.has(prev);
    list.sort((a, b) => a.f.gameMs - b.f.gameMs);
    list.forEach((x, i) => { x.early = ok && i < EARLY_GAMES; });
  }
  for (const x of games) {
    x.early = !!x.early;
    x.stratum = `${x.f.patch}|${+x.known}|${+x.recent}|${+x.win}|${+x.wink}|${+x.early}`;
  }
  return { games, newestPatch: entries[0]?.f.patch ?? null };
}

/** 3.1: spielbare Comps des Patches mit Gewicht (Summe 1). */
export function viableFamilies(pop, patch) {
  const row = pop.row(patch, (d) => d.fam && Object.keys(d.fam).length > 0);
  const out = new Map();
  if (!row) return out;
  let sum = 0;
  for (const [k, [share, avg]] of Object.entries(row.fam)) {
    if (share >= VIABLE_SHARE && avg <= VIABLE_AVG) { out.set(k, share); sum += share; }
  }
  for (const [k, w] of out) out.set(k, w / sum);
  return out;
}

// Mittel nach bekannt/unbekannt geschichtet: Σ_s Anteil_s · (Ø Teil_s − Ø Gesamt_s).
function stratifiedDiff(part, all) {
  let n = 0;
  let s = 0;
  for (const k of [true, false]) {
    const p = part.filter((x) => x.known === k);
    if (p.length === 0) continue;
    const a = all.filter((x) => x.known === k);
    s += p.length * (mean(p.map((x) => x.R)) - mean(a.map((x) => x.R)));
    n += p.length;
  }
  return n > 0 ? s / n : null;
}

function shrunkMean(vals, n0 = K, prior = 50) {
  return (vals.reduce((s, x) => s + x, 0) + n0 * prior) / (vals.length + n0);
}

function rangeScore(list, viable) {
  if (viable.size === 0) return null;
  const byFam = new Map();
  for (const x of list) if (x.f.family) pushTo(byFam, x.f.family, x.R);
  let cov = 0;
  let depth = 0;
  for (const [fam, rs] of byFam) {
    const w = viable.get(fam);
    if (w == null || rs.length < 3) continue;
    cov += w;
    depth += w * clip(50 + 12.5 * (rs.reduce((s, r) => s + r, 0) / (rs.length + K)));
  }
  return 50 * cov + 0.5 * (cov > 0 ? depth / cov : 0);
}

function floorScore(list) {
  const be = mean(list.map((x) => x.b7));
  const b = (list.filter((x) => x.P >= 7).length + K * be) / (list.length + K);
  return -(b - be);
}

function ceilingScore(top) {
  const ce = mean(top.map((x) => x.c1));
  const c = (top.filter((x) => x.P === 1).length + K * ce) / (top.length + K);
  return c - ce;
}

/**
 * Rohwerte (hoeher = besser) und Fallzahlen aller Unterwerte. Rohwert null =
 * zu wenige Spiele. Die Fallzahl steht auch dann, damit die Seite „n/20" zeigt.
 */
export function rawMetrics(list, viable) {
  const v = {};
  const n = {};
  const set = (id, count, fn) => { n[id] = count; v[id] = count >= MIN_OF[id] ? fn() : null; };
  const has = (k) => list.filter((x) => x[k] != null);
  const known = list.filter((x) => x.known);

  set('1.1', list.length, () => -((list.reduce((s, x) => s + x.P, 0) + K * UNKNOWN_E) / (list.length + K)));
  set('1.2', known.length, () => known.reduce((s, x) => s + x.R, 0) / (known.length + K));
  const recent = list.filter((x) => x.recent);
  set('1.3', list.length, () => {
    const d = stratifiedDiff(recent, list);
    return d == null ? null : d * (recent.length / (recent.length + K));
  });
  for (const [id, k] of [['2.1', 'g21'], ['2.2', 'g22'], ['2.3', 'g23'], ['4.1', 'g41'], ['6.1', 'g61'], ['6.2', 'g62']]) {
    const xs = has(k);
    set(id, xs.length, () => shrunkMean(xs.map((x) => x[k])));
  }
  const win = list.filter((x) => x.win);
  set('3.1', win.length, () => rangeScore(win, viable));
  const wink = list.filter((x) => x.wink);
  set('3.1k', wink.length, () => rangeScore(wink, viable));
  const patches = new Map();
  for (const x of list) if (x.early) pushTo(patches, x.f.patch, x);
  set('3.2', patches.size, () => {
    const adapt = [...patches.values()].map((p) => stratifiedDiff(p, list)).filter((x) => x != null);
    if (adapt.length < MIN_OF['3.2']) return null;
    const m = adapt.length * EARLY_GAMES;
    return mean(adapt) * (m / (m + K));
  });
  const xs33 = has('X');
  set('3.3', xs33.length, () => xs33.reduce((s, x) => s + x.X, 0) / (xs33.length + K));
  const g42 = has('g42');
  set('4.2', g42.length, () => {
    const w = g42.reduce((s, x) => s + x.w42, 0);
    return (g42.reduce((s, x) => s + x.w42 * x.g42, 0) + K * 50) / (w + K);
  });
  set('5.1', list.length, () => floorScore(list));
  set('5.1k', known.length, () => floorScore(known));
  const top = list.filter((x) => x.P <= 4);
  set('5.2', top.length, () => ceilingScore(top));
  const topk = known.filter((x) => x.P <= 4);
  set('5.2k', topk.length, () => ceilingScore(topk));
  return { v, n };
}

function bandOf(vals) {
  const ok = vals.filter((x) => x != null).sort((a, b) => a - b);
  if (ok.length < BAND_MIN_SHARE * vals.length || ok.length === 0) return [null, null];
  const at = (p) => ok[Math.min(ok.length - 1, Math.max(0, Math.round(p * (ok.length - 1))))];
  return [at(0.05), at(0.95)];
}

/**
 * Bewertung eines Spielers.
 * @param {Array<{f, lobby}>} entries  neuestes Spiel zuerst, nur laufendes Set
 * @param {ReturnType<typeof populationLookup>} pop
 * @param {{puuid?: string, seed?: number}} [opts]  Startwert sonst aus puuid + neuestem Match
 */
export function scorePlayer(entries, pop, ctx, opts = {}) {
  const { games, newestPatch } = prepareGames(entries, pop, ctx);
  const viable = viableFamilies(pop, newestPatch);
  const toValue = (id, raw) => {
    if (raw == null) return null;
    const d = pop.players(id);
    return d ? round(100 * percentileOf(d, raw), 1) : null;
  };
  const base = rawMetrics(games, viable);

  const strata = new Map();
  for (const x of games) pushTo(strata, x.stratum, x);
  const groups = [...strata.values()];
  const rng = rngOf(opts.seed ?? seedOf(`${opts.puuid ?? ''}|${entries[0]?.f.matchId ?? ''}`));
  const reps = Object.fromEntries(METRICS.map((m) => [m.id, []]));
  for (let b = 0; b < BOOT_REPS && games.length > 0; b++) {
    const sample = [];
    for (const g of groups) for (let k = 0; k < g.length; k++) sample.push(g[Math.floor(rng() * g.length)]);
    const raw = rawMetrics(sample, viable).v;
    for (const m of METRICS) reps[m.id].push(toValue(m.id, raw[m.id]));
  }

  const metrics = METRICS.map((m) => {
    const value = toValue(m.id, base.v[m.id]);
    const [lo, hi] = value == null ? [null, null] : bandOf(reps[m.id]);
    return {
      id: m.id,
      main: m.main,
      variantOf: m.variantOf ?? null,
      value,
      lo,
      hi,
      n: base.n[m.id],
      minN: m.min,
      reps: value == null ? null : reps[m.id],
    };
  });

  const recent = games.slice(0, 10).map((x) => {
    const scores = {
      '1.1': x.s11, '1.2': x.s12, '2.1': x.g21, '2.2': x.g22, '2.3': x.g23,
      '3.3': x.s33, '4.1': x.g41, '4.2': x.g42, '6.1': x.g61, '6.2': x.g62,
    };
    const ok = Object.values(scores).filter((s) => s != null);
    for (const k of Object.keys(scores)) scores[k] = round(scores[k], 1);
    return {
      matchId: x.f.matchId,
      gameMs: x.f.gameMs,
      placement: x.P,
      family: x.f.family,
      carry: x.f.carry,
      known: x.known,
      E: round(x.E, 2),
      R: x.known ? round(x.R, 2) : null,
      C: x.C,
      X: round(x.X, 2),
      scores,
      overall: ok.length ? round(mean(ok), 1) : null,
    };
  });

  return {
    version: SCORING_VERSION,
    games: games.length,
    knownGames: games.filter((x) => x.known).length,
    metrics,
    recent,
  };
}

// ── Bezugswerte bauen (Nachtlauf) ───────────────────────────────────────────

/**
 * Alle Zeilen fuer tft_player_scoring_population eines Sets.
 * @param {Array<{puuid: string, region: string, entries: Array<{f, lobby}>}>} players
 *   Bezugsspieler, Spiele neuestes zuerst (Merkmale aus gameFeatures)
 * @param {Array<{region: string, patch: string|null, lpts, placements, carries}>} lobbies
 *   Lobbys mit nachgetragenen Raengen fuer das Lobby-Modell
 * @returns {Array<{region: string, patch: string, dists: object}>}
 */
export function buildPopulation(players, lobbies, ctx) {
  const groups = new Map();
  const add = (key, f) => pushTo(groups, key, f);
  const playersOf = new Map();
  const addPlayer = (key, puuid) => {
    const s = playersOf.get(key) || new Set();
    s.add(puuid);
    playersOf.set(key, s);
  };
  for (const p of players) {
    for (const { f } of p.entries) {
      for (const key of [`${p.region}|${f.patch ?? '*'}`, `${p.region}|*`, `all|${f.patch ?? '*'}`, 'all|*']) {
        add(key, f);
        addPlayer(key, p.puuid);
      }
    }
  }
  // Mehrfachschluessel bei patch = null ('*' doppelt) entdoppeln.
  for (const [k, list] of groups) groups.set(k, [...new Set(list)]);

  const lobbyGroups = new Map();
  for (const l of lobbies) {
    for (const key of [`${l.region}|${l.patch ?? '*'}`, `all|${l.patch ?? '*'}`, 'all|*']) pushTo(lobbyGroups, key, l);
  }
  for (const [k, list] of lobbyGroups) lobbyGroups.set(k, [...new Set(list)]);

  const rows = [];
  for (const [key, list] of groups) {
    const nPlayers = playersOf.get(key)?.size ?? 0;
    if (list.length < MIN_ROW_GAMES || nPlayers < MIN_ROW_PLAYERS) continue;
    const [region, patch] = key.split('|');
    const dists = gameCells(list);
    dists.players_n = nPlayers;
    dists.lobby = fitLobbyModel(lobbyGroups.get(key) || [], seedOf(key));
    rows.push({ region, patch, dists });
  }

  // Zweiter Durchgang: Rohwerte der Bezugsspieler → Spielerverteilungen je
  // Region und fuer alle (nur Set-Zeilen).
  const raws = new Map();
  for (const p of players) {
    if (p.entries.length === 0) continue;
    const pop = populationLookup(rows, p.region, ctx);
    if (pop.empty) break;
    const { games, newestPatch } = prepareGames(p.entries, pop, ctx);
    const { v } = rawMetrics(games, viableFamilies(pop, newestPatch));
    for (const key of [`${p.region}|*`, 'all|*']) {
      const acc = raws.get(key) || {};
      for (const [id, x] of Object.entries(v)) if (x != null) (acc[id] ||= []).push(x);
      raws.set(key, acc);
    }
  }
  for (const r of rows) {
    if (r.patch !== '*') continue;
    const acc = raws.get(`${r.region}|*`) || {};
    r.dists.players = Object.fromEntries(Object.entries(acc).map(([id, xs]) => [id, quantiles(xs)]));
  }
  return rows;
}
