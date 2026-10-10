// Lesen der Overwolf-Spielereignisse (GEP). Reine Funktionen, getestet in
// gep.test.ts. Overwolf liefert verschachtelte Werte mal als Objekt, mal als
// JSON-Text — beide Formen werden angenommen.

export function jsonish<T = unknown>(raw: unknown): T | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as T; } catch { return null; }
  }
  return raw as T;
}

export interface BoardPiece { cell: number; unit: string; level: number; items: string[] }

export function parseBoardPieces(raw: unknown): BoardPiece[] {
  const parsed = jsonish<Record<string, { name?: string; level?: number | string; item_1?: string; item_2?: string; item_3?: string }>>(raw);
  if (!parsed || typeof parsed !== 'object') return [];
  const out: BoardPiece[] = [];
  for (const [key, val] of Object.entries(parsed)) {
    if (!key.startsWith('cell_') || !val || typeof val !== 'object') continue;
    const cell = Number(key.slice(5));
    if (!Number.isFinite(cell)) continue;
    out.push({
      cell,
      unit: String(val.name || ''),
      level: Number(val.level || 1),
      items: [val.item_1, val.item_2, val.item_3].filter((x): x is string => !!x),
    });
  }
  return out;
}

// store.shop_pieces: {"slot_1":{"name":"DA_18_Tristana"}, ...} → 5 Plaetze.
// Gekaufte Plaetze kommen leer, ohne Namen oder als "Sold".
export function parseShop(raw: unknown): Array<string | null> {
  const parsed = jsonish<Record<string, { name?: string } | null>>(raw);
  const out: Array<string | null> = [null, null, null, null, null];
  if (!parsed || typeof parsed !== 'object') return out;
  for (const [key, val] of Object.entries(parsed)) {
    const m = /^slot_(\d)$/.exec(key);
    if (!m) continue;
    const i = Number(m[1]) - 1;
    if (i < 0 || i > 4) continue;
    const name = val?.name ? String(val.name) : '';
    out[i] = name && name.toLowerCase() !== 'sold' ? name : null;
  }
  return out;
}

// me.xp: {"level":7,"current_xp":12,"xp_max":48}
export function parseLevel(raw: unknown): number | null {
  const xp = jsonish<{ level?: number | string }>(raw);
  const lvl = Number(xp?.level);
  return Number.isFinite(lvl) && lvl >= 1 && lvl <= 10 ? lvl : null;
}

// match_info.round_type: {"stage":"3-2","name":"...","type":"PVP"} → "3-2"
export function parseStage(raw: unknown): string | null {
  const rt = jsonish<{ stage?: string }>(raw);
  return rt?.stage && /^\d+-\d+$/.test(rt.stage) ? rt.stage : null;
}

// Art der Runde aus round_type.type. Gemessen (Logs 04.-09.10.): PVP, PVE,
// Carousel. Nur PVP ist ein Kampf gegen einen Spieler (oder seine Kopie).
export type RoundKind = 'pvp' | 'pve' | 'carousel' | 'other';
export function parseRoundKind(raw: unknown): RoundKind | null {
  const rt = jsonish<{ type?: string }>(raw);
  const t = String(rt?.type ?? '').trim().toUpperCase();
  if (!t) return null;
  if (t === 'PVP') return 'pvp';
  if (t === 'PVE') return 'pve';
  if (t === 'CAROUSEL') return 'carousel';
  return 'other';
}

// match_info.item_select: {"item_1":{"name":"DA_Artifact_Dawncore"}, ...} →
// Kennungen in Kartenreihenfolge (links nach rechts). null/leer = keine Auswahl offen.
export function parseItemSelect(raw: unknown): string[] {
  const parsed = jsonish<Record<string, { name?: string } | null>>(raw);
  if (!parsed || typeof parsed !== 'object') return [];
  return Object.entries(parsed)
    .map(([k, v]) => ({ i: Number(/^item_(\d+)$/.exec(k)?.[1]), name: v?.name ? String(v.name) : '' }))
    .filter(x => Number.isInteger(x.i) && x.i >= 1 && x.name)
    .sort((a, b) => a.i - b.i)
    .map(x => x.name);
}

// "3-2" → 32. Fortlaufend und monoton fuer die Brett-Beobachtungen.
export function stageToRound(stage: string | null): number | null {
  if (!stage) return null;
  const [s, r] = stage.split('-').map(Number);
  return Number.isFinite(s) && Number.isFinite(r) ? s * 10 + r : null;
}

