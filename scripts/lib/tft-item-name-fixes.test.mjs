// Item-Namen mit Apostroph. Anlass 2026-10-18: Builder und Item-Seite zeigten
// "Tacticians Crown"/"Tacticians Shield" (CommunityDragon en_us).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ITEM_NAME_FIXES, fixItemName } from './tft-item-name-fixes.mjs';

test('Nur exakt die falschen Namen werden ersetzt', () => {
  assert.equal(fixItemName('Tacticians Crown'), "Tactician's Crown");
  assert.equal(fixItemName('Tacticians Shield'), "Tactician's Shield");
  for (const ok of ["Tactician's Cape", "Tactician's Crown", 'Flora Fatalis Emblem', 'Tacticians Crown ', '', undefined]) {
    assert.equal(fixItemName(ok), ok);
  }
  // Prototyp-Schluessel sind keine Korrekturen
  assert.equal(fixItemName('toString'), 'toString');
});

test('Erzeugte Dateien tragen keinen bekannten Falschnamen', () => {
  const dir = new URL('../../public/', import.meta.url);
  const files = fs.readdirSync(dir).filter(f => /^tft-(assets|loot-tables)(-\d+)?\.json$/.test(f));
  assert.ok(files.includes('tft-assets.json') && files.some(f => f.startsWith('tft-loot-tables-')));
  for (const f of files) {
    const s = fs.readFileSync(new URL(f, dir), 'utf8');
    for (const wrong of Object.keys(ITEM_NAME_FIXES)) {
      assert.ok(!s.includes(JSON.stringify(wrong)), `${f} enthaelt ${wrong}`);
    }
  }
});
