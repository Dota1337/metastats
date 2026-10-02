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
// Gekaufte Plaetze kommen leer oder ohne Namen.
export function parseShop(raw: unknown): Array<string | null> {
  const parsed = jsonish<Record<string, { name?: string } | null>>(raw);
  const out: Array<string | null> = [null, null, null, null, null];
  if (!parsed || typeof parsed !== 'object') return out;
  for (const [key, val] of Object.entries(parsed)) {
    const m = /^slot_(\d)$/.exec(key);
    if (!m) continue;
    const i = Number(m[1]) - 1;
    if (i < 0 || i > 4) continue;
    out[i] = val?.name ? String(val.name) : null;
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

// match_info.game_mode ist "TFT" oder "LOL" — beide laufen als Spiel 5426.
export function isTftMode(mode: unknown): boolean | null {
  if (typeof mode !== 'string' || !mode) return null;
  return mode.toUpperCase() === 'TFT';
}