// match_info.opponent: {"name":"X","tag_line":"EUW"}
export function parseOpponent(raw: unknown): string | null {
  const o = jsonish<{ name?: string; tag_line?: string }>(raw);
  if (!o?.name) return null;
  return o.tag_line ? `${o.name}#${o.tag_line}` : o.name;
}

// Grobe Runde aus der Spielzeit, nur falls round_type fehlt. Muss nicht Riots
// Zaehlung treffen, nur monoton steigen.
export function gameTimeToRound(gameTimeSec: number): number {
  if (!Number.isFinite(gameTimeSec) || gameTimeSec < 0) return 0;
  return Math.max(0, Math.min(60, Math.floor(gameTimeSec / 35)));
}

// match_info.game_mode ist "TFT" oder "LOL" — nur auf Spiel 5426 noetig, wo
// Kluft und TFT als dasselbe Spiel laufen. 28164/21570 sind immer TFT.
export function isTftMode(mode: unknown): boolean | null {
  if (typeof mode !== 'string' || !mode) return null;
  return mode.toUpperCase() === 'TFT';
}

// ---------- Spiel-Kennungen ----------

// Overwolf fuehrt TFT seit Herbst 2026 als eigenes Spiel 28164 (Instanz
// 281641). 21570 ist die alte TFT-Kennung, 5426 League of Legends, unter der
// TFT frueher mitlief. Muss mit public/manifest.json uebereinstimmen
// (Test in gep.test.ts).
export const TFT_GAME_IDS = [28164, 21570, 5426] as const;
const TFT_ONLY = new Set<number>([28164, 21570]);

// Der League-Client (Launcher). Startet die App schon in der Lobby und meldet
// den Spielmodus (lobby_info.queueId). Bewusst NICHT in TFT_GAME_IDS: sonst
// hielte onGameStart den Client fuer eine laufende Partie.
export const LAUNCHER_IDS = [10902] as const;
export const LAUNCHER_FEATURES = ['game_flow', 'lobby_info', 'summoner_info'];

// TFT-Warteschlangen (Riot queueId). Double Up hat 4 Teams statt 8 Spieler.
export const QUEUE_DOUBLE_UP = 1160;

export function isTftOnlyGame(classId: number | null): boolean {
  return classId != null && TFT_ONLY.has(classId);
}

// Launcher-Meldung: {feature, info:{lobby_info:{queueId:"1100"}, game_flow:{phase:"InProgress"}}}.
export interface LauncherUpdate { queueId?: number | null; phase?: string | null; platform?: string | null }
export function parseLauncherInfo(info: unknown): LauncherUpdate {
  const i = jsonish<Record<string, unknown>>(info) ?? {};
  const out: LauncherUpdate = {};
  const lobby = jsonish<{ queueId?: string | number }>(i.lobby_info);
  if (lobby && 'queueId' in lobby) {
    const q = Number(lobby.queueId);
    out.queueId = Number.isInteger(q) && q > 0 ? q : null;
  }
  const flow = jsonish<{ phase?: string }>(i.game_flow);
  if (flow && 'phase' in flow) out.phase = flow.phase ? String(flow.phase) : null;
  const sum = jsonish<{ platform_id?: string }>(i.summoner_info);
  if (sum && 'platform_id' in sum) out.platform = sum.platform_id ? String(sum.platform_id).toLowerCase() : null;
  return out;
}

// gameInfo.classId, sonst aus der Instanz-ID (281641 → 28164).
export function gameClassId(info: { classId?: number; id?: number } | null | undefined): number | null {
  const c = Number(info?.classId);
  if (Number.isFinite(c) && c > 0) return c;
  const id = Number(info?.id);
  return Number.isFinite(id) && id > 0 ? Math.floor(id / 10) : null;
}

export function isTftGame(classId: number | null): boolean {
  return classId != null && (TFT_GAME_IDS as readonly number[]).includes(classId);
}

// true = sicher TFT, null = erst game_mode abwarten (5426), false = anderes Spiel.
export function tftFromGame(classId: number | null): boolean | null {
  if (classId == null) return null;
  if (TFT_ONLY.has(classId)) return true;
  return classId === 5426 ? null : false;
}

// 28164 kennt kein live_client_data und kein game_info (Overwolf bestaetigt es
// nicht, Log 07.10.), dafuer roster (eigener Name, Platzierung).
// Die Bank (bench) wird seit 0.6 nicht mehr gebraucht (Comp-Vorschlaege weg).
export function featuresFor(classId: number | null): string[] {
  const base = ['gep_internal', 'me', 'match_info', 'store', 'board', 'roster'];
  if (classId === 28164) return base;
  return [...base, 'game_info', 'live_client_data'];
}

