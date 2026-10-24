// Auswahllisten des Data Explorers gegen das echte Bundle (public/tft-assets.json):
// nur tragbare Items, Item-Sorte wie beim Dienst, Emblem-Regeln an der Unit.
//
// Lauf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildExplorerOptions, itemFitsUnit } from './explorer-options.ts';
import { itemKindOf } from '../../../../scripts/lib/explorer-query.mjs';

const assets = JSON.parse(readFileSync(new URL('../../../../public/tft-assets.json', import.meta.url), 'utf8'));
const o = buildExplorerOptions(assets);

test('nur Items, die eine Unit traegt: keine Verbrauchs- und Support-Items', () => {
  assert.ok(o.items.length > 50, `Items: ${o.items.length}`);
  for (const i of o.items) {
    const meta = assets.items[i.id];
    assert.ok(!(meta.tags ?? []).includes('Consumable'), `${i.id} ist Verbrauchsgegenstand`);
    assert.ok(!/\[Support item\]/i.test(meta.desc ?? ''), `${i.id} ist Support-Item`);
  }
});

test('Sorten-Knoepfe zeigen dieselbe Sorte, nach der der Dienst zaehlt', () => {
  const kinds = new Set();
  for (const i of o.items) {
    const shown = i.bucket === 'other' ? 'standard' : i.bucket; // itemGroupOf (ExplorerSearchBox)
    assert.equal(shown, itemKindOf(i.id) ?? 'standard', i.id);
    kinds.add(shown);
  }
  assert.deepEqual([...kinds].sort(), ['artifact', 'emblem', 'radiant', 'standard']);
});

test('Embleme: nicht zweimal, nicht das eines eigenen Traits; alles andere frei', () => {
  const emblems = o.items.filter(i => i.bucket === 'emblem');
  const traitNames = new Set(o.units.flatMap(u => u.traits));
  for (const e of emblems) assert.ok(traitNames.has(e.name.replace(/ Emblem$/, '')), `${e.name} ohne Trait`);
  const unit = o.units.find(u => emblems.some(e => u.traits.includes(e.name.replace(/ Emblem$/, ''))));
  const own = emblems.find(e => unit.traits.includes(e.name.replace(/ Emblem$/, '')));
  const foreign = emblems.find(e => !unit.traits.includes(e.name.replace(/ Emblem$/, '')));
  assert.equal(itemFitsUnit(o, unit.id, own.id, []), false, `${unit.name} + ${own.name}`);
  assert.equal(itemFitsUnit(o, unit.id, foreign.id, []), true, `${unit.name} + ${foreign.name}`);
  assert.equal(itemFitsUnit(o, unit.id, foreign.id, [foreign.id]), false, 'zweimal');
  const other = o.items.find(i => i.bucket !== 'emblem');
  assert.equal(itemFitsUnit(o, unit.id, other.id, [other.id, other.id]), true, 'Nicht-Embleme doppelt erlaubt');
});
