// Set-Achsen-Vertrag: Existenzfragen per limit statt count=exact, optional mit
// Regionen-Filter (23.11.2026: count und `is null` brauchten 23-28 s auf
// tft_player_marketvalue_snapshots und rissen das 20-s-Limit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setAxisQueries } from './contracts.mjs';
import { ACTIVE_REGIONS } from './active-regions.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('setAxisQueries: ohne byRegion nur Spalte, Set und limit', () => {
  const q = setAxisQueries({ table: 't', minRows: 1 }, 18);
  assert.equal(q.current, 't?select=set_number&set_number=eq.18&limit=1');
  assert.equal(q.nulls, 't?select=set_number&set_number=is.null&limit=1');
  assert.equal(q.need, 1);
});

test('setAxisQueries: byRegion stellt alle aktiven Regionen vor den Set-Filter', () => {
  const q = setAxisQueries({ table: 't', setColumn: 's', minRows: 3, byRegion: true }, 19);
  const scope = `&region=in.(${ACTIVE_REGIONS.join(',')})`;
  assert.equal(q.current, `t?select=s${scope}&s=eq.19&limit=3`);
  assert.equal(q.nulls, `t?select=s${scope}&s=is.null&limit=1`);
  assert.equal(ACTIVE_REGIONS.length, 15);
});

test('setAxisQueries: minRows 0 oder fehlend fragt trotzdem nach mindestens einer Zeile', () => {
  assert.equal(setAxisQueries({ table: 't', minRows: 0 }, 18).need, 1);
  assert.equal(setAxisQueries({ table: 't' }, 18).need, 1);
});

test('contracts.json: Marktwert-Set-Achse prueft je Region', () => {
  const { contracts } = JSON.parse(readFileSync(resolve(ROOT, 'infra', 'contracts.json'), 'utf8'));
  const c = contracts.find((x) => x.id === 'set-achse/marktwert-snapshots');
  assert.equal(c.byRegion, true);
  assert.equal(c.type, 'set-axis');
});
