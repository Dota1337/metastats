// Desktop window — status badge, pause toggle, and a live tier-list pull
// from metastats.gg so users see real value the moment the app launches.
// Pause-state is mirrored to localStorage so the background listener
// respects it across restarts.

var STORAGE_KEY = 'metastats.companion.paused';
var CONFIG = (typeof window !== 'undefined' && window.METASTATS_CONFIG) || {};
var API_BASE = CONFIG.apiBase || 'https://metastats.gg';

function tierClassOf(avgPlace) {
  if (avgPlace == null) return { label: '?', color: '#5a6a80', bg: 'rgba(90,106,128,0.15)' };
  if (avgPlace < 3.8) return { label: 'S', color: '#e0c75a', bg: 'rgba(224,199,90,0.15)' };
  if (avgPlace < 4.2) return { label: 'A', color: '#7B61FF', bg: 'rgba(123,97,255,0.15)' };
  if (avgPlace < 4.5) return { label: 'B', color: '#3a8ddc', bg: 'rgba(58,141,220,0.15)' };
  return { label: 'C', color: '#5a6a80', bg: 'rgba(90,106,128,0.15)' };
}

function prettyClusterKey(key) {
  var m = /^(.+)@(\d+)_(.+)$/.exec(key || '');
  if (!m) return key || '';
  var trait = m[1].replace(/^TFT\d+_/, '').replace(/_/g, ' ');
  var carry = m[3].replace(/^TFT\d+_/, '');
  return trait + ' ' + m[2] + ' · ' + carry;
}

function renderComps(comps) {
  var box = document.getElementById('live-comps');
  if (!box) return;
  box.innerHTML = '';
  if (!comps || comps.length === 0) {
    var ph = document.createElement('div');
    ph.className = 'live-comps-placeholder';
    ph.textContent = '—';
    box.appendChild(ph);
    return;
  }
  var top = comps.slice(0, 6);
  for (var i = 0; i < top.length; i++) {
    var c = top[i];
    var tier = tierClassOf(c.avgPlacement);
    var a = document.createElement('a');
    a.href = API_BASE + '/tft/comps/' + encodeURIComponent(c.slug);
    a.target = '_blank';
    a.className = 'live-comp';
    a.innerHTML =
      '<span class="live-comp-rank">' + (i + 1) + '</span>' +
      '<span class="live-comp-tier" style="color:' + tier.color + ';background:' + tier.bg + ';border:1px solid ' + tier.color + '40">' + tier.label + '</span>' +
      '<span class="live-comp-name">' + prettyClusterKey(c.clusterKey) + '</span>' +
      '<span class="live-comp-avg">Ø ' + (c.avgPlacement != null ? c.avgPlacement.toFixed(2) : '—') + '</span>';
    box.appendChild(a);
  }
}

function loadLiveComps() {
  var box = document.getElementById('live-comps');
  if (box) box.innerHTML = '<div class="live-comps-placeholder">Lade…</div>';
  fetch(API_BASE + '/api/tft/comps?region=euw1&bucket=master_plus&days=1&patch=current&source=data')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j || !j.comps) { renderComps([]); return; }
      var sorted = j.comps.slice().sort(function (a, b) {
        return (a.avgPlacement == null ? 9 : a.avgPlacement) - (b.avgPlacement == null ? 9 : b.avgPlacement);
      });
      renderComps(sorted);
    })
    .catch(function () { renderComps([]); });
}

function isPaused() {
  try { return window.localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) { return false; }
}

function setPaused(v) {
  try { window.localStorage.setItem(STORAGE_KEY, v ? '1' : '0'); } catch (e) { /* no-op */ }
}

function renderStatus() {
  var badge = document.getElementById('status-badge');
  var text = document.getElementById('status-text');
  var btn = document.getElementById('toggle-pause');
  if (!badge || !text || !btn) return;
  if (isPaused()) {
    badge.className = 'badge badge--paused';
    badge.textContent = 'Pausiert';
    text.textContent = 'Die Datensammlung ist deaktiviert. Klicke unten, um sie wieder einzuschalten.';
    btn.textContent = 'Fortsetzen';
  } else {
    badge.className = 'badge badge--idle';
    badge.textContent = 'Wartet auf TFT-Spiel';
    text.textContent = 'Starte ein TFT-Match — die App sammelt im Hintergrund anonyme Position- und Comp-Daten.';
    btn.textContent = 'Pausieren';
  }
}

document.addEventListener('DOMContentLoaded', function () {
  renderStatus();
  var btn = document.getElementById('toggle-pause');
  if (btn) {
    btn.addEventListener('click', function () {
      setPaused(!isPaused());
      renderStatus();
    });
  }
  var refresh = document.getElementById('refresh-comps');
  if (refresh) {
    refresh.addEventListener('click', loadLiveComps);
  }
  loadLiveComps();
  // Auto-refresh every 15min so the list stays fresh without manual click.
  setInterval(loadLiveComps, 15 * 60 * 1000);
});
