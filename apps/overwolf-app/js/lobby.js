// Lobby Scout — in-game window that lists the seven opponents in the
// current TFT lobby with their last-known average placement (from
// metastats.gg). Receives the roster via overwolf.windows messaging
// from the background script which subscribes to GEP `match_info`.
//
// Design intent: read-only, mirrors what the user sees on the loading
// screen anyway. No real-time coaching, no augment display — Riot ToS
// stays intact.

var CONFIG = (window.METASTATS_CONFIG) || {};
var API_BASE = CONFIG.apiBase || 'https://metastats.gg';

var rosterCache = {};      // gameName-tagLine → { avgPlacement, label }
var currentRoster = [];    // [{ gameName, tagLine, region }]

function setEmpty(text) {
  var empty = document.getElementById('lobby-empty');
  var list = document.getElementById('lobby-list');
  if (empty) { empty.textContent = text; empty.style.display = 'flex'; }
  if (list) list.style.display = 'none';
}

function render() {
  var empty = document.getElementById('lobby-empty');
  var list = document.getElementById('lobby-list');
  if (!list) return;
  if (currentRoster.length === 0) { setEmpty('Warte auf Lobby-Daten…'); return; }
  empty.style.display = 'none';
  list.style.display = 'flex';
  list.innerHTML = '';
  for (var i = 0; i < currentRoster.length; i++) {
    var opp = currentRoster[i];
    var slug = opp.gameName + '-' + opp.tagLine;
    var cacheKey = slug.toLowerCase() + '@' + (opp.region || 'euw1');
    var stats = rosterCache[cacheKey];
    var li = document.createElement('li');
    var a = document.createElement('a');
    a.href = API_BASE + '/tft/player/' + encodeURIComponent(slug)
      + (opp.region ? '?region=' + encodeURIComponent(opp.region) : '');
    a.target = '_blank';
    a.innerHTML =
      '<span class="opp-name">' + escapeHtml(opp.gameName + '#' + opp.tagLine) + '</span>' +
      (stats && stats.rank ? '<span class="opp-rank">' + escapeHtml(stats.rank) + '</span>' : '') +
      (stats && stats.avgPlacement != null
        ? '<span class="opp-place">Ø ' + stats.avgPlacement.toFixed(2) + '</span>'
        : '<span class="opp-place">–</span>');
    li.appendChild(a);
    list.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[<>&"']/g, function (c) {
    return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]);
  });
}

function fetchStatsFor(opp) {
  var cacheKey = (opp.gameName + '-' + opp.tagLine).toLowerCase() + '@' + (opp.region || 'euw1');
  if (rosterCache[cacheKey]) return;
  // We hit the public TFT summoner endpoint which returns the player's
  // recent ranked summary; the response shape includes a `ranked` block.
  // The avg-placement comes from a separate season-stats endpoint that
  // takes a puuid — we don't have it here, so for the lobby MVP we
  // surface only the rank, leaving avgPlacement empty until the user
  // clicks through. That keeps the lobby window cheap (1 fetch per opp).
  fetch(API_BASE + '/api/tft/summoner?name=' + encodeURIComponent(opp.gameName + '#' + opp.tagLine)
    + '&region=' + encodeURIComponent(opp.region || 'euw1'))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j || !j.ranked) return;
      var rank = (j.ranked.tier ? j.ranked.tier.slice(0, 1).toUpperCase() + j.ranked.tier.slice(1).toLowerCase() : '');
      if (j.ranked.rank) rank += ' ' + j.ranked.rank;
      rosterCache[cacheKey] = { rank: rank, avgPlacement: null };
      render();
    })
    .catch(function () {});
}

// Background script posts the lobby roster here via overwolf.windows
// messaging. Schema: { roster: [{ gameName, tagLine, region }, …] }
function attach() {
  if (typeof overwolf === 'undefined' || !overwolf.windows) return;
  overwolf.windows.onMessageReceived.addListener(function (msg) {
    if (!msg || msg.id !== 'lobby:roster') return;
    var data = msg.content || {};
    currentRoster = Array.isArray(data.roster) ? data.roster : [];
    render();
    for (var i = 0; i < currentRoster.length; i++) fetchStatsFor(currentRoster[i]);
  });
}

document.addEventListener('DOMContentLoaded', function () {
  var close = document.getElementById('lobby-close');
  if (close) close.addEventListener('click', function () {
    if (typeof overwolf !== 'undefined' && overwolf.windows) {
      overwolf.windows.getCurrentWindow(function (res) {
        if (res && res.window) overwolf.windows.hide(res.window.id);
      });
    } else {
      window.close();
    }
  });
  attach();
  setEmpty('Warte auf Lobby-Daten…');
});
