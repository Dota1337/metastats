// Hintergrundfenster: liest die Spielereignisse, haelt ms.live aktuell, laedt
// die Daten von metastats.gg, setzt das Hauptfenster und blendet die Overlays
// ein und aus.
//
// Augmente werden NICHT angefordert: Overwolf warnt, dass Augment-Daten gegen
// Riots Regeln verstossen und die App sperren koennen.
//
// Ablauf einer Partie (ab 0.8):
//   Spielstart → Fortsetzen pruefen (match-state.ts) → Features anfordern, bis
//   Overwolf sie annimmt → sobald sicher TFT: Hauptfenster nach
//   window-policy.ts setzen → Overlays nach Einstellungen.
//   Spielende mit Platz oder match_end = echtes Ende: Paket senden, Stand
//   loeschen, Popup. Prozessende ohne beides (Absturz des Spiels): Stand 10 min
//   halten, damit ein Wiederverbinden die Partie fortsetzt.
// Alle Fenster-Aktionen laufen in einer Kette (winChain), eine nach der anderen.
import { APP_SECRET, API_BASE, CLIENT_VERSION } from '../lib/config.ts';
import { read, write, subscribe, type Live, type RosterRow, type Settings } from '../lib/store.ts';
import { loadComps, loadLookups, loadCompDetail, loadItemStats, loadLobby, loadPlayer } from '../lib/api.ts';
import { show, close, front, moveTo, minimize, setTopmost, setPassThrough, obtain, isVisible } from '../lib/ow.ts';
import { OVERLAY_NAMES, type OverlayName, type WindowName } from '../lib/windows.ts';
import { enqueue, flush, clear, idbStore, type OutboxEntry, type SendResult } from '../lib/outbox.ts';
import { recordBoard, flattenBoards, ownRounds, toOppBoard, mergeOppBoard, sameOppBoard, type Boards } from '../lib/boards.ts';
import { saveLocalMatch } from '../lib/history-store.ts';
import { classifyLaunch, launchSource, type LaunchKind } from '../lib/launch.ts';
import { rectFromGame, overlayBox } from '../lib/placement.ts';
import { decide, type PolicyInput, type Step, type Trigger } from '../lib/window-policy.ts';
import { toMon, gameMonitor, monitorOf, pickTarget, centerOn, isOffscreen, type Mon } from '../lib/monitors.ts';
import {
  emptyMatchState, decideResume, recentStarts, resumedFields, type MatchSnapshot,
} from '../lib/match-state.ts';
import { matchupCheck, aliveOf, isMe } from '../lib/tracker.ts';
import {
  jsonish, parseBoardPieces, parseShop, parseLevel, parseStage, parseRoundKind, parseItemSelect, stageToRound,
  parseOpponent, gameTimeToRound, isTftMode, gameClassId, isTftGame, isTftOnlyGame, tftFromGame,
  featuresFor, parseRoster, wonMatch, fightToRound, fightsLowerBound, regionFromHandle,
  LAUNCHER_IDS, LAUNCHER_FEATURES, parseLauncherInfo,
} from '../lib/gep.ts';

const REFRESH_MS = 30 * 60 * 1000;
const SUBMIT_URL = API_BASE + '/api/tft/positions/submit';
const HOLD_MS = 10 * 60_000;           // Stand nach Spielabsturz halten
const WATCHDOG_MS = 60_000;
const NEW_PROCESS_GRACE_MS = 60_000;   // Doppelmeldung des Spielstarts kurz nach dem App-Start
const ITEM_OFFER_MAX_MS = 90_000;      // Item-Auswahl ohne Abschlussmeldung
const PROFILE_TTL = 10 * 60_000;
const PROFILE_AFTER_GAME_MS = 90_000;  // Riot braucht etwas, bis das Spiel im Verlauf steht
const SNAPSHOT_EVERY_MS = 2000;
// Jeder neue Info-Schluessel einmal mit gekuerztem Rohwert ins Log — zum
// Auswerten echter Spiele (welche Daten kommen wann).
const DEBUG_GEP = true;

// Overwolf schreibt Objekte nur als "[object Object]" ins Log, deshalb als JSON.
const asText = (x: unknown): string => {
  if (typeof x === 'string') return x;
  if (x instanceof Error) return JSON.stringify({ message: x.message });
  try { return JSON.stringify(x); } catch { return String(x); }
};
const log = (...a: unknown[]) => console.log('[metastats-companion]', ...a.map(asText));
const errMsg = (e: unknown) => (e as Error)?.message || String(e);

// ---------- Brett-Daten fuer die Positions-Heatmap ----------

function newMatch() {
  return {
    matchId: null as string | null,
    region: null as string | null,
    handle: null as string | null,
    placement: null as number | null,
    ended: false,          // match_end o. Ae. gesehen
    round: 0,
    boards: new Map() as Boards,
    startedAt: Date.now(),
    gameId: null as number | null,
    submitted: false,
    // Runde: round_type hat Vorrang, sonst Kampf-Zaehler.
    hasStageFeed: false,
    fights: 0,
    lastOutcome: '',
    lastOutcomeAt: 0,
  };
}
type MatchData = ReturnType<typeof newMatch>;
let match: MatchData = newMatch();

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
    return { error: errMsg(err) || 'network' };
  }
}

async function flushOutbox(): Promise<void> {
  try {
    const r = await flush(idbStore, send, () => read('ms.settings').share);
    if (r.sent || r.dropped || r.left) log('outbox', r);
  } catch (e) {
    log('outbox failed', errMsg(e));
  }
}

