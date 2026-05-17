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

const TFT_GAME_ID = 21570;
const CONFIG = (typeof window !== 'undefined' && window.METASTATS_CONFIG) || {};
const SUBMIT_URL = (CONFIG.apiBase || 'https://metastats.gg') + '/api/tft/positions/submit';
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
    log('submit', res.status, payload.observationCount, 'observations');
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

  if (f === 'match_info') {
    if (data.match_id) matchState.matchId = String(data.match_id);
    if (data.region) matchState.region = String(data.region).toLowerCase();
    if (data.opponent_info) matchState.opponentInfo = data.opponent_info;
    var rosterFromMatch = extractRoster(data);
    if (rosterFromMatch.length > 0) pushRosterToLobby(rosterFromMatch);
  }
  if (f === 'roster') {
    var roster = extractRoster(data);
    if (roster.length > 0) pushRosterToLobby(roster);
  }
  if (f === 'live_client_data') {
    if (data.active_player) {
      matchState.ownPuuid = String(
        (data.active_player && data.active_player.summoner_id) || matchState.ownPuuid || ''
      );
    }
  }
  if (f === 'board') {
    var lastObs = matchState.observations[matchState.observations.length - 1];
    var round = Number(lastObs && lastObs.round) || 0;
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
    if (ev.name === 'match_start') {
      reset();
      log('match_start');
    }
    if (ev.name === 'match_end' || ev.name === 'matchEnd') {
      try { matchState.placement = Number(ev.data || 0) || null; } catch (e) { /* no-op */ }
      log('match_end placement', matchState.placement);
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
    var inTft = info && info.gameInfo && info.gameInfo.gameId === TFT_GAME_ID && info.gameInfo.isRunning;
    if (inTft) setRequiredFeatures();
  });
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

attachListeners();
setRequiredFeatures();
openDesktopWindow();
log('background listener armed');
