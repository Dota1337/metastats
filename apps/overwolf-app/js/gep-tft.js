// Background script. Subscribes to Overwolf's TFT GEP, batches board-position
// observations + match metadata, posts to metastats.gg backend on round-end.
//
// What we collect:
//   - cell_N → { unit, level, items[] } for both own and opponent boards
//   - match_info: match_id, round, opponent_info, our placement when known
//   - augments selected — sent to backend only, NEVER displayed (Riot ToS)
//
// What we DO NOT collect:
//   - Game memory, personal data, location, browser activity
//   - Anything that requires opt-in beyond installing the app
//
// What the app DOES NOT show:
//   - In-game overlay with advice (no live coaching)
//   - Augment recommendations (Riot ToS forbids this)
//
// This is a silent background-only telemetry app. The desktop window only
// offers a kill-switch + a link back to metastats.gg.

// TFT auf Desktop läuft im League-Client → Overwolf reportet das als
// Game-ID 5426 (League of Legends). 21570 existiert in der Spieleliste
// für TFT Mobile / Standalone — als Fallback drin lassen. Beide IDs
// triggern setRequiredFeatures; die TFT-spezifischen GEP-Features
// (board, roster) feuern nur in einem TFT-Match, daher braucht es im
// Submit-Pfad keinen zusätzlichen Mode-Filter — leere observations →
// kein Submit.
const TFT_GAME_IDS = [5426, 21570];
const CONFIG = (typeof window !== 'undefined' && window.METASTATS_CONFIG) || {};
// Fallback uses the canonical hostname directly. The apex 307-redirects
// to www and CORS preflights must not be redirected — so even if
// config.js fails to load, the URL we hit must still be www.
const SUBMIT_URL = (CONFIG.apiBase || 'https://www.metastats.gg') + '/api/tft/positions/submit';
const APP_SECRET = CONFIG.appSecret || '';

const REQUIRED_FEATURES = [
  'gep_internal',
  'match_info',
  'board',         // own board_pieces with cell positions
  'live_client_data',
  'roster',        // opponent list for the lobby-scout window
];

// State during a match. Cleared at match-end.
const matchState = {
  matchId: null,
  region: null,
  ownPuuid: null,
  observations: [],     // [{ round, kind: 'own'|'opp', cell, unit, level, items }]
  opponentInfo: null,
  augmentsPicked: [],   // augment-api-names picked across the match
  placement: null,
  currentRound: 0,      // updated from match_info / game_data
  gameTimeAtSeed: null, // first observed gameTime (seconds), for delta-rounds
};

function log() {
  console.log.apply(console, ['[metastats-companion]'].concat([].slice.call(arguments)));
}

function reset() {
  matchState.matchId = null;
  matchState.region = null;
  matchState.ownPuuid = null;
  matchState.observations = [];
  matchState.opponentInfo = null;
  matchState.augmentsPicked = [];
  matchState.placement = null;
  matchState.currentRound = 0;
  matchState.gameTimeAtSeed = null;
}

// Convert game-time (seconds since match start) to a TFT round index.
// Stages of TFT are roughly:
//   Stage 1: ~80s (carousel + 3 rounds)
//   Stage 2 onwards: ~5 rounds × 40s ≈ 200s
// Empirical mapping: round ≈ floor(gameTime / 35) is close enough for
// aggregating positions by stage. Doesn't need to match Riot's exact
// indexing — we just need a monotonically increasing bucket.
function gameTimeToRound(gameTimeSec) {
  if (!Number.isFinite(gameTimeSec) || gameTimeSec < 0) return 0;
  return Math.max(0, Math.min(60, Math.floor(gameTimeSec / 35)));
}

function parseBoardPieces(raw) {
  // Overwolf delivers board_pieces as a JSON-stringified object keyed by
  // `cell_N`. Both shapes (raw object or stringified) appear depending on
  // GEP version, so handle both.
  if (!raw) return [];
  var parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch (e) { return []; }
  }
  var out = [];
  for (var key in parsed) {
    if (!parsed.hasOwnProperty(key)) continue;
    if (key.indexOf('cell_') !== 0) continue;
    var cell = Number(key.slice(5));
    if (!Number.isFinite(cell)) continue;
    var val = parsed[key];
    if (!val || typeof val !== 'object') continue;
    out.push({
      cell: cell,
      unit: String(val.name || ''),
      level: Number(val.level || 1),
      items: [val.item_1, val.item_2, val.item_3].filter(Boolean),
    });
  }
  return out;
}

