import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  aggClSql, aggHeadSql, aggTablesDdl, rowsSelect, aggFingerprintSql,
  BOARD_COLS, UNIT_COLS, TRAIT_COLS, AGG_SUM_COLS, AGG_HEAD_COLS,
} from './explorer-agg-build.mjs';
import { VARIANTS, AGG_REV } from './explorer-agg.mjs';

// Stolperdraht (Paket 5c): der Vollaufbau uebernimmt Summen der vorigen
// Datei, solange AGG_SIG gleich ist. AGG_SIG haengt nur an variantRowsSql —
// aendert sich hier etwas anderes am Rechenweg, muessen alte Summen trotzdem
// verworfen werden. Dann AGG_REV in explorer-agg.mjs erhoehen und den Pin
// fuer die neue Stufe eintragen.
const PINS = { 0: '647731a975e91a71' };

test('Summen-SQL ausserhalb von variantRowsSql unveraendert (sonst AGG_REV erhoehen)', () => {
  const names = { b: 'B', u: 'U', t: 'T', compList: 'C' };
  const fp = aggFingerprintSql({ db: 'D', kd: 'K', f: '2026-01-01' });
  const parts = [aggClSql('B'), aggHeadSql('CL'), ...aggTablesDdl('O'),
    ...VARIANTS.flatMap((v) => [rowsSelect(v, names, 'CL', 1), rowsSelect(v, names, 'CL', -1)]),
    fp.b, fp.u, fp.t, BOARD_COLS.join(','), UNIT_COLS.join(','), TRAIT_COLS.join(','),
    AGG_SUM_COLS.join(','), AGG_HEAD_COLS.join(',')];
  const h = crypto.createHash('sha1').update(parts.join('\n')).digest('hex').slice(0, 16);
  assert.equal(h, PINS[AGG_REV],
    'SQL der Teilsummen geaendert: AGG_REV in explorer-agg.mjs erhoehen und Pin nachziehen');
});

test('Fingerabdruck: Rang nur vor der Frost-Grenze, alle gelesenen Spalten drin', () => {
  const fp = aggFingerprintSql({ db: 'D', kd: 'K', f: '2026-10-01' });
  assert.match(fp.b, /CASE WHEN x\.day < DATE '2026-10-01' THEN b\.rank END/);
  for (const c of BOARD_COLS.filter((x) => !['bid', 'day', 'rank'].includes(x))) assert.match(fp.b, new RegExp(`b\\.${c}\\b`));
  for (const c of UNIT_COLS) assert.match(fp.u, new RegExp(`u\\.${c}\\b`));
  for (const c of TRAIT_COLS) assert.match(fp.t, new RegExp(`t\\.${c}\\b`));
  assert.throws(() => aggFingerprintSql({ db: 'D', kd: 'K', f: "x'" }), /ungueltig/);
});
