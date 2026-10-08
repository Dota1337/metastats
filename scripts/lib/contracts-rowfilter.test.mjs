// Tests fuer den optionalen Zeilenfilter der Vertraege (scripts/lib/contracts.mjs,
// Migration 0088). Nur Auswertung und Ablehnung — DB und Netz werden nicht
// angefasst: ein abgelehnter Filter muss VOR jedem Abruf zurueckkommen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkContract, rowFilterParts, rowFilterSupported } from './contracts.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('rowFilterParts: ohne Filter leere Anhaenge', () => {
  assert.deepEqual(rowFilterParts({}), { supa: '', pg: '' });
});

test('rowFilterParts: rated=true wird zu PostgREST- und SQL-Anhang', () => {
  assert.deepEqual(
    rowFilterParts({ rowFilter: { column: 'rated', eq: true } }),
    { supa: '&rated=eq.true', pg: ' and rated = true' },
  );
  assert.deepEqual(
    rowFilterParts({ rowFilter: { column: 'rated', eq: false } }),
    { supa: '&rated=eq.false', pg: ' and rated = false' },
  );
});

test('rowFilterParts: Spaltenname nur Kleinbuchstaben und Unterstrich', () => {
  for (const column of ['rated; drop table x', 'Rated', 'rated=1', '', 42, undefined]) {
    assert.throws(() => rowFilterParts({ rowFilter: { column, eq: true } }), /rowFilter\.column/);
  }
});

test('rowFilterParts: Wert nur true/false', () => {
  for (const eq of ['true', 1, null, undefined]) {
    assert.throws(() => rowFilterParts({ rowFilter: { column: 'rated', eq } }), /rowFilter\.eq/);
  }
});

test('rowFilterSupported: nur Standard-Frischecheck und Abdeckung', () => {
  assert.equal(rowFilterSupported({ table: 't', dateColumn: 'd' }), true);
  assert.equal(rowFilterSupported({ type: 'coverage' }), true);
  assert.equal(rowFilterSupported({ type: 'mirror' }), false);
  assert.equal(rowFilterSupported({ type: 'set-axis' }), false);
  assert.equal(rowFilterSupported({ dateColumn: 'd', windowDays: 7 }), false);
  assert.equal(rowFilterSupported({ dateColumn: 'd', noGapsInDays: 14 }), false);
  assert.equal(rowFilterSupported({ totalRowsMin: 10 }), false);
});

test('checkContract: Filter in nicht unterstuetztem Modus → error, ohne Abruf', async () => {
  const res = await checkContract({
    id: 'x', type: 'mirror', table: 't', dateColumn: 'd',
    rowFilter: { column: 'rated', eq: true },
  });
  assert.equal(res.status, 'error');
  assert.match(res.detail, /nicht ausgewertet/);
});

test('checkContract: ungueltiger Filter → error, ohne Abruf', async () => {
  const res = await checkContract({
    id: 'x', backend: 'supabase', table: 't', dateColumn: 'd', maxLagDays: 1, minRows: 1,
    rowFilter: { column: 'rated or 1=1', eq: true },
  });
  assert.equal(res.status, 'error');
  assert.match(res.detail, /rowFilter\.column/);
});

test('contracts.json: Marktwert-Frische und -Abdeckung zaehlen nur bewertete Zeilen, der Spiegel alle', () => {
  const { contracts } = JSON.parse(readFileSync(resolve(ROOT, 'infra', 'contracts.json'), 'utf8'));
  const byId = new Map(contracts.map(c => [c.id, c]));
  for (const id of [
    'marketvalue/hetzner-snapshots',
    'marketvalue/supabase-mirror',
    'marketvalue/regionen-abdeckung',
    'marketvalue/regionen-abdeckung-hetzner',
  ]) {
    const c = byId.get(id);
    assert.ok(c, `${id} fehlt`);
    assert.deepEqual(c.rowFilter, { column: 'rated', eq: true }, id);
    assert.equal(rowFilterSupported(c), true, id);
  }
  // Die Spiegel-Paritaet muss die Platzhalter mitzaehlen, sonst faellt ein
  // nicht gespiegelter Platzhalter nicht auf und Vercel zeigt den alten Wert.
  assert.equal(byId.get('marketvalue/sync-parity')?.rowFilter, undefined);
  // Kein anderer Vertrag traegt einen Filter in einem Modus, der ihn ignoriert.
  for (const c of contracts) {
    if (c.rowFilter != null) assert.equal(rowFilterSupported(c), true, c.id);
  }
});
