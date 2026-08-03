/**
 * Regressionstests für die Crawl-Fenster-Logik.
 *
 * Warum ausgerechnet hier: Diese Datei entscheidet, welchen `day` ein Lauf
 * schreibt. Ihre Zusagen sind Datumsarithmetik um eine 05:00-UTC-Grenze — die
 * Fehlerklasse, die stumm falsche Ergebnisse liefert statt zu crashen, und die
 * man erst Tage später in den Aggregaten sieht.
 *
 * Die wichtigste Zusage ist die Zeitpunkt-Unabhängigkeit von
 * resolveDailyTargetDay: der 16:00-Watchdog-Resume muss exakt den Tag treffen,
 * den der 00:00-Lauf angepeilt hat. Driftet das, resumed der Watchdog auf einen
 * anderen Tag als den abgebrochenen — der abgebrochene bleibt für immer leer.
 * Genau ein solches Loch (27.07.2026) hat uns diese Woche beschäftigt.
 *
 * Lauf: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWindow, resolveCrawlDay, resolveDailyTargetDay } from './tft-crawl-window.mjs';

const at = (iso) => new Date(iso);
const DAY_MS = 86_400_000;

test('auto vor 05:00 UTC nimmt das Fenster von D-2', () => {
  // 03:00 am 10.: das letzte VOLLSTÄNDIGE Fenster endete am 9. um 05:00,
  // begann also am 8. um 05:00 → day = 08.
  assert.equal(resolveCrawlDay(at('2026-03-10T03:00:00Z'), 'auto'), '2026-03-08');
});

test('auto ab 05:00 UTC nimmt das Fenster von D-1', () => {
  assert.equal(resolveCrawlDay(at('2026-03-10T05:00:00Z'), 'auto'), '2026-03-09');
  assert.equal(resolveCrawlDay(at('2026-03-10T23:59:59Z'), 'auto'), '2026-03-09');
});

test('auto-Fenster ist exakt 24h und endet an einer 05:00-Grenze', () => {
  for (const iso of ['2026-03-10T03:00:00Z', '2026-03-10T12:00:00Z']) {
    const { startTime, endTime } = computeWindow(at(iso), 'auto');
    assert.equal(endTime.getTime() - startTime.getTime(), DAY_MS);
    assert.equal(startTime.getUTCHours(), 5);
    assert.equal(endTime.getUTCHours(), 5);
  }
});

test('resolveDailyTargetDay ist über den ganzen Tag konstant', () => {
  // Kernzusage: egal ob der Lauf um 00:01 startet oder der Watchdog um 16:00
  // resumed — beide müssen denselben Tag anpeilen. Sonst schreibt der Resume
  // in einen anderen Tag als der abgebrochene Lauf, und dessen Tag bleibt leer.
  const stunden = ['00:01', '04:59', '05:00', '05:01', '12:00', '16:00', '23:59'];
  const tage = stunden.map(h => resolveDailyTargetDay(at(`2026-03-10T${h}:00Z`), 'auto'));
  assert.equal(new Set(tage).size, 1, `targetDay driftet über den Tag: ${tage.join(', ')}`);
  assert.equal(tage[0], '2026-03-08');
});

test('resolveDailyTargetDay pinnt auf D-2, nicht auf D-1', () => {
  // Ein auf D-1 gepinnter Lauf würde ein noch unvollständiges Fenster
  // aggregieren — die Aggregate wären systematisch zu dünn.
  assert.equal(resolveDailyTargetDay(at('2026-03-10T12:00:00Z'), 'auto'), '2026-03-08');
});

test('dayOverride wird unverändert durchgereicht und erzeugt sein 24h-Fenster', () => {
  assert.equal(resolveDailyTargetDay(at('2026-03-10T12:00:00Z'), 'auto', '2026-07-27'), '2026-07-27');
  const { startTime, endTime } = computeWindow(at('2026-03-10T12:00:00Z'), 'auto', '2026-07-27');
  assert.equal(startTime.toISOString(), '2026-07-27T05:00:00.000Z');
  assert.equal(endTime.toISOString(), '2026-07-28T05:00:00.000Z');
});

test('mode=today erzeugt vor 05:00 UTC kein Null-Fenster', () => {
  // Ohne den Fallback wäre [today 05:00, now) negativ lang → 0 Matches,
  // und der Lauf meldete fröhlich Erfolg.
  const { startTime, endTime } = computeWindow(at('2026-03-10T02:00:00Z'), 'today');
  assert.ok(endTime > startTime, 'Fenster darf nie leer oder negativ sein');
  assert.equal(endTime.getTime() - startTime.getTime(), DAY_MS);
});

test('mode=today ab 05:00 UTC läuft bis jetzt', () => {
  const now = at('2026-03-10T09:30:00Z');
  const { startTime, endTime } = computeWindow(now, 'today');
  assert.equal(startTime.toISOString(), '2026-03-10T05:00:00.000Z');
  assert.equal(endTime.getTime(), now.getTime());
  assert.equal(resolveCrawlDay(now, 'today'), '2026-03-10');
});

test('Monatsgrenze rückwärts korrekt (kein Off-by-one)', () => {
  assert.equal(resolveCrawlDay(at('2026-03-01T03:00:00Z'), 'auto'), '2026-02-27');
  assert.equal(resolveDailyTargetDay(at('2026-03-01T20:00:00Z'), 'auto'), '2026-02-27');
});

test('Schaltjahr- und Jahreswechsel-Grenze', () => {
  assert.equal(resolveCrawlDay(at('2028-03-01T06:00:00Z'), 'auto'), '2028-02-29');
  assert.equal(resolveDailyTargetDay(at('2026-01-01T12:00:00Z'), 'auto'), '2025-12-30');
});