// ---------- Ersatzquellen fuer 28164 ----------

// roster.player_status: {"Name":{"index":5,"health":58,"xp":8,"localplayer":true,
// "rank":0,"tag_line":"EUW"},...}. Kommt immer vollstaendig fuer alle acht
// Spieler (gemessen im Overwolf-Protokoll vom 07.10.2026), am Spielbeginn als {}.
// Lebende Spieler haben rank 0 bzw. leer, wer ausscheidet bekommt seinen Platz.
export interface RosterEntry { name: string; health: number | null; rank: number | null; local: boolean }

export function parseRoster(raw: unknown): RosterEntry[] {
  const parsed = jsonish<Record<string, { localplayer?: boolean | string; rank?: number | string; health?: number | string; tag_line?: string } | null>>(raw);
  if (!parsed || typeof parsed !== 'object') return [];
  const out: RosterEntry[] = [];
  for (const [key, val] of Object.entries(parsed)) {
    if (!key || !val || typeof val !== 'object') continue;
    const rank = Number(val.rank);
    const health = val.health === '' || val.health == null ? NaN : Number(val.health);
    out.push({
      name: val.tag_line && !key.includes('#') ? `${key}#${val.tag_line}` : key,
      health: Number.isFinite(health) ? health : null,
      rank: Number.isInteger(rank) && rank >= 1 && rank <= 8 ? rank : null,
      local: val.localplayer === true || val.localplayer === 'true',
    });
  }
  return out;
}

// Platz 1: der Sieger scheidet nie aus, roster meldet ihm deshalb keinen
// Platz. Haben alle sieben anderen einen, hat der eigene Spieler gewonnen —
// sonst gilt das Spielende als Absturz (kein Paket mit Platz, kein Popup).
export function wonMatch(entries: RosterEntry[]): boolean {
  const me = entries.find(e => e.local);
  const others = entries.filter(e => !e.local);
  return !!me && me.rank == null && others.length >= 7 && others.every(e => e.rank != null);
}

export function parseLocalPlayer(raw: unknown): { name: string; rank: number | null } | null {
  const me = parseRoster(raw).find(e => e.local);
  return me ? { name: me.name, rank: me.rank } : null;
}

// Kampf Nr. n (ab 1) → Stufe×10+Runde. Ab Stufe 2 hat jede Stufe fuenf
// Spielerkaempfe: x-1, x-2, x-3, x-5, x-6 (x-4 Karussell, x-7 Monster).
const PVP_ROUNDS = [1, 2, 3, 5, 6];
export function fightToRound(fight: number): number {
  const n = Math.max(1, Math.floor(fight));
  const stage = 2 + Math.floor((n - 1) / PVP_ROUNDS.length);
  return stage * 10 + PVP_ROUNDS[(n - 1) % PVP_ROUNDS.length];
}

// Untergrenze fuer die Zahl der schon gespielten Kaempfe aus der Spielzeit,
// bewusst vorsichtig (Stufe 1 ~3 Min, danach >= 75 s je Kampf), damit sie den
// Zaehler nie ueberholt, solange round_outcome kommt.
export function fightsLowerBound(elapsedSec: number): number {
  if (!Number.isFinite(elapsedSec) || elapsedSec <= 180) return 0;
  return Math.min(40, Math.floor((elapsedSec - 180) / 75));
}

// Regionskuerzel aus dem Standard-Tag. Nur ein Hinweis — der Tag ist frei
// waehlbar, der Backfill probiert deshalb auch die anderen Weltregionen.
const TAG_TO_REGION: Record<string, string> = {
  euw: 'euw1', eune: 'eun1', na: 'na1', kr: 'kr', br: 'br1', lan: 'la1', las: 'la2',
  oce: 'oc1', jp: 'jp1', tr: 'tr1', ru: 'ru', me: 'me1', sg: 'sg2', tw: 'tw2', vn: 'vn2',
  ph: 'ph2', th: 'th2',
  euw1: 'euw1', eun1: 'eun1', na1: 'na1', br1: 'br1', la1: 'la1', la2: 'la2', oc1: 'oc1',
  jp1: 'jp1', tr1: 'tr1', me1: 'me1', sg2: 'sg2', tw2: 'tw2', vn2: 'vn2', ph2: 'ph2', th2: 'th2',
};
export function regionFromHandle(handle: string | null): string | null {
  const tag = handle?.split('#')[1];
  return tag ? TAG_TO_REGION[tag.toLowerCase()] ?? null : null;
}