// Genau ein Paket pro Spiel: nach dem Senden (Ausscheiden, Spielende) werden
// weitere Brett-Updates — etwa beim Zuschauen — ignoriert.
async function submit(m: MatchData = match): Promise<void> {
  if (m.submitted) return;
  const observations = flattenBoards(m.boards);
  if (observations.length === 0) return;
  m.submitted = true;
  scheduleSnapshot();
  const boardCount = m.boards.size;
  // Eigene Bretter fuer den Spielverlauf behalten, unabhaengig vom Teilen.
  const rounds = ownRounds(m.boards);
  if (rounds.length) {
    void saveLocalMatch({
      id: `${m.startedAt}`, matchId: m.matchId, startedAt: m.startedAt,
      endedAt: Date.now(), placement: m.placement, rounds,
    }).catch(e => log('history save failed', errMsg(e)));
  }
  m.boards = new Map();
  if (!read('ms.settings').share) return;
  const timestamp = Date.now();
  // Startzeit statt Sendezeit: der Backfill vergleicht mit dem Spielbeginn.
  const seed = Math.floor(m.startedAt / 60000) * 60000;
  const matchId = m.matchId || `LIVE_${seed}_${(m.handle || 'anon').slice(0, 8)}`;
  const body = JSON.stringify({
    matchId,
    // Nur eine sichere Region, sonst leer — der Backfill sucht dann selbst.
    region: m.region,
    ownPuuid: m.handle,
    placement: m.placement,
    observationCount: observations.length,
    observations,
    sentAt: new Date(timestamp).toISOString(),
    timestamp,
    // Die Kennung erlaubt, Spiele von 28164 spaeter getrennt auszuwerten.
    clientVersion: m.gameId === 28164 ? `${CLIENT_VERSION}-28164` : CLIENT_VERSION,
  });
  log('match packet', {
    matchId, round: m.round, boards: boardCount,
    observations: observations.length, bytes: new TextEncoder().encode(body).length,
  });
  const entry: OutboxEntry = { id: `${matchId}_${timestamp}`, url: SUBMIT_URL, body, createdAt: timestamp, tries: 0 };
  try {
    await enqueue(idbStore, entry);
  } catch (e) {
    // IndexedDB gesperrt: wenigstens einmal direkt senden.
    log('outbox write failed', errMsg(e));
    log('submit', await send(entry));
    return;
  }
  await flushOutbox();
}

// ---------- Live-Zustand fuer die Overlays ----------

let live: Live = { ...emptyMatchState(), updatedAt: Date.now() };
let sawShopVisibleEvent = false;

function patchLive(p: Partial<Live>): void {
  live = { ...live, ...p, updatedAt: Date.now() };
  write('ms.live', live);
  scheduleSnapshot();
  syncOverlays();
}

const seenKeys = new Set<string>();
let lastSpectate = '';

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
  if (handle.includes('#') && me !== handle) {
    write('ms.me', handle);
    void loadProfile(true);
  }
  if (!match.region) match.region = regionFromHandle(handle);
}

// Gegner des naechsten Kampfes: das Spiel meldet ihn oft schon in der Runde
// davor (Log 08.10. 23:41: gemeldet im Karussell 4-4). Er gilt fuer die
// naechste Kampfrunde, die noch keinen Gegner hat.
let oppFresh = false;

// Item-Auswahl: offen, bis das Spiel sie leer meldet, die Stufe wechselt oder
// 90 s vergangen sind.
let itemTimer: ReturnType<typeof setTimeout> | null = null;
function setItemOffer(offer: string[], stage: string | null): void {
  const cur = read('ms.item');
  if (itemTimer) { clearTimeout(itemTimer); itemTimer = null; }
  if (!offer.length) {
    if (cur) { write('ms.item', null); syncOverlays(); }
    return;
  }
  if (cur?.offer.join() !== offer.join()) log('item select', { stage, offer });
  write('ms.item', { offer, stage, at: Date.now() });
  itemTimer = setTimeout(() => setItemOffer([], null), ITEM_OFFER_MAX_MS);
  syncOverlays();
}

function onInfo(info: overwolf.games.events.InfoUpdates2Event): void {
  const all = (info?.info || {}) as Record<string, Record<string, unknown>>;
  const p: Partial<Live> = {};
  debugKeys(all);

  const mi = all.match_info;
  if (mi) {
    const mode = isTftMode(mi.game_mode);
    // 28164/21570 sind immer TFT; ein game_mode=false dort ist ein Messfehler.
    if (mode != null && !(mode === false && isTftOnlyGame(match.gameId))) p.inTft = mode;
    if (mi.round_type) {
      const stage = parseStage(mi.round_type);
      const kind = parseRoundKind(mi.round_type);
      if (kind) p.roundKind = kind;
      if (stage) {
        match.hasStageFeed = true;
        p.stage = stage;
        const r = stageToRound(stage);
        if (r != null && r > match.round) match.round = r;
        const item = read('ms.item');
        if (item && item.stage && item.stage !== stage) setItemOffer([], null);
      }
    }
    // Rueckfall ohne round_type: jedes neue Kampfergebnis zaehlt als ein Kampf.
    // Overwolf fuehrt den Schluessel auf 28164 mit Leerzeichen am Ende.
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
    if (mi.opponent !== undefined) {
      p.opponent = parseOpponent(mi.opponent);
      if (p.opponent) oppFresh = true;
    }
    if (mi.item_select !== undefined) setItemOffer(parseItemSelect(mi.item_select), p.stage ?? live.stage);
    // Probe: wessen Brett gerade gezeigt wird. Jeder neue Wert einmal ins Log.
    if (mi.board_spectate !== undefined) {
      const v = typeof mi.board_spectate === 'string' ? mi.board_spectate : asText(mi.board_spectate);
      if (v !== lastSpectate) {
        lastSpectate = v;
        log('board spectate', { value: v, stage: p.stage ?? live.stage, roster: live.roster.length, opponent: p.opponent ?? live.opponent });
      }
    }
    if (mi.match_id) match.matchId = String(mi.match_id);
    const outcome = Number(mi.match_outcome ?? mi.placement);
    if (outcome >= 1 && outcome <= 8 && !match.placement) {
      match.placement = outcome;
      void submit();
    }
  }

  const roster = all.roster;
  if (roster?.player_status !== undefined) {
    const entries = parseRoster(roster.player_status);
    if (entries.length) {
      const rows: RosterRow[] = entries.map(({ name, health, rank }) => ({ name, health, rank }));
      if (JSON.stringify(rows) !== JSON.stringify(live.roster)) p.roster = rows;
    }
    const lp = entries.find(e => e.local);
    if (lp) {
      if (!match.handle || (lp.name.includes('#') && !match.handle.includes('#'))) setHandle(lp.name);
      // Ausgeschieden: Platz steht fest, Paket geht sofort raus. Der Sieger
      // scheidet nie aus: Platz 1, sobald alle anderen einen Platz haben.
      const place = lp.rank ?? (wonMatch(entries) ? 1 : null);
      if (place != null && !match.placement) {
        match.placement = place;
        void submit();
      }
    }
  }

  const me = all.me;
  if (me?.summoner_name && !match.handle) setHandle(String(me.summoner_name));
  // Zweite Quelle fuer den Platz: me.rank (waehrend des Spiels 0).
  if (me?.rank !== undefined) {
    const r = Number(me.rank);
    if (Number.isInteger(r) && r >= 1 && r <= 8 && !match.placement) {
      match.placement = r;
      void submit();
    }
  }
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

  const boardFeed = all.board;
  if (boardFeed?.board_pieces) {
    const pieces = parseBoardPieces(boardFeed.board_pieces);
    if (!match.submitted) recordBoard(match.boards, 'own', match.round, null, pieces);
    const mine = pieces.filter(x => x.unit).map(x => ({ id: x.unit, star: x.level || 1 }))
      .sort((a, b) => a.id.localeCompare(b.id) || a.star - b.star);
    if (JSON.stringify(mine) !== JSON.stringify(live.myUnits)) p.myUnits = mine;
  }
  if (boardFeed?.opponent_board_pieces && !match.submitted) {
    const opp = p.opponent !== undefined ? p.opponent : live.opponent;
    const pieces = parseBoardPieces(boardFeed.opponent_board_pieces);
    recordBoard(match.boards, 'opp', match.round, opp, pieces);
    // Vollstaendigstes Brett je Gegner fuer die Comp-Erkennung im Gegner-
    // Overlay. Das Spiel meldet oft nur Teile davon; die werden zusammengefuehrt.
    if (opp) {
      const prev = live.oppBoards[opp];
      const next = toOppBoard(pieces, match.round, p.stage ?? live.stage);
      const merged = mergeOppBoard(prev, next);
      if (Math.abs(next.units.length - (prev?.units.length ?? 0)) >= 2) {
        log('opp board size', { opponent: opp, round: match.round, seen: next.units.length, before: prev?.units.length ?? 0, kept: merged.units.length });
      }
      if (!sameOppBoard(prev, merged)) p.oppBoards = { ...live.oppBoards, [opp]: merged };
    }
  }

  // Gegner-Tracker: nur Spielerkaempfe (round_type PVP), je Stufe ein Gegner.
  const stage = p.stage ?? live.stage;
  const kind = p.roundKind ?? live.roundKind;
  const opp = p.opponent !== undefined ? p.opponent : live.opponent;
  if (stage && kind === 'pvp' && opp && !isMe(opp, match.handle)) {
    const known = live.pvp[stage];
    if (!known ? oppFresh : known !== opp && p.opponent !== undefined) {
      oppFresh = false;
      p.pvp = { ...live.pvp, [stage]: opp };
      if (!known) log('matchup check', matchupCheck(p.pvp, stage, aliveOf(p.roster ?? live.roster)));
      else log('matchup corrected', { stage, before: known, now: opp });
    }
  }

  if (Object.keys(p).length) {
    const becameTft = p.inTft === true && !live.wasTft;
    if (becameTft) p.wasTft = true;
    patchLive(p);
    if (p.roster) void loadLobbyFor(live.roster);
    if (pending && (p.roster || p.stage)) evaluatePending('info');
    if (becameTft) onTftConfirmed();
  }
}

