import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { WINDOW_NAMES } from './windows.ts';

const manifest = JSON.parse(readFileSync(new URL('../../public/manifest.json', import.meta.url), 'utf8'));

// Fehlt ein Fenster in einer der Listen, fehlt es im Paket oder Overwolf
// findet die Datei nicht — ohne Fehlermeldung beim Bauen.
test('Fensterliste = Manifest = HTML-Dateien', () => {
  assert.deepEqual(Object.keys(manifest.data.windows).sort(), [...WINDOW_NAMES].sort());
  for (const name of WINDOW_NAMES) {
    assert.equal(manifest.data.windows[name].file, `windows/${name}.html`, name);
    const html = new URL(`../windows/${name}.html`, import.meta.url);
    assert.ok(existsSync(html), `${name}.html fehlt`);
    assert.match(readFileSync(html, 'utf8'), new RegExp(`data-window="${name}"`), `${name}.html ohne data-window`);
  }
});

test('Startfenster ist das Hintergrundfenster', () => {
  assert.equal(manifest.data.start_window, 'background');
  assert.equal(manifest.data.windows.background.is_background_page, true);
});

// Das Gegner-Overlay holt sich zum Verschieben die Maus. Die feste Sperre
// (clickthrough) laesst sich zur Laufzeit nicht abschalten, nur der Stil
// inputPassThrough — bis 0.8.1 ging das Ziehen deshalb nie.
test('Gegner-Overlay: abschaltbarer Durchklick-Stil statt fester Sperre', () => {
  const w = manifest.data.windows.matchup;
  assert.equal(w.style, 'inputPassThrough');
  assert.equal(w.clickthrough, undefined);
  for (const name of WINDOW_NAMES) {
    const x = manifest.data.windows[name];
    assert.ok(!(x.clickthrough && x.style), `${name}: clickthrough und style zugleich`);
  }
});

// Die Verknuepfung auf dem Desktop haengt an der App-Kennung, und die haengt an
// Name und Autor (tools/install-shortcuts.ps1). Aendern = neue Kennung.
test('Name und Autor bleiben gleich (App-Kennung)', () => {
  assert.equal(manifest.meta.name, 'metastats.gg Companion');
  assert.equal(manifest.meta.author, 'metastats.gg');
});
