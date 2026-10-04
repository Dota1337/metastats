// Hintergrundfenster: liest die Spielereignisse, haelt ms.live aktuell, laedt
// die Daten von metastats.gg und blendet die Overlays ein und aus.
//
// Augmente werden NICHT angefordert: Overwolf warnt, dass Augment-Daten gegen
// Riots Regeln verstossen und die App sperren koennen.
import { APP_SECRET, API_BASE, CLIENT_VERSION } from '../lib/config.ts';
import { read, write, subscribe, type Live } from '../lib/store.ts';
import { loadComps, loadLookups } from '../lib/api.ts';
import { show, close, toggle, moveTo, type WindowName } from '../lib/ow.ts';
import { enqueue, flush, idbStore, type OutboxEntry, type SendResult } from '../lib/outbox.ts';
import { recordBoard, flattenBoards, type Boards } from '../lib/boards.ts';
import {
  jsonish, parseBoardPieces, parseShop, parseLevel, parseStage, stageToRound,
  parseOpponent, gameTimeToRound, isTftMode, gameClassId, isTftGame, tftFromGame,
  featuresFor, parseLocalPlayer, fightToRound, fightsLowerBound, regionFromHandle,
} from '../lib/gep.ts';

const REFRESH_MS = 30 * 60 * 1000;
const SUBMIT_URL = API_BASE + '/api/tft/positions/submit';
// Jeder neue Info-Schluessel einmal mit gekuerztem Rohwert ins Log — zum
// Auswerten der ersten echten Spiele auf 28164 (welche Daten kommen wann).
const DEBUG_GEP = true;

const log = (...a: unknown[]) => console.log('[metastats-companion]', ...a);

// ---------- Brett-Daten fuer die Positions-Heatmap ----------

const match = {
  matchId: null as string | null,
  region: null as string | null,
  handle: null as string | null,
  placement: null as number | null,
  round: 0,
  boards: new Map() as Boards,
  startedAt: Date.now(),
  gameId: null as number | null,
  submitted: false,
  // Runde: round_type (21570/5426) hat Vorrang, sonst Kampf-Zaehler.
  hasStageFeed: false,
  fights: 0,
  lastOutcome: '',
  lastOutcomeAt: 0,
};

function resetMatch(): void {
  match.matchId = null;
  match.region = null;
  match.handle = null;
  match.placement = null;
  match.round = 0;
  match.boards = new Map();
  match.startedAt = Date.now();
  match.submitted = false;
  match.hasStageFeed = false;
  match.fights = 0;
  match.lastOutcome = '';
  match.lastOutcomeAt = 0;
}

// Runde aus gezaehlten Kaempfen, mindestens so weit wie die Spielzeit erlaubt.
function updateRoundFromFights(): void {
  if (match.hasStageFeed) return;
  const done = Math.max(match.fights, fightsLowerBound((Date.now() - match.startedAt) / 1000));
  const r = fightToRound(done + 1);
  if (r > match.round) match.round = r;
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
  return Array.from(sig, b => b.toString(16).padStart(2, '0')).join('');
}

// Jeder Versuch wird frisch signiert: der Server nimmt den Zeitstempel im Kopf
// nur fuenf Minuten lang an.
async function send(e: OutboxEntry): Promise<SendResult> {
  try {
    const res = await fetch(e.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Companion-Signature': await hmacHex(APP_SECRET, e.body),
        'X-Companion-Timestamp': String(Date.now()),
      },
      body: e.body,
    });
    return { status: res.status };
  } catch (err) {
    return { error: (err as Error)?.message || 'network' };
  }
}

async function flushOutbox(): Promise<void> {
  try {
    const r = await flush(idbStore, send);
    if (r.sent || r.dropped || r.left) log('outbox', r);
  } catch (e) {
    log('outbox failed', (e as Error)?.message);
  }
}

