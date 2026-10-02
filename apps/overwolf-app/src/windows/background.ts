// Hintergrundfenster: liest die Spielereignisse, haelt ms.live aktuell, laedt
// die Daten von metastats.gg und blendet die Overlays ein und aus.
//
// Augmente werden NICHT angefordert: Overwolf warnt, dass Augment-Daten gegen
// Riots Regeln verstossen und die App sperren koennen.
import { APP_SECRET, API_BASE, CLIENT_VERSION } from '../lib/config.ts';
import { read, write, subscribe, type Live } from '../lib/store.ts';
import { loadComps, loadLookups } from '../lib/api.ts';
import { show, close, toggle, moveTo, type WindowName } from '../lib/ow.ts';
import {
  jsonish, parseBoardPieces, parseShop, parseLevel, parseStage, stageToRound,
  parseOpponent, gameTimeToRound, isTftMode, type BoardPiece,
} from '../lib/gep.ts';

const FEATURES = ['gep_internal', 'game_info', 'live_client_data', 'me', 'match_info', 'store', 'board'];
const REFRESH_MS = 30 * 60 * 1000;
const SUBMIT_URL = API_BASE + '/api/tft/positions/submit';
const TAG_TO_REGION: Record<string, string> = {
  euw: 'euw1', eune: 'eun1', na: 'na1', kr: 'kr', br: 'br1', lan: 'la1', las: 'la2',
  oce: 'oc1', jp: 'jp1', tr: 'tr1', ru: 'ru',
};

const log = (...a: unknown[]) => console.log('[metastats-companion]', ...a);

// ---------- Brett-Daten fuer die Positions-Heatmap ----------

interface Observation { round: number; kind: 'own' | 'opp'; cell: number; unit: string; level: number; items: string[] }

const match = {
  matchId: null as string | null,
  region: null as string | null,
  handle: null as string | null,
  placement: null as number | null,
  round: 0,
  observations: [] as Observation[],
};

function resetMatch(): void {
  match.matchId = null;
  match.region = null;
  match.placement = null;
  match.round = 0;
  match.observations = [];
}

function record(kind: 'own' | 'opp', pieces: BoardPiece[]): void {
  for (const p of pieces) match.observations.push({ round: match.round, kind, ...p });
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
  return Array.from(sig, b => b.toString(16).padStart(2, '0')).join('');
}

async function submit(): Promise<void> {
  if (match.observations.length === 0) return;
  if (!read('ms.settings').share) {
    resetMatch();
    return;
  }
  const timestamp = Date.now();
  const body = JSON.stringify({
    matchId: match.matchId || `LIVE_${timestamp}_${(match.handle || 'anon').slice(0, 8)}`,
    region: match.region || 'euw1',
    ownPuuid: match.handle,
    placement: match.placement,
    observationCount: match.observations.length,
    observations: match.observations,
    sentAt: new Date(timestamp).toISOString(),
    timestamp,
    clientVersion: CLIENT_VERSION,
  });
  resetMatch();
  try {
    const res = await fetch(SUBMIT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Companion-Signature': await hmacHex(APP_SECRET, body),
        'X-Companion-Timestamp': String(timestamp),
      },
      body,
    });
    log('submit', res.status);
  } catch (e) {
    log('submit failed', (e as Error)?.message);
  }
}

// ---------- Live-Zustand fuer die Overlays ----------

let live: Live = { ...read('ms.live'), inTft: false, shop: [], shopVisible: false, opponent: null, stage: null };
let sawShopVisibleEvent = false;

function patchLive(p: Partial<Live>): void {
  live = { ...live, ...p, updatedAt: Date.now() };
  write('ms.live', live);
  void syncOverlays();
}

function onInfo(info: overwolf.games.events.InfoUpdates2Event): void {
  const all = (info?.info || {}) as Record<string, Record<string, unknown>>;
  const p: Partial<Live> = {};

  const mi = all.match_info;
  if (mi) {
    const mode = isTftMode(mi.game_mode);
    if (mode != null) p.inTft = mode;
    if (mi.round_type) {
      const stage = parseStage(mi.round_type);
      if (stage) {
        p.stage = stage;
        const r = stageToRound(stage);
        if (r != null && r > match.round) match.round = r;
      }
    }
    if (mi.opponent !== undefined) p.opponent = parseOpponent(mi.opponent);
    if (mi.match_id) match.matchId = String(mi.match_id);
    const outcome = Number(mi.match_outcome ?? mi.placement);
    if (outcome >= 1 && outcome <= 8 && !match.placement) {
      match.placement = outcome;
      void submit();
    }
  }

  const me = all.me;
  if (me?.xp !== undefined) {
    const lvl = parseLevel(me.xp);
    if (lvl != null) p.level = lvl;
  }

  const store = all.store;
  if (store?.shop_pieces !== undefined) {
    p.shop = parseShop(store.shop_pieces);
    if (!sawShopVisibleEvent) p.shopVisible = p.shop.some(Boolean);
  }

  const lcd = all.live_client_data;
  if (lcd) {
    const ap = jsonish<{ riotId?: string; riotIdGameName?: string; riotIdTagLine?: string; summonerName?: string }>(lcd.active_player);
    if (ap) {
      const riotId = ap.riotIdGameName && ap.riotIdTagLine ? `${ap.riotIdGameName}#${ap.riotIdTagLine}` : ap.riotId || null;
      const handle = riotId || ap.summonerName;
      if (handle) match.handle = String(handle).slice(0, 100);
      if (riotId && read('ms.me') !== riotId) write('ms.me', riotId);
      const region = TAG_TO_REGION[String(ap.riotIdTagLine || '').toLowerCase()];
      if (region) match.region = region;
    }
    const gd = jsonish<{ gameTime?: number }>(lcd.game_data);
    if (gd?.gameTime != null) {
      if (!match.matchId) {
        const seed = Math.floor((Date.now() - gd.gameTime * 1000) / 60000) * 60000;
        match.matchId = `LIVE_${seed}_${(match.handle || 'anon').slice(0, 8)}`;
      }
      const r = gameTimeToRound(gd.gameTime);
      if (r > match.round) match.round = r;
    }
  }

  const board = all.board;
  if (board?.board_pieces) record('own', parseBoardPieces(board.board_pieces));
  if (board?.opponent_board_pieces) record('opp', parseBoardPieces(board.opponent_board_pieces));

  if (Object.keys(p).length) patchLive(p);
}