function onEvents(e: overwolf.games.events.NewGameEvents): void {
  for (const ev of e?.events || []) {
    if (ev.name === 'match_start' || ev.name === 'matchStart') {
      // Neue Partie im selben Spielprozess (bisher nicht beobachtet): alles neu.
      log('match_start event', { stage: live.stage });
      match = { ...newMatch(), gameId: match.gameId, handle: match.handle, region: match.region };
      oppFresh = false;
      patchLive({
        level: null, shop: [], stage: null, opponent: null, oppBoards: {}, roster: [], pvp: {}, roundKind: null,
        myUnits: [], dismissed: [], startedAt: match.startedAt,
      });
    } else if (ev.name === 'shop_visible' || ev.name === 'shop_hidden') {
      sawShopVisibleEvent = true;
      const visible = ev.name === 'shop_visible' && String(ev.data) !== 'false';
      patchLive({ shopVisible: visible });
    } else if (END_EVENTS.has(ev.name)) {
      match.ended = true;
      const place = Number(ev.data);
      if (place >= 1 && place <= 8 && !match.placement) match.placement = place;
      void submit();
    }
  }
}
const END_EVENTS = new Set(['match_end', 'matchEnd', 'match_outcome', 'gameEnd', 'tft_match_end']);

// ---------- Partie: Start, Fortsetzen, Ende ----------

// Overwolf lehnt setRequiredFeatures kurz nach Spielstart oft ab ("Not in a
// game", Log 07.10.: Erfolg erst beim 5. Versuch). Neuversuch ohne Obergrenze,
// solange die Partie laeuft: 3 s, steigend bis 10 s. armGen beendet eine alte
// Schleife.
let armGen = 0;

function armFeatures(classId: number | null): void {
  const gen = ++armGen;
  const features = featuresFor(classId);
  let tries = 0;
  const attempt = () => {
    if (gen !== armGen) return;
    overwolf.games.events.setRequiredFeatures(features, r => {
      const res = r as { success?: boolean; error?: string; supportedFeatures?: string[] };
      tries++;
      if (res?.success || tries <= 5 || tries % 10 === 0) {
        log('features', classId, res?.success, res?.error || '', res?.supportedFeatures || '', tries);
      }
      if (gen !== armGen) return;
      if (res?.success) {
        void runningGame().then(g => { if (g && gen === armGen) updateSession(sessionOf(g)); });
        return;
      }
      setTimeout(attempt, Math.min(10_000, 3000 + (tries - 1) * 1000));
    });
  };
  attempt();
}

interface ActiveGame { classId: number; sessionId: string | null; seenAt: number }
let activeGame: ActiveGame | null = null;
const appStartedAt = Date.now();

// Fortsetzen: Entscheidung steht noch aus (Spielerliste fehlt).
let pending: { snap: MatchSnapshot; starts: number[] } | null = null;
let starts: number[] = [];
let mainHandled = false;

// Nach einem Spielabsturz gehaltene Partie.
let held: MatchData | null = null;
let holdTimer: ReturnType<typeof setTimeout> | null = null;

function clearHold(): void {
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
}

function releaseHeld(reason: string): void {
  clearHold();
  const h = held;
  held = null;
  if (!h) return;
  log('held match released', { reason, boards: h.boards.size });
  void submit(h);
}

let snapTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSnapshot(): void {
  if (!activeGame || snapTimer) return;
  snapTimer = setTimeout(() => { snapTimer = null; saveSnapshot(); }, SNAPSHOT_EVERY_MS);
}

function saveSnapshot(): void {
  // Solange die Fortsetzen-Entscheidung aussteht, bleibt der alte Stand stehen —
  // sonst vergleicht der Fingerabdruck die Partie mit sich selbst.
  if (!activeGame || pending || !live.wasTft) return;
  const snap: MatchSnapshot = {
    sessionId: activeGame.sessionId, classId: activeGame.classId, startedAt: match.startedAt, updatedAt: Date.now(),
    stage: live.stage, oppBoards: live.oppBoards, roster: live.roster, pvp: live.pvp, queueId: live.queueId,
    dismissed: live.dismissed, submitted: match.submitted, mainHandled, wasTft: live.wasTft,
    placement: match.placement, matchId: match.matchId, handle: match.handle, starts,
  };
  write('ms.resume', snap);
}