// Genau ein Paket pro Spiel: nach dem Senden (Ausscheiden, Spielende) werden
// weitere Brett-Updates — etwa beim Zuschauen — ignoriert.
async function submit(): Promise<void> {
  if (match.submitted) return;
  const observations = flattenBoards(match.boards);
  if (observations.length === 0) return;
  match.submitted = true;
  match.boards = new Map();
  if (!read('ms.settings').share) return;
  const timestamp = Date.now();
  // Startzeit statt Sendezeit: der Backfill vergleicht mit dem Spielbeginn.
  const seed = Math.floor(match.startedAt / 60000) * 60000;
  const matchId = match.matchId || `LIVE_${seed}_${(match.handle || 'anon').slice(0, 8)}`;
  const body = JSON.stringify({
    matchId,
    // Nur eine sichere Region, sonst leer — der Backfill sucht dann selbst.
    region: match.region,
    ownPuuid: match.handle,
    placement: match.placement,
    observationCount: observations.length,
    observations,
    sentAt: new Date(timestamp).toISOString(),
    timestamp,
    // Spiel 28164 liefert keinen Spielmodus; die Kennung erlaubt, Hyper Roll
    // oder Double Up spaeter herauszufiltern.
    clientVersion: match.gameId === 28164 ? `${CLIENT_VERSION}-28164` : CLIENT_VERSION,
  });
  // Paketgroesse als Messgrundlage fuer den Komplett-Upload (Plan P2).
  log('match packet', {
    matchId, round: match.round, boards: match.boards.size,
    observations: observations.length, bytes: new TextEncoder().encode(body).length,
  });
  const entry: OutboxEntry = { id: `${matchId}_${timestamp}`, url: SUBMIT_URL, body, createdAt: timestamp, tries: 0 };
  try {
    await enqueue(idbStore, entry);
  } catch (e) {
    // IndexedDB gesperrt: wenigstens einmal direkt senden.
    log('outbox write failed', (e as Error)?.message);
    log('submit', await send(entry));
    return;
  }
  await flushOutbox();
}

// ---------- Live-Zustand fuer die Overlays ----------

let live: Live = { ...read('ms.live'), inTft: false, shop: [], shopVisible: false, opponent: null, stage: null };
let sawShopVisibleEvent = false;

function patchLive(p: Partial<Live>): void {
  live = { ...live, ...p, updatedAt: Date.now() };
  write('ms.live', live);
  void syncOverlays();
}

const seenKeys = new Set<string>();

function debugKeys(all: Record<string, Record<string, unknown>>): void {
  if (!DEBUG_GEP) return;
  for (const [feature, keys] of Object.entries(all)) {
    for (const [key, val] of Object.entries(keys || {})) {
      const id = `${feature}.${key}`;
      if (seenKeys.has(id)) continue;
      seenKeys.add(id);
      const raw = typeof val === 'string' ? val : JSON.stringify(val);
      log('info key', match.gameId, id, String(raw).slice(0, 300));
    }
  }
}

function setHandle(name: string): void {
  // 28164 meldet evtl. nur den Namen ohne #Tag. Passt der gespeicherte eigene
  // Riot-Name dazu, wird er genommen (der Backfill braucht Name#TAG).
  let handle = name;
  const me = read('ms.me');
  if (!name.includes('#') && me && me.split('#')[0].toLowerCase() === name.toLowerCase()) handle = me;
  match.handle = handle.slice(0, 100);
  if (handle.includes('#') && me !== handle) write('ms.me', handle);
  if (!match.region) match.region = regionFromHandle(handle);
}