const END_EVENTS = new Set(['match_end', 'matchEnd', 'match_outcome', 'gameEnd', 'tft_match_end']);

function onEvents(e: overwolf.games.events.NewGameEvents): void {
  for (const ev of e?.events || []) {
    if (ev.name === 'match_start' || ev.name === 'matchStart') {
      resetMatch();
      patchLive({ inTft: live.inTft, level: null, shop: [], stage: null, opponent: null });
    } else if (ev.name === 'shop_visible' || ev.name === 'shop_hidden') {
      sawShopVisibleEvent = true;
      const visible = ev.name === 'shop_visible' && String(ev.data) !== 'false';
      patchLive({ shopVisible: visible });
    } else if (END_EVENTS.has(ev.name)) {
      const place = Number(ev.data);
      if (place >= 1 && place <= 8) match.placement = place;
      void submit();
    }
  }
}

function armFeatures(): void {
  overwolf.games.events.setRequiredFeatures(FEATURES, r => log('features', r?.success, (r as { error?: string })?.error || ''));
}

function onGameState(running: boolean): void {
  if (running) {
    armFeatures();
  } else {
    void submit();
    sawShopVisibleEvent = false;
    patchLive({ inTft: false, shop: [], shopVisible: false, opponent: null, stage: null, level: null });
  }
}

// ---------- Overlays ----------

let shopPlaced = false;

async function placeShop(): Promise<void> {
  const g = await new Promise<overwolf.games.GetRunningGameInfoResult | null>(res => overwolf.games.getRunningGameInfo(r => res(r || null)));
  if (!g?.isRunning) return;
  const W = g.logicalWidth || g.width;
  const H = g.logicalHeight || g.height;
  if (!W || !H) return;
  // Das Spielbild ist eine zentrierte 16:9-Flaeche; die Shop-Leiste sitzt
  // unten zwischen ca. 24 % und 77,5 % ihrer Breite.
  const bw = Math.min(W, (H * 16) / 9);
  const bh = (bw * 9) / 16;
  const ox = (W - bw) / 2;
  const oy = (H - bh) / 2;
  await moveTo('shop', ox + bw * 0.24, oy + bh * 0.80, bw * 0.535, bh * 0.11);
  shopPlaced = true;
}

const shown = new Set<WindowName>();

async function setOverlay(name: WindowName, want: boolean): Promise<void> {
  if (want === shown.has(name)) return;
  if (want) {
    shown.add(name);
    await show(name);
    if (name === 'shop' && !shopPlaced) await placeShop();
  } else {
    shown.delete(name);
    await close(name);
    if (name === 'shop') shopPlaced = false;
  }
}

async function syncOverlays(): Promise<void> {
  const s = read('ms.settings');
  const pin = read('ms.pin');
  const tft = live.inTft;
  await Promise.all([
    setOverlay('pinned', tft && s.pinned && !!pin),
    setOverlay('shop', tft && s.shop && !!pin && live.shopVisible),
    setOverlay('matchup', tft && s.matchups),
  ]);
}

// ---------- Daten ----------

async function refreshData(force = false): Promise<void> {
  const [comps] = await Promise.all([loadComps(force), loadLookups(force)]);
  // Angeheftete Comp mit den frischen Zahlen ersetzen, falls es sie noch gibt.
  const pin = read('ms.pin');
  if (pin && comps) {
    const fresh = comps.comps.find(c => c.key === pin.key);
    if (fresh) write('ms.pin', fresh);
  }
}

// ---------- Start ----------

overwolf.games.events.onInfoUpdates2.addListener(onInfo);
overwolf.games.events.onNewEvents.addListener(onEvents);
overwolf.games.onGameInfoUpdated.addListener(e => {
  if (e?.runningChanged || e?.gameChanged) onGameState(!!e.gameInfo?.isRunning);
  if (e?.resolutionChanged) shopPlaced = false;
});
overwolf.games.getRunningGameInfo(r => { if (r?.isRunning) armFeatures(); });
overwolf.settings.hotkeys.onPressed.addListener(e => { if (e?.name === 'toggle_main') void toggle('main'); });

let lastRegion = read('ms.settings').region;
subscribe(['ms.settings', 'ms.pin'], key => {
  if (key === 'ms.settings') {
    const region = read('ms.settings').region;
    if (region !== lastRegion) {
      lastRegion = region;
      void loadComps(true);
    }
  }
  void syncOverlays();
});

write('ms.live', live);
void refreshData();
setInterval(() => void refreshData(true), REFRESH_MS);
void show('main');
log('ready', CLIENT_VERSION);