function applyResume(snap: MatchSnapshot, reason: string): void {
  pending = null;
  if (held) {
    // Was waehrend des Wartens schon ankam, gehoert zur selben Partie.
    const cur = match;
    match = held;
    held = null;
    clearHold();
    for (const [k, v] of cur.boards) match.boards.set(k, v);
    match.submitted = match.submitted || cur.submitted;
    match.ended = match.ended || cur.ended;
    match.placement = match.placement ?? cur.placement;
    match.matchId = match.matchId ?? cur.matchId;
    match.handle = match.handle ?? cur.handle;
    match.region = match.region ?? cur.region;
    match.round = Math.max(match.round, cur.round);
  }
  match.startedAt = snap.startedAt;
  match.submitted = match.submitted || snap.submitted;
  match.placement = match.placement ?? snap.placement;
  match.matchId = match.matchId ?? snap.matchId;
  if (!match.handle && snap.handle) match.handle = snap.handle;
  if (!match.region) match.region = regionFromHandle(match.handle);
  mainHandled = snap.mainHandled;
  const r = resumedFields(snap);
  const boards = { ...r.oppBoards };
  for (const [k, v] of Object.entries(live.oppBoards)) boards[k] = mergeOppBoard(boards[k], v);
  const wasTft = r.wasTft || live.wasTft;
  log('resume', { reason, startedAt: snap.startedAt, boards: Object.keys(boards).length, pvp: Object.keys(r.pvp).length, mainHandled });
  patchLive({
    oppBoards: boards, roster: live.roster.length ? live.roster : r.roster, pvp: { ...r.pvp, ...live.pvp },
    dismissed: [...new Set([...r.dismissed, ...live.dismissed])], startedAt: r.startedAt, wasTft,
    inTft: live.inTft || wasTft, queueId: live.queueId ?? snap.queueId,
  });
  if (live.inTft) onTftConfirmed();
}

function startFresh(reason: string, crashLoop: boolean, ctxStarts: number[], atStartup: boolean): void {
  pending = null;
  if (held) releaseHeld('new match');
  starts = crashLoop ? ctxStarts : atStartup ? [Date.now()] : [];
  log('fresh match', { reason });
  saveSnapshot();
  if (live.inTft) onTftConfirmed();
}

function evaluatePending(source: string): void {
  if (!pending || !activeGame) return;
  const d = decideResume(pending.snap, {
    now: Date.now(), seenAt: activeGame.seenAt, sessionId: activeGame.sessionId, classId: activeGame.classId,
    names: live.roster.map(r => r.name), stage: live.stage, starts: pending.starts,
  });
  if (d.verdict === 'wait') return;
  log('resume decision', { source, ...d });
  if (d.verdict === 'resume') applyResume(pending.snap, d.reason);
  else {
    // Doch eine neue Partie: die beim Warten vorlaeufig zu gehaltenen Overlays
    // wieder zulassen.
    const prov = new Set(pending.snap.dismissed ?? []);
    if (prov.size) patchLive({ dismissed: live.dismissed.filter(n => !prov.has(n)) });
    startFresh(d.reason, d.reason === 'crash loop', pending.starts, false);
  }
}

// newProcess: Overwolf meldet einen neu gestarteten Spielprozess. Laeuft dann
// noch eine Partie, deren Ende verpasst wurde, ist das eine neue Partie (nicht
// bei der Doppelmeldung direkt nach dem App-Start).
function onGameStart(classId: number | null, sessionId: string | null, atStartup: boolean, newProcess = false): void {
  if (classId == null || !isTftGame(classId)) return; // anderes Spiel
  if (activeGame?.classId === classId) {
    if (!newProcess || Date.now() - activeGame.seenAt < NEW_PROCESS_GRACE_MS) { updateSession(sessionId); return; }
    endGame('new process');
  }
  if (activeGame) endGame('other game');
  const now = Date.now();
  const snap = read('ms.resume');
  const ctxStarts = atStartup ? recentStarts(snap?.starts, now) : (snap?.starts ?? []).filter(t => now - t < 120_000);
  activeGame = { classId, sessionId, seenAt: now };
  const keep = held;
  match = newMatch();
  held = keep;
  match.gameId = classId;
  sawShopVisibleEvent = false;
  oppFresh = false;
  mainHandled = false;
  const tft = tftFromGame(classId) === true;
  live = {
    ...emptyMatchState(), inTft: tft, wasTft: tft, lobby: sessionId, startedAt: match.startedAt,
    queueId: launcher.queueId, updatedAt: now,
  };
  write('ms.live', live);
  write('ms.lobby', null);
  lobbyKey = '';
  setItemOffer([], null);
  const d = decideResume(snap, { now, seenAt: now, sessionId, classId, names: [], stage: null, starts: ctxStarts });
  log('game start', { classId, sessionId, atStartup, queueId: launcher.queueId, decision: d });
  armFeatures(classId);
  // Die Starts dieser Partie sofort sichern, sonst zaehlt der Schutz gegen
  // Absturz-Schleifen nie bis CRASH_MAX_STARTS.
  if (d.verdict === 'resume') {
    starts = ctxStarts;
    applyResume(snap!, d.reason);
    saveSnapshot();
  } else if (d.verdict === 'wait') {
    pending = { snap: snap!, starts: ctxStarts };
    starts = ctxStarts;
    write('ms.resume', { ...snap!, starts: ctxStarts });
    // Bis zur Entscheidung bleiben weggeklickte Overlays zu.
    live.dismissed = [...(snap!.dismissed ?? [])];
    write('ms.live', live);
  } else startFresh(d.reason, d.reason === 'crash loop', ctxStarts, atStartup);
  syncOverlays();
}

// Overwolf traegt die sessionId manchmal erst spaeter nach. Eine andere als
// die bekannte heisst: neue Partie.
function updateSession(sessionId: string | null): void {
  if (!activeGame || !sessionId) return;
  if (activeGame.sessionId === sessionId) return;
  if (activeGame.sessionId == null) {
    activeGame.sessionId = sessionId;
    log('session id', sessionId);
    patchLive({ lobby: sessionId });
    if (pending) evaluatePending('session');
    return;
  }
  const classId = activeGame.classId;
  log('session changed', { from: activeGame.sessionId, to: sessionId });
  endGame('session changed');
  onGameStart(classId, sessionId, false);
}