function onInfo(info: overwolf.games.events.InfoUpdates2Event): void {
  const all = (info?.info || {}) as Record<string, Record<string, unknown>>;
  const p: Partial<Live> = {};
  debugKeys(all);

  const mi = all.match_info;
  if (mi) {
    const mode = isTftMode(mi.game_mode);
    if (mode != null) p.inTft = mode;
    if (mi.round_type) {
      const stage = parseStage(mi.round_type);
      if (stage) {
        match.hasStageFeed = true;
        p.stage = stage;
        const r = stageToRound(stage);
        if (r != null && r > match.round) match.round = r;
      }
    }
    // 28164: kein round_type — jedes neue Kampfergebnis zaehlt als ein Kampf.
    // Overwolf fuehrt den Schluessel dort mit Leerzeichen am Ende.
    const ro = mi.round_outcome ?? mi['round_outcome '];
    if (ro != null && ro !== '') {
      const txt = typeof ro === 'string' ? ro : JSON.stringify(ro);
      const now = Date.now();
      // Gleicher Wert oder < 20 s seit dem letzten = derselbe Kampf.
      if (txt !== match.lastOutcome && now - match.lastOutcomeAt > 20_000) {
        match.fights++;
        match.lastOutcomeAt = now;
      }
      match.lastOutcome = txt;
    }
    if (mi.opponent !== undefined) p.opponent = parseOpponent(mi.opponent);
    if (mi.match_id) match.matchId = String(mi.match_id);
    const outcome = Number(mi.match_outcome ?? mi.placement);
    if (outcome >= 1 && outcome <= 8 && !match.placement) {
      match.placement = outcome;
      void submit();
    }
  }

  const roster = all.roster;
  if (roster?.player_status !== undefined) {
    const lp = parseLocalPlayer(roster.player_status);
    if (lp) {
      if (!match.handle || (lp.name.includes('#') && !match.handle.includes('#'))) setHandle(lp.name);
      // Ausgeschieden: Platz steht fest, Paket geht sofort raus.
      if (lp.rank != null && !match.placement) {
        match.placement = lp.rank;
        void submit();
      }
    }
  }

  const me = all.me;
  if (me?.summoner_name && !match.handle) setHandle(String(me.summoner_name));
  if (me?.xp !== undefined) {
    const lvl = parseLevel(me.xp);
    if (lvl != null) p.level = lvl;
  }

  const store = all.store;
  if (store?.shop_pieces !== undefined) {
    p.shop = parseShop(store.shop_pieces);
    if (!sawShopVisibleEvent) p.shopVisible = p.shop.some(Boolean);
  }
  if (store?.shop_visible !== undefined) {
    sawShopVisibleEvent = true;
    p.shopVisible = String(store.shop_visible) === 'true';
  }

  const lcd = all.live_client_data;
  if (lcd) {
    const ap = jsonish<{ riotId?: string; riotIdGameName?: string; riotIdTagLine?: string; summonerName?: string }>(lcd.active_player);
    if (ap) {
      const riotId = ap.riotIdGameName && ap.riotIdTagLine ? `${ap.riotIdGameName}#${ap.riotIdTagLine}` : ap.riotId || null;
      const handle = riotId || ap.summonerName;
      if (handle) setHandle(String(handle));
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

  if (!lcd) updateRoundFromFights();

  const board = match.submitted ? null : all.board;
  if (board?.board_pieces) recordBoard(match.boards, 'own', match.round, null, parseBoardPieces(board.board_pieces));
  if (board?.opponent_board_pieces) {
    const opp = p.opponent !== undefined ? p.opponent : live.opponent;
    recordBoard(match.boards, 'opp', match.round, opp, parseBoardPieces(board.opponent_board_pieces));
  }

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
      if (place >= 1 && place <= 8 && !match.placement) match.placement = place;
      void submit();
    }
  }
}

// Overwolf lehnt setRequiredFeatures kurz nach Spielstart oft ab, bis der
// Spiel-Anschluss bereit ist: bis zu 5 Versuche im Abstand von 3 s. Die
// Lauf-Marke beendet eine alte Schleife, sobald ein neues Spiel startet.
let armGen = 0;

function armFeatures(classId: number | null): void {
  const gen = ++armGen;
  const features = featuresFor(classId);
  let tries = 0;
  const attempt = () => {
    if (gen !== armGen) return;
    overwolf.games.events.setRequiredFeatures(features, r => {
      const res = r as { success?: boolean; error?: string; supportedFeatures?: string[] };
      log('features', classId, res?.success, res?.error || '', res?.supportedFeatures || '');
      if (!res?.success && ++tries < 5 && gen === armGen) setTimeout(attempt, 3000);
    });
  };
  attempt();
}

let activeGame: number | null = null;

function onGameStart(classId: number | null): void {
  if (!isTftGame(classId) || activeGame === classId) return; // anderes Spiel / schon erfasst
  activeGame = classId;
  resetMatch();
  match.gameId = classId;
  sawShopVisibleEvent = false;
  armFeatures(classId);
  // 28164/21570 sind sicher TFT; bei 5426 entscheidet erst game_mode.
  patchLive({ inTft: tftFromGame(classId) === true, shop: [], shopVisible: false, opponent: null, stage: null, level: null });
}

function onGameEnd(): void {
  if (activeGame == null) return;
  activeGame = null;
  armGen++;
  void submit();
  sawShopVisibleEvent = false;
  patchLive({ inTft: false, shop: [], shopVisible: false, opponent: null, stage: null, level: null });
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
  if (e?.runningChanged || e?.gameChanged) {
    if (e.gameInfo?.isRunning) onGameStart(gameClassId(e.gameInfo));
    else onGameEnd();
  }
  if (e?.resolutionChanged) shopPlaced = false;
});
overwolf.games.getRunningGameInfo(r => { if (r?.isRunning) onGameStart(gameClassId(r)); });
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
void flushOutbox();
setInterval(() => { void refreshData(true); void flushOutbox(); }, REFRESH_MS);
window.addEventListener('online', () => void flushOutbox());
void show('main');
log('ready', CLIENT_VERSION);