function recordBoard(round, kind, pieces) {
  for (var i = 0; i < pieces.length; i++) {
    var p = pieces[i];
    matchState.observations.push({
      round: round, kind: kind, cell: p.cell, unit: p.unit, level: p.level, items: p.items,
    });
  }
}

function isPaused() {
  try { return window.localStorage.getItem('metastats.companion.paused') === '1'; }
  catch (e) { return false; }
}

// HMAC-SHA256 sign a payload string with the bundled app secret. Returns
// the signature as lowercase hex. Uses the WebCrypto SubtleCrypto API
// that Overwolf's CEF runtime exposes — same shape as browsers.
function hmacSignHex(secret, payload) {
  if (!secret) return Promise.resolve('');
  var enc = new TextEncoder();
  return crypto.subtle
    .importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    .then(function (key) { return crypto.subtle.sign('HMAC', key, enc.encode(payload)); })
    .then(function (sig) {
      var bytes = new Uint8Array(sig);
      var hex = '';
      for (var i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, '0');
      }
      return hex;
    });
}

function submit() {
  if (matchState.observations.length === 0) return;
  if (isPaused()) {
    log('paused — skipping submit');
    reset();
    return;
  }
  // Overwolf's TFT GEP does not expose Riot's match_id (it's only
  // available post-game via Match-V1). Synthesise a stable client-side
  // id so the server's unique index can still dedupe re-submits, and so
  // the matchId-required validator passes.
  if (!matchState.matchId) {
    matchState.matchId = 'LIVE_' + Date.now() + '_' + (matchState.ownPuuid || 'anon').slice(0, 8);
    log('synth matchId', matchState.matchId);
  }
  if (!matchState.region) matchState.region = 'euw1';
  var timestamp = Date.now();
  var payload = {
    matchId: matchState.matchId,
    region: matchState.region,
    ownPuuid: matchState.ownPuuid,
    placement: matchState.placement,
    observationCount: matchState.observations.length,
    augmentsCount: matchState.augmentsPicked.length,
    observations: matchState.observations,
    augments: matchState.augmentsPicked,
    sentAt: new Date(timestamp).toISOString(),
    timestamp: timestamp,
    clientVersion: '0.1.0',
  };
  var body = JSON.stringify(payload);
  // Sign the body. Server checks (a) signature matches, (b) timestamp is
  // within ±5min of server-now — together this gates replay + casual
  // tampering without needing per-user keys.
  hmacSignHex(APP_SECRET, body).then(function (sig) {
    return fetch(SUBMIT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Companion-Signature': sig,
        'X-Companion-Timestamp': String(timestamp),
      },
      body: body,
    });
  }).then(function (res) {
    return res.text().then(function (body) {
      log('submit', res.status, payload.observationCount, 'observations', 'body=', body.slice(0, 200));
    });
  }).catch(function (e) {
    log('submit failed', e && e.message);
  }).then(function () {
    reset();
  });
}

// Parses the roster payload Overwolf delivers when match_info or the
// dedicated `roster` feature updates. Both `data.roster` (raw object or
// JSON string) and `data.players` shapes appear depending on GEP version
// — we handle both, then forward to the lobby window.
function extractRoster(data) {
  if (!data) return [];
  var raw = data.roster ?? data.players ?? null;
  if (!raw) return [];
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch (e) { return []; }
  }
  var list = Array.isArray(raw) ? raw : Object.values(raw);
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    if (!p) continue;
    var name = String(p.gameName || p.summoner_name || p.name || '').trim();
    if (!name) continue;
    // Skip ourselves so the lobby window only shows the 7 opponents.
    if (matchState.ownPuuid && p.puuid && p.puuid === matchState.ownPuuid) continue;
    var tag = String(p.tagLine || p.tag_line || '').trim();
    if (name.indexOf('#') > 0 && !tag) {
      var parts = name.split('#');
      name = parts[0];
      tag = parts.slice(1).join('#');
    }
    out.push({
      gameName: name,
      tagLine: tag,
      region: (matchState.region || 'euw1').toLowerCase(),
    });
  }
  return out;
}

function pushRosterToLobby(roster) {
  if (!roster || roster.length === 0) return;
  if (typeof overwolf === 'undefined' || !overwolf.windows) return;
  // Open the in-game window if it isn't already, then send the roster.
  overwolf.windows.obtainDeclaredWindow('lobby', function (res) {
    if (!res || res.status !== 'success') return;
    overwolf.windows.restore(res.window.id, function () {
      overwolf.windows.sendMessage(res.window.id, 'lobby:roster', { roster: roster }, function () {});
    });
  });
}

