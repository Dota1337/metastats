// Desktop window — simple status + pause toggle.
// Reads pause-state from local storage so the background listener can
// respect it across restarts.

var STORAGE_KEY = 'metastats.companion.paused';

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
});
