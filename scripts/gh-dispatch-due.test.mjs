import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cronsOf, cronMatches, dueSlot, DISPATCH } from './gh-dispatch-due.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const at = (s) => new Date(s);

test('jede Workflow-Datei hat lesbare cron-Zeilen', () => {
  for (const [file, inputsByCron] of Object.entries(DISPATCH)) {
    const crons = cronsOf(readFileSync(join(ROOT, '.github', 'workflows', file), 'utf8'));
    assert.ok(crons.length > 0, `${file}: keine cron-Zeile`);
    for (const c of crons) cronMatches(c, at('2026-11-08T00:00:00Z'));   // wirft bei unbekannter Syntax
    for (const c of Object.keys(inputsByCron)) assert.ok(crons.includes(c), `${file}: inputs fuer ${c}, aber keine solche cron-Zeile`);
  }
});

test('Listen, Stunden, Wochentag', () => {
  const e = '40 2,5,8,11,14,17,20,23 * * *';
  assert.equal(cronMatches(e, at('2026-11-08T05:40:00Z')), true);
  assert.equal(cronMatches(e, at('2026-11-08T06:40:00Z')), false);
  assert.equal(cronMatches('40 3 * * 4', at('2026-11-12T03:40:00Z')), true);    // Donnerstag
  assert.equal(cronMatches('40 3 * * 4', at('2026-11-11T03:40:00Z')), false);   // Mittwoch
  assert.equal(cronMatches('*/15 * * * *', at('2026-11-08T07:45:00Z')), true);
  assert.equal(cronMatches('*/15 * * * *', at('2026-11-08T07:44:00Z')), false);
});

test('Fenster: Termin bis 5 Minuten zurueck, nicht aelter, nicht in der Zukunft', () => {
  const e = '17 2 * * *';
  assert.equal(dueSlot(e, at('2026-11-08T02:17:00Z'))?.toISOString(), '2026-11-08T02:17:00.000Z');
  assert.equal(dueSlot(e, at('2026-11-08T02:22:59Z'))?.toISOString(), '2026-11-08T02:17:00.000Z');
  assert.equal(dueSlot(e, at('2026-11-08T02:23:00Z')), null);
  assert.equal(dueSlot(e, at('2026-11-08T02:16:59Z')), null);
});

test('5-Minuten-Takt verpasst keinen Termin der echten Zeitplaene', () => {
  const all = Object.keys(DISPATCH).flatMap((f) => cronsOf(readFileSync(join(ROOT, '.github', 'workflows', f), 'utf8')));
  const start = Date.parse('2026-11-09T00:00:00Z');   // Montag, eine Woche
  for (const e of all) {
    for (let m = 0; m < 7 * 1440; m++) {
      const d = new Date(start + m * 60_000);
      if (!cronMatches(e, d)) continue;
      const tick = new Date(Math.ceil(d.getTime() / 300_000) * 300_000);   // naechster 5-Minuten-Lauf
      assert.equal(dueSlot(e, tick)?.getTime(), d.getTime(), `${e} @ ${d.toISOString()}`);
    }
  }
});

test('unbekannte Syntax wirft statt still nichts zu tun', () => {
  assert.throws(() => cronMatches('0 3 * * MON', at('2026-11-09T03:00:00Z')));
  assert.throws(() => cronMatches('0 3 * *', at('2026-11-09T03:00:00Z')));
});