function onGepInfoUpdate(info) {
  if (!info || !info.feature) return;
  var f = info.feature;
  var data = info.info && info.info[f];
  if (!data) return;

  if (f !== 'board') {
    try { log('GEP info', f, JSON.stringify(data).slice(0, 200)); }
    catch (e) { log('GEP info', f, '[unstringifiable]'); }
  }

  if (f === 'match_info') {
    if (data.match_id) matchState.matchId = String(data.match_id);
    if (data.region) matchState.region = String(data.region).toLowerCase();
    if (data.opponent_info) matchState.opponentInfo = data.opponent_info;
    // Round info — try several known Overwolf keys. Each may be a
    // JSON-string or plain object.
    var roundCandidate = data.round_info || data.matchState || data.roundData;
    if (roundCandidate) {
      var rc = roundCandidate;
      if (typeof rc === 'string') { try { rc = JSON.parse(rc); } catch (e) { rc = null; } }
      if (rc) {
        var r = rc.round != null ? rc.round : (rc.roundIndex != null ? rc.roundIndex : null);
        var s = rc.stage != null ? rc.stage : null;
        if (r != null && s != null) matchState.currentRound = Number(s) * 10 + Number(r);
        else if (r != null) matchState.currentRound = Number(r);
      }
    }
    var rosterFromMatch = extractRoster(data);
    if (rosterFromMatch.length > 0) pushRosterToLobby(rosterFromMatch);
    // TFT delivers placement as a match_info update keyed 'match_outcome',
    // not as a separate match_end event. Treat it as a submit-trigger.
    var outcome = data.match_outcome || data.matchOutcome || data.placement;
    if (outcome != null) {
      var place = Number(outcome) || null;
      if (place && !matchState.placement) {
        matchState.placement = place;
        log('match_outcome via match_info', place);
        submit();
      }
    }
  }
  if (f === 'roster') {
    var roster = extractRoster(data);
    if (roster.length > 0) pushRosterToLobby(roster);
  }
  if (f === 'live_client_data') {
    // Overwolf delivers nested data inside live_client_data as
    // JSON-stringified blobs, not as plain objects. Parse before using.
    var ap = data.active_player;
    if (typeof ap === 'string') { try { ap = JSON.parse(ap); } catch (e) { ap = null; } }
    if (ap) {
      // Prefer riotId (gameName#tagLine) as a stable handle since
      // summoner_id isn't exposed; falls back to summonerName.
      var handle = ap.summoner_id || ap.riotId || ap.summonerName ||
        (ap.riotIdGameName && ap.riotIdTagLine ? ap.riotIdGameName + '#' + ap.riotIdTagLine : null);
      if (handle) matchState.ownPuuid = String(handle).slice(0, 100);
      if (ap.riotIdTagLine) {
        var tag = String(ap.riotIdTagLine).toLowerCase();
        // EUW → euw1, NA → na1, KR → kr, EUNE → eun1, …
        var TAG_TO_REGION = { euw: 'euw1', eune: 'eun1', na: 'na1', kr: 'kr', br: 'br1', lan: 'la1', las: 'la2', oce: 'oc1', jp: 'jp1', tr: 'tr1', ru: 'ru' };
        if (TAG_TO_REGION[tag]) matchState.region = TAG_TO_REGION[tag];
      }
    }
    var gd = data.game_data;
    if (typeof gd === 'string') { try { gd = JSON.parse(gd); } catch (e) { gd = null; } }
    if (gd && gd.gameTime != null) {
      if (!matchState.matchId) {
        // Seed a stable id from the game-start moment (round-down by 60s
        // so jitter in game_data updates doesn't change the id mid-match).
        var seed = Math.floor((Date.now() - gd.gameTime * 1000) / 60000) * 60000;
        matchState.matchId = 'LIVE_' + seed + '_' + (matchState.ownPuuid || 'anon').slice(0, 8);
      }
      // Use gameTime as a fallback round-tracker if match_info doesn't
      // supply round_info. Only update if it's strictly larger so we
      // don't move backwards when packets arrive out of order.
      var fallbackRound = gameTimeToRound(gd.gameTime);
      if (fallbackRound > matchState.currentRound) {
        matchState.currentRound = fallbackRound;
      }
    }
  }
  if (f === 'board') {
    var round = matchState.currentRound || 0;
    if (data.board_pieces) {
      recordBoard(round, 'own', parseBoardPieces(data.board_pieces));
    }
    if (data.opponent_board_pieces) {
      recordBoard(round, 'opp', parseBoardPieces(data.opponent_board_pieces));
    }
  }
}