// Sicher TFT (28164/21570 sofort, 5426 erst nach game_mode): Hauptfenster
// einmal je Partie setzen. Steht das Fortsetzen noch aus, wartet es darauf.
function onTftConfirmed(): void {
  if (!activeGame || pending || mainHandled) return;
  mainHandled = true;
  void runPolicy('game-start', { handled: false });
  scheduleSnapshot();
  void loadLobbyFor(live.roster);
}

function endGame(reason: string): void {
  if (!activeGame) return;
  const wasTft = live.wasTft;
  const real = match.placement != null || match.ended;
  log('game end', { reason, wasTft, real, placement: match.placement, ended: match.ended, pending: !!pending });
  if (wasTft && !real && !pending) saveSnapshot();
  activeGame = null;
  armGen++;
  pending = null;
  if (wasTft && !real) {
    // Spielabsturz oder Verbindung weg: kein Paket, kein Popup — wer sich
    // wieder verbindet, setzt die Partie fort. Eine noch gehaltene aeltere
    // Partie geht vorher raus, statt verloren zu gehen.
    if (held) releaseHeld('replaced');
    held = match;
    clearHold();
    holdTimer = setTimeout(() => {
      log('hold expired');
      write('ms.resume', null);
      releaseHeld('hold expired');
    }, HOLD_MS);
  } else {
    void submit();
    if (wasTft) write('ms.resume', null);
  }
  match = newMatch();
  sawShopVisibleEvent = false;
  oppFresh = false;
  stopMoving('game end');
  setItemOffer([], null);
  live = { ...emptyMatchState(), updatedAt: Date.now() };
  write('ms.live', live);
  syncOverlays();
  void runPolicy('game-end', { wasTft: wasTft && real });
  winChain(async () => { await setTopmost('main', false); });
  if (wasTft && real) setTimeout(() => void loadProfile(true), PROFILE_AFTER_GAME_MS);
}

// Waechter: haengt eine Partie, obwohl das Spiel nicht mehr laeuft (verpasstes
// Ereignis), oder laeuft schon die naechste?
async function watchdog(source: string): Promise<void> {
  if (!activeGame) return;
  const g = await runningGame();
  if (!activeGame) return;
  const cls = g ? gameClassId(g) : null;
  if (!g || cls !== activeGame.classId) {
    log('watchdog', { source, action: 'end', running: cls });
    endGame('watchdog');
    if (g && isTftGame(cls)) onGameStart(cls, sessionOf(g), false);
    return;
  }
  updateSession(sessionOf(g));
  if (pending) evaluatePending('watchdog');
}

// ---------- League-Client (Launcher 10902) ----------

const launcher = { running: false, queueId: null as number | null, phase: null as string | null, platform: null as string | null };
const isLauncher = (classId: unknown) => (LAUNCHER_IDS as readonly number[]).includes(Number(classId));

function armLauncher(tries = 0): void {
  overwolf.games.launchers.events.setRequiredFeatures(LAUNCHER_IDS[0], LAUNCHER_FEATURES, r => {
    log('launcher features', r?.success, (r as { error?: string })?.error || '', r?.supportedFeatures || '', tries + 1);
    if (!r?.success && launcher.running && tries < 20) setTimeout(() => armLauncher(tries + 1), 5000);
  });
}

function onLauncherInfo(e: unknown): void {
  const u = parseLauncherInfo((e as { info?: unknown })?.info);
  if (!Object.keys(u).length) return;
  if (u.queueId !== undefined) {
    launcher.queueId = u.queueId ?? null;
    if (activeGame && u.queueId && live.queueId !== u.queueId) patchLive({ queueId: u.queueId });
  }
  if (u.phase !== undefined) launcher.phase = u.phase ?? null;
  if (u.platform) launcher.platform = u.platform;
  log('launcher info', u);
}

function runningLaunchers(): Promise<overwolf.games.launchers.LauncherInfo[]> {
  return new Promise(res => {
    try {
      overwolf.games.launchers.getRunningLaunchersInfo(r => res(r?.launchers || []));
    } catch {
      res([]);
    }
  });
}

// ---------- Hauptfenster ----------

function runningGame(): Promise<overwolf.games.GetRunningGameInfoResult | null> {
  return new Promise(res => overwolf.games.getRunningGameInfo(r => res(r?.isRunning ? r : null)));
}

const sessionOf = (g: { sessionId?: string } | null | undefined): string | null => (g?.sessionId ? String(g.sessionId) : null);
const gameHandle = (g: unknown): number | null => {
  const v = (g as { monitorHandle?: { value?: number } } | null)?.monitorHandle?.value;
  return typeof v === 'number' ? v : null;
};

function monitors(): Promise<Mon[]> {
  return new Promise(res => {
    try {
      overwolf.utils.getMonitorsList(r => res((r?.displays || []).map(toMon).filter((m): m is Mon => !!m)));
    } catch {
      res([]);
    }
  });
}

const rectOf = (w: overwolf.windows.WindowInfo) => ({ left: w.left, top: w.top, width: w.width, height: w.height });