function onGepEvent(events) {
  if (!events || !events.events) return;
  for (var i = 0; i < events.events.length; i++) {
    var ev = events.events[i];
    try {
      log('GEP event', ev.name, typeof ev.data === 'string' ? ev.data.slice(0, 100) : ev.data);
    } catch (e) { log('GEP event', ev && ev.name); }
    if (ev.name === 'match_start' || ev.name === 'matchStart') {
      reset();
      log('match_start');
    }
    if (
      ev.name === 'match_end' ||
      ev.name === 'matchEnd' ||
      ev.name === 'match_outcome' ||
      ev.name === 'gameEnd' ||
      ev.name === 'tft_match_end'
    ) {
      try { matchState.placement = Number(ev.data || 0) || null; } catch (e) { /* no-op */ }
      log('match_end placement', matchState.placement, 'via', ev.name);
      submit();
    }
    if (ev.name === 'augment_picked' && ev.data) {
      try {
        var picked = JSON.parse(ev.data);
        if (picked && picked.augment_id) matchState.augmentsPicked.push(String(picked.augment_id));
      } catch (e) { /* no-op */ }
    }
  }
}

function setRequiredFeatures() {
  overwolf.games.events.setRequiredFeatures(REQUIRED_FEATURES, function (res) {
    log('setRequiredFeatures', res && res.status, (res && res.error) || '');
  });
}

function attachListeners() {
  overwolf.games.events.onInfoUpdates2.addListener(onGepInfoUpdate);
  overwolf.games.events.onNewEvents.addListener(onGepEvent);
  overwolf.games.onGameInfoUpdated.addListener(function (info) {
    var gi = (info && info.gameInfo) || {};
    // Overwolf has shipped the property under several names across
    // versions: id, classId, gameId. Probe all three.
    var gid = gi.id || gi.classId || gi.gameId;
    var running = gi.isRunning;
    log('onGameInfoUpdated id=' + gi.id + ' classId=' + gi.classId + ' running=' + running + ' title=' + (gi.title || ''));
    // The manifest's `game_ids` array is what Overwolf uses to decide
    // whether to fire this listener at all — so by the time we get
    // here, the running game is one we declared. Re-arm features on
    // every transition into running, regardless of which id property
    // is populated. This avoids brittle id-matching.
    if (running) {
      setRequiredFeatures();
    } else if (running === false && matchState.observations.length > 0) {
      log('game not running — flushing observations as safety net');
      submit();
    }
  });

  // Initial probe: onGameInfoUpdated only fires on state changes. If
  // the app was reloaded mid-game, query the current running game so
  // we can arm features immediately rather than waiting for the next
  // transition.
  if (overwolf.games && overwolf.games.getRunningGameInfo) {
    overwolf.games.getRunningGameInfo(function (res) {
      if (!res) return;
      log('getRunningGameInfo id=' + res.id + ' classId=' + res.classId + ' running=' + res.isRunning + ' title=' + (res.title || ''));
      if (res.isRunning) setRequiredFeatures();
    });
  }
}

// Overwolf's "Launch" button calls the manifest's start_window — for us
// that's this background window, which is invisible. Without explicit
// help the user clicks Launch and sees nothing because the background
// runs silently. Open the desktop window here so Launch always lands
// the user on the UI; if it's already open Overwolf just restores it.
function openDesktopWindow() {
  if (typeof overwolf === 'undefined' || !overwolf.windows) return;
  overwolf.windows.obtainDeclaredWindow('desktop', function (res) {
    if (!res || res.status !== 'success' || !res.window) {
      log('obtainDeclaredWindow(desktop) failed', res && res.error);
      return;
    }
    overwolf.windows.restore(res.window.id, function () {});
  });
}

var COMPANION_BUILD = '2026-05-18T01:00-round-tracking-v6';

attachListeners();
setRequiredFeatures();
openDesktopWindow();
log('build', COMPANION_BUILD);
log('SUBMIT_URL', SUBMIT_URL);
log('CONFIG.apiBase', CONFIG && CONFIG.apiBase);
log('background listener armed');