// Fenster-Aktionen nacheinander: zwei gleichzeitige Umzuege oder Minimieren
// waehrend eines Zeigens ergaben vorher Zufallsergebnisse.
let chain: Promise<void> = Promise.resolve();
// Bleibt ein Overwolf-Rueckruf aus, haengt sonst die ganze Kette und kein
// Fenster oeffnet oder schliesst sich mehr.
const WIN_STEP_MAX_MS = 10_000;
function winChain(fn: () => Promise<void>, label = 'window'): Promise<void> {
  chain = chain.then(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout ${WIN_STEP_MAX_MS} ms`)), WIN_STEP_MAX_MS);
    });
    return Promise.race([fn(), timeout]).finally(() => clearTimeout(timer));
  }).catch(e => log('window step failed', label, errMsg(e)));
  return chain;
}

// Zeitpunkt, zu dem der Nutzer das Hauptfenster selbst geoeffnet hat. Kurz
// danach wird es beim Spielstart nicht minimiert.
let userShownAt = 0;
const USER_SHOWN_GRACE_MS = 10_000;

function runPolicy(trigger: Trigger, extra: Partial<PolicyInput> = {}): Promise<void> {
  return winChain(async () => {
    const s = read('ms.settings');
    const [g, mons, mainVisible, overlayVisible] = await Promise.all([runningGame(), monitors(), isVisible('main'), isVisible('main_overlay')]);
    const input: PolicyInput = {
      trigger, mode: s.mode, monitors: mons.length || null, inTft: !!activeGame && live.inTft,
      gameFocused: g ? !!g.isInFocus : null, mainVisible, overlayVisible, autoMove: s.autoMove,
      startWithClient: s.startWithClient, popupOnEnd: s.popupOnEnd, wasTft: false, coldStart: false,
      handled: false, userShown: Date.now() - userShownAt < USER_SHOWN_GRACE_MS, ...extra,
    };
    const d = decide(input);
    log('window policy', { trigger, layout: d.layout, why: d.why, steps: d.steps, monitors: mons.length, gameFocused: input.gameFocused, mainVisible });
    for (const step of d.steps) await runStep(step, g, mons);
  }, trigger);
}

async function runStep(step: Step, g: overwolf.games.GetRunningGameInfoResult | null, mons: Mon[]): Promise<void> {
  switch (step.op) {
    case 'main-show':
      await show('main');
      if (step.move) await moveMainOffGame(g, mons);
      await bringBack(mons);
      await front('main', step.focus);
      await updateTopmost(g, mons);
      return;
    case 'main-minimize':
      if (activeGame) await rememberMainMonitor(g, mons);
      if (await isVisible('main')) await minimize('main');
      return;
    case 'main-park': {
      const w = await obtain('main');
      if (!w || !(await isVisible('main'))) return;
      const gm = gameMonitor(mons, gameHandle(g));
      const on = monitorOf(mons, rectOf(w), w.monitorId);
      if (!gm || !on || on.id === gm.id) await minimize('main');
      else await updateTopmost(g, mons);
      return;
    }
    case 'overlay-show':
      await show('main_overlay');
      await front('main_overlay', true);
      return;
    case 'overlay-close':
      await close('main_overlay');
      return;
  }
}

async function moveMainOffGame(g: overwolf.games.GetRunningGameInfoResult | null, mons: Mon[]): Promise<void> {
  const target = pickTarget(mons, gameHandle(g), read('ms.winpos')?.monitorId);
  const w = await obtain('main');
  if (!target || !w) { log('main move', { action: 'no target', monitors: mons.length }); return; }
  const on = monitorOf(mons, rectOf(w), w.monitorId);
  if (on?.id === target.id) return;
  const r = centerOn(target, { width: w.width, height: w.height });
  const resize = r.width !== w.width || r.height !== w.height;
  await moveTo('main', r.left, r.top, resize ? r.width : undefined, resize ? r.height : undefined);
  log('main move', { from: on?.id ?? null, to: target.id, left: r.left, top: r.top, resize });
}

// Liegt das Hauptfenster neben allen Bildschirmen (abgesteckt, Aufloesung
// gewechselt), kommt es mittig auf den Hauptbildschirm zurueck.
async function bringBack(mons: Mon[]): Promise<void> {
  const w = await obtain('main');
  if (!w || !isOffscreen(mons, rectOf(w))) return;
  const primary = mons.find(m => m.primary) ?? mons[0];
  if (!primary) return;
  const r = centerOn(primary, { width: w.width, height: w.height });
  await moveTo('main', r.left, r.top, r.width, r.height);
  log('main brought back', { to: primary.id });
}

// Immer oben nur, wenn das Hauptfenster auf dem Spiel-Bildschirm liegt (sonst
// verdeckt es auf dem zweiten Bildschirm andere Fenster ohne Grund).
async function updateTopmost(g: overwolf.games.GetRunningGameInfoResult | null, mons: Mon[]): Promise<void> {
  if (!activeGame || !live.inTft) { await setTopmost('main', false); return; }
  const w = await obtain('main');
  if (!w) return;
  const gm = mons.length ? gameMonitor(mons, gameHandle(g)) : null;
  const on = mons.length ? monitorOf(mons, rectOf(w), w.monitorId) : null;
  await setTopmost('main', !gm || !on || gm.id === on.id);
}

// Hat der Nutzer das Hauptfenster waehrend einer Partie auf einen anderen
// Bildschirm gelegt, kommt es beim naechsten Mal wieder dorthin.
async function rememberMainMonitor(g: overwolf.games.GetRunningGameInfoResult | null, mons: Mon[]): Promise<void> {
  if (mons.length < 2) return;
  const w = await obtain('main');
  if (!w || !(await isVisible('main'))) return;
  const gm = gameMonitor(mons, gameHandle(g));
  const on = monitorOf(mons, rectOf(w), w.monitorId);
  if (on && gm && on.id !== gm.id && read('ms.winpos')?.monitorId !== on.id) {
    write('ms.winpos', { monitorId: on.id });
    log('main monitor remembered', on.id);
  }
}

// Wie wurde die App geoeffnet? cold = erster Start dieser Instanz.
function handleLaunch(kind: LaunchKind | null, origin: string | null, cold: boolean): void {
  log('launch', { origin, kind, cold, launcher: launcher.running, game: activeGame?.classId ?? null });
  if (kind === 'click') {
    userShownAt = Date.now();
    void watchdog('click').then(() => runPolicy('click'));
    return;
  }
  if (kind === 'unknown') { void runPolicy('unknown'); return; }
  // Selbststart: nur der League-Client holt das Hauptfenster (Schalter
  // „Mit dem League-Client starten“), und nur beim Kaltstart der App.
  if (cold && launcher.running && !activeGame) void runPolicy('client', { coldStart: true });
}

// ---------- Overlays ----------

// Lagen: src/lib/placement.ts. Shop und Item-Leiste mit fester Groesse; das
// Gegner-Overlay nur mit Lage (Groesse setzt es selbst).
const PLACED = new Set<OverlayName>(['shop', 'matchup', 'items']);
const placed = new Set<OverlayName>();
const shown = new Set<OverlayName>();

async function place(name: OverlayName): Promise<void> {
  if (name !== 'shop' && name !== 'matchup' && name !== 'items') return;
  const g = await runningGame();
  const r = g ? rectFromGame(g.logicalWidth || g.width, g.logicalHeight || g.height) : null;
  if (!r) return;
  const box = overlayBox(name, r, read('ms.settings').matchupPos);
  await moveTo(name, box.left, box.top, box.width, box.height);
  placed.add(name);
}

// Lage neu setzen (Aufloesung gewechselt, Lage verschoben oder zurueckgesetzt).
function replace(name: OverlayName): void {
  placed.delete(name);
  if (shown.has(name)) void winChain(() => place(name), `place ${name}`);
}

async function setOverlay(name: OverlayName, want: boolean): Promise<void> {
  if (want === shown.has(name)) return;
  if (want) {
    shown.add(name);
    await show(name);
    if (PLACED.has(name) && !placed.has(name)) await place(name);
  } else {
    shown.delete(name);
    if (name === 'matchup') stopMoving('hidden');
    await close(name);
    placed.delete(name);
  }
}

function wantedOverlays(): Record<OverlayName, boolean> {
  const s = read('ms.settings');
  const pin = read('ms.pin');
  const tft = !!activeGame && live.inTft;
  const off = new Set(live.dismissed);
  return {
    // Comp-Overlay: mit angehefteter Comp, sonst als Comp-Auswahl (Schalter).
    pinned: tft && s.pinned && (!!pin || s.compPicker) && !off.has('pinned'),
    // Shop bleibt offen und blendet seinen Inhalt aus, wenn der Shop zu ist.
    shop: tft && s.shop && !!pin && !off.has('shop'),
    matchup: tft && s.opponent && !off.has('matchup'),
    items: tft && s.items && !!read('ms.item')?.offer.length,
  };
}

// Mehrere Aenderungen kurz hintereinander = ein Abgleich.
let syncQueued = false;
function syncOverlays(): void {
  if (syncQueued) return;
  syncQueued = true;
  void winChain(async () => {
    syncQueued = false;
    const want = wantedOverlays();
    for (const name of OVERLAY_NAMES) await setOverlay(name, want[name]);
    if (!activeGame && shownMainOverlay) { shownMainOverlay = false; await close('main_overlay'); }
  }, 'overlays');
}
let shownMainOverlay = false;

// Vom Spieler mit × geschlossen: bleibt zu bis zur naechsten Partie oder bis
// er den Schalter in den Einstellungen neu einschaltet.
function dismiss(name: string): void {
  if (!(OVERLAY_NAMES as readonly string[]).includes(name)) return;
  const n = name as OverlayName;
  if (n === 'matchup') stopMoving('dismissed');
  log('overlay dismissed', n);
  if (!live.dismissed.includes(n)) patchLive({ dismissed: [...live.dismissed, n] });
}

// Verschiebe-Modus des Gegner-Overlays (Tastenkuerzel oder Knopf in den
// Einstellungen): das Overlay nimmt kurz die Maus an und zeigt einen Rahmen.
// Endet nach dem Ablegen, nach 30 s, beim zweiten Druck oder am Spielende.
const MOVE_MS = 30_000;
let moveTimer: ReturnType<typeof setTimeout> | null = null;

function toggleMoving(source: string): void {
  if (live.moving) { stopMoving(source); return; }
  if (!shown.has('matchup')) { log('move overlay', { source, action: 'not shown' }); return; }
  if (moveTimer) clearTimeout(moveTimer);
  moveTimer = setTimeout(() => stopMoving('timeout'), MOVE_MS);
  patchLive({ moving: true });
  void setPassThrough('matchup', false).then(ok => log('move overlay', { source, action: 'start', ok }));
}

function stopMoving(reason: string): void {
  if (moveTimer) { clearTimeout(moveTimer); moveTimer = null; }
  if (!live.moving) return;
  patchLive({ moving: false });
  void setPassThrough('matchup', true).then(ok => log('move overlay', { reason, action: 'stop', ok }));
}

// ---------- Daten ----------

// Detail der angehefteten Comp (Aufstellung, fruehe Boards) fuer das Overlay.
// Die Overlays laden nie selbst, deshalb holt es das Hintergrundfenster.
let pinDetailFor = '';

async function loadPinDetail(force = false): Promise<void> {
  const pin = read('ms.pin');
  if (!pin) {
    pinDetailFor = '';
    if (read('ms.pinDetail')) write('ms.pinDetail', null);
    return;
  }
  const want = `${read('ms.settings').region}|${pin.key}|${pin.guideId ?? ''}`;
  const cur = read('ms.pinDetail');
  if (!force && want === pinDetailFor && cur?.key === pin.key && Date.now() - cur.fetchedAt < REFRESH_MS) return;
  pinDetailFor = want;
  try {
    // Dieselbe MetaTFT-Comp wie die Comp-Liste (guide), wie im Hauptfenster.
    const data = await loadCompDetail(pin.slug, pin.units.map(u => u.id), [...new Set([...pin.carries, ...pin.itemCarriers])], pin.guideId ?? null);
    if (read('ms.pin')?.key === pin.key) write('ms.pinDetail', { key: pin.key, fetchedAt: Date.now(), data });
  } catch (e) {
    pinDetailFor = '';
    log('pin detail failed', errMsg(e));
  }
}

async function refreshData(force = false): Promise<void> {
  const [comps] = await Promise.all([loadComps(force), loadLookups(force), loadItemStats(force)]);
  // Angeheftete Comp mit den frischen Zahlen ersetzen, falls es sie noch gibt.
  const pin = read('ms.pin');
  if (pin && comps) {
    const fresh = comps.comps.find(c => c.key === pin.key);
    if (fresh) write('ms.pin', fresh);
  }
  await loadPinDetail(force);
}

// Mitspieler der Partie: einmal je neuer Namensliste, nur aus unserer
// Datenbank (keine Riot-Abrufe). Leer = Anzeige leer.
let lobbyKey = '';
async function loadLobbyFor(roster: RosterRow[]): Promise<void> {
  if (!activeGame || !live.inTft || !read('ms.settings').scout) return;
  const names = roster.map(r => r.name).filter(n => n.includes('#') && !isMe(n, match.handle ?? read('ms.me')));
  if (names.length < 2) return;
  const key = [...names].sort().join('|');
  if (key === lobbyKey) return;
  lobbyKey = key;
  const region = match.region ?? launcher.platform ?? null;
  try {
    const r = await loadLobby(names, region);
    if (lobbyKey !== key) return;
    const players = Object.fromEntries(r.players.map(p => [p.name, p]));
    write('ms.lobby', { names: key, at: Date.now(), players });
    log('lobby', { asked: names.length, found: r.players.filter(p => p.found).length, ranked: r.players.filter(p => p.tier).length, region });
  } catch (e) {
    log('lobby failed', errMsg(e));
    lobbyKey = '';
  }
}

// Eigenes Profil fuer die Live-Spalte: Rang und letzte Platzierungen. Bei 429
// (Riot-Grenze) kein sofortiger Neuversuch, erst beim naechsten Anlass.
let profileBusy = false;
async function loadProfile(force: boolean): Promise<void> {
  const me = read('ms.me');
  if (!me || !me.includes('#') || profileBusy) return;
  const cur = read('ms.profile');
  if (!force && cur?.name === me && Date.now() - cur.fetchedAt < PROFILE_TTL) return;
  profileBusy = true;
  try {
    const data = await loadPlayer(me, 0, { lobby: false, region: regionFromHandle(me) ?? launcher.platform });
    write('ms.profile', { name: me, fetchedAt: Date.now(), data });
    log('profile', { matches: data.matches.length, ranked: !!data.ranked });
  } catch (e) {
    log('profile failed', { status: (e as { status?: number }).status ?? null, error: errMsg(e) });
  } finally {
    profileBusy = false;
  }
}

// ---------- Start ----------

overwolf.games.events.onInfoUpdates2.addListener(onInfo);
overwolf.games.events.onNewEvents.addListener(onEvents);
overwolf.games.onGameInfoUpdated.addListener(e => {
  const gi = e?.gameInfo;
  const cls = gameClassId(gi);
  if (e?.runningChanged || e?.gameChanged) {
    if (gi?.isRunning) onGameStart(cls, sessionOf(gi), false, !!e?.runningChanged);
    else if (activeGame && (cls == null || cls === activeGame.classId)) endGame('process end');
  } else if (gi?.isRunning && activeGame && cls === activeGame.classId) {
    updateSession(sessionOf(gi));
  }
  if (e?.resolutionChanged) { replace('shop'); replace('matchup'); replace('items'); }
});

try {
  overwolf.games.launchers.onLaunched.addListener(l => {
    if (!isLauncher(l?.classId)) return;
    launcher.running = true;
    log('launcher start', { classId: l.classId });
    armLauncher();
  });
  overwolf.games.launchers.onTerminated.addListener(l => {
    if (!isLauncher(l?.classId)) return;
    launcher.running = false;
    log('launcher end');
  });
  overwolf.games.launchers.events.onInfoUpdates.addListener(onLauncherInfo);
} catch (e) {
  log('launcher api missing', errMsg(e));
}

// Fensterzustand: jede Aenderung ins Log; schliesst sich ein Overlay ohne ×
// (Overwolf, Absturz des Fensters), geht es beim naechsten Abgleich wieder auf.
overwolf.windows.onStateChanged.addListener(e => {
  const name = e?.window_name as WindowName;
  if (!name || name === 'background') return;
  log('window state', { name, state: e.window_state_ex, prev: e.window_previous_state_ex });
  const closed = e.window_state_ex === 'closed' || e.window_state_ex === 'hidden';
  if (name === 'main_overlay') { shownMainOverlay = !closed; return; }
  if (closed && (OVERLAY_NAMES as readonly string[]).includes(name) && shown.has(name as OverlayName)) {
    shown.delete(name as OverlayName);
    placed.delete(name as OverlayName);
    if (name === 'matchup') stopMoving('closed');
    syncOverlays();
  }
});

overwolf.settings.hotkeys.onPressed.addListener(e => {
  if (e?.name === 'toggle_main') void watchdog('hotkey').then(() => runPolicy('hotkey'));
  else if (e?.name === 'move_matchup') toggleMoving('hotkey');
});

// Nachrichten der Fenster: Verschieben (Einstellungen), × an einem Overlay,
// Neu laden (Hauptfenster im Spiel laedt nie selbst).
overwolf.windows.onMessageReceived.addListener(m => {
  if (m?.id === 'move_matchup') toggleMoving('settings');
  else if (m?.id === 'dismiss') dismiss(String(m.content ?? ''));
  else if (m?.id === 'refresh') void refreshData(true);
  else if (m?.id === 'main_overlay_shown') shownMainOverlay = true;
});

// Klick auf die App, waehrend sie schon laeuft.
overwolf.extensions.onAppLaunchTriggered.addListener(e => handleLaunch(classifyLaunch(e?.origin), e?.origin ?? null, false));

// Einstellungs-Schalter, die ein Overlay wieder einschalten, heben das × auf.
const REOPEN: Array<[keyof Settings, OverlayName]> = [['pinned', 'pinned'], ['compPicker', 'pinned'], ['shop', 'shop'], ['opponent', 'matchup'], ['items', 'items']];
let lastSettings = read('ms.settings');
subscribe(['ms.settings', 'ms.pin', 'ms.me'], key => {
  if (key === 'ms.me') { void loadProfile(true); return; }
  if (key === 'ms.settings') {
    const settings = read('ms.settings');
    const prev = lastSettings;
    lastSettings = settings;
    if (settings.region !== prev.region) void loadComps(true);
    // Gegner-Overlay verschoben oder zurueckgesetzt: an die neue Lage.
    if (JSON.stringify(settings.matchupPos) !== JSON.stringify(prev.matchupPos)) {
      log('overlay position', settings.matchupPos);
      stopMoving('placed');
      replace('matchup');
    }
    const reopen = REOPEN.filter(([k, n]) => settings[k] && !prev[k] && live.dismissed.includes(n)).map(([, n]) => n);
    if (reopen.length) patchLive({ dismissed: live.dismissed.filter(n => !reopen.includes(n)) });
    if (settings.scout && !prev.scout) { lobbyKey = ''; void loadLobbyFor(live.roster); }
    // Teilen aus: noch wartende Pakete duerfen nicht mehr rausgehen.
    if (!settings.share) {
      void clear(idbStore)
        .then(n => { if (n) log('outbox cleared', n); })
        .catch(e => log('outbox clear failed', errMsg(e)));
    }
  }
  void loadPinDetail();
  syncOverlays();
});

// Fensterzustaende nach einem Neustart der App: offene Overlays uebernehmen,
// das Gegner-Overlay wieder durchklickbar machen (Verschieben unterbrochen).
async function restoreWindowStates(): Promise<void> {
  const states = await Promise.all(OVERLAY_NAMES.map(async n => [n, await isVisible(n)] as const));
  for (const [n, vis] of states) if (vis) shown.add(n);
  shownMainOverlay = await isVisible('main_overlay');
  if (shown.has('matchup')) await setPassThrough('matchup', true);
  log('window states', { overlays: [...shown], mainOverlay: shownMainOverlay });
}

async function startup(): Promise<void> {
  const source = launchSource(location.href);
  log('ready', CLIENT_VERSION, { href: location.href, source });
  await restoreWindowStates();
  const [launchers, g] = await Promise.all([runningLaunchers(), runningGame()]);
  if (launchers.some(l => isLauncher(l.classId))) {
    launcher.running = true;
    armLauncher();
  }
  // Ein alter Stand ohne laufendes Spiel bleibt stehen: verbindet sich der
  // Spieler nach einem Spielabsturz wieder, entscheidet decideResume (Alter).
  if (g && isTftGame(gameClassId(g))) onGameStart(gameClassId(g), sessionOf(g), true);
  handleLaunch(classifyLaunch(source), source, Date.now() - appStartedAt < 60_000);
  syncOverlays();
  setTimeout(() => void loadProfile(false), 5000);
}

write('ms.live', live);
void refreshData();
void flushOutbox();
setInterval(() => { void refreshData(true); void flushOutbox(); }, REFRESH_MS);
setInterval(() => void watchdog('timer'), WATCHDOG_MS);
window.addEventListener('online', () => void flushOutbox());
void startup();
