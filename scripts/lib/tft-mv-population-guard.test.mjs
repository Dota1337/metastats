// Tests fuer die Speicher-Entscheidung der Vergleichsgruppe
// (scripts/lib/tft-mv-population-guard.mjs). Die Zahlen sind die gemessenen
// Nachlauf-Kohorten vom 2026-10-07 (ru 12, sg2 2603).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldPersistPopulation } from './tft-mv-population-guard.mjs';

const NOW = Date.parse('2026-10-08T05:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();

test('ohne gespeicherte Gruppe wird immer gespeichert', () => {
  const r = shouldPersistPopulation({ cohort: 3, stored: null, ratedD2Plus: 900, nowMs: NOW });
  assert.equal(r.persist, true);
  assert.equal(r.ageHours, null);
});

test('Nachlauf mit 12 Spielern ueberschreibt die Gruppe des Hauptlaufs nicht', () => {
  const r = shouldPersistPopulation({ cohort: 12, stored: { playerCount: 640, computedAt: hoursAgo(5) }, ratedD2Plus: 700, nowMs: NOW });
  assert.equal(r.persist, false);
  assert.equal(r.warn, false);
  assert.ok(Math.abs(r.ageHours - 5) < 1e-9);
});

test('Kohorte so gross wie die gespeicherte wird gespeichert', () => {
  assert.equal(shouldPersistPopulation({ cohort: 640, stored: { playerCount: 640, computedAt: hoursAgo(5) }, ratedD2Plus: 2000, nowMs: NOW }).persist, true);
  assert.equal(shouldPersistPopulation({ cohort: 639, stored: { playerCount: 640, computedAt: hoursAgo(5) }, ratedD2Plus: 2000, nowMs: NOW }).persist, false);
});

test('Haelfte der bewerteten Spieler reicht, auch wenn die alte Gruppe groesser war', () => {
  // Grosse alte Gruppe, die Region ist aber geschrumpft (Abstiege).
  const r = shouldPersistPopulation({ cohort: 400, stored: { playerCount: 1200, computedAt: hoursAgo(2) }, ratedD2Plus: 800, nowMs: NOW });
  assert.equal(r.persist, true);
  assert.equal(shouldPersistPopulation({ cohort: 399, stored: { playerCount: 1200, computedAt: hoursAgo(2) }, ratedD2Plus: 800, nowMs: NOW }).persist, false);
});

test('Notausgang erst nach 36 h und mit mindestens 500 Spielern', () => {
  const stored = { playerCount: 5000, computedAt: hoursAgo(37) };
  assert.equal(shouldPersistPopulation({ cohort: 600, stored, ratedD2Plus: 2000, nowMs: NOW }).persist, true);
  assert.equal(shouldPersistPopulation({ cohort: 499, stored, ratedD2Plus: 1000, nowMs: NOW }).persist, false);
  // Viertel der bewerteten Spieler liegt ueber 500 → das Viertel gilt.
  assert.equal(shouldPersistPopulation({ cohort: 900, stored, ratedD2Plus: 4000, nowMs: NOW }).persist, false);
  assert.equal(shouldPersistPopulation({ cohort: 1000, stored, ratedD2Plus: 4000, nowMs: NOW }).persist, true);
  // Vor 36 h kein Notausgang.
  assert.equal(shouldPersistPopulation({ cohort: 600, stored: { playerCount: 5000, computedAt: hoursAgo(35) }, ratedD2Plus: 2000, nowMs: NOW }).persist, false);
});

test('kleine Region: Haelfte-Regel greift, Notausgang nicht', () => {
  // ru: 12 bewertete Spieler, alte Gruppe 20.
  assert.equal(shouldPersistPopulation({ cohort: 6, stored: { playerCount: 20, computedAt: hoursAgo(3) }, ratedD2Plus: 12, nowMs: NOW }).persist, true);
  assert.equal(shouldPersistPopulation({ cohort: 5, stored: { playerCount: 20, computedAt: hoursAgo(100) }, ratedD2Plus: 12, nowMs: NOW }).persist, false);
});

test('fehlende Zahl bewerteter Spieler: nur Groessen-Regel und Notausgang', () => {
  for (const ratedD2Plus of [null, 0, undefined, NaN]) {
    assert.equal(shouldPersistPopulation({ cohort: 100, stored: { playerCount: 640, computedAt: hoursAgo(5) }, ratedD2Plus, nowMs: NOW }).persist, false);
    assert.equal(shouldPersistPopulation({ cohort: 640, stored: { playerCount: 640, computedAt: hoursAgo(5) }, ratedD2Plus, nowMs: NOW }).persist, true);
    assert.equal(shouldPersistPopulation({ cohort: 500, stored: { playerCount: 640, computedAt: hoursAgo(40) }, ratedD2Plus, nowMs: NOW }).persist, true);
  }
});

test('Warnung ab 72 h, wenn behalten wird', () => {
  const r = shouldPersistPopulation({ cohort: 50, stored: { playerCount: 640, computedAt: hoursAgo(73) }, ratedD2Plus: 2000, nowMs: NOW });
  assert.equal(r.persist, false);
  assert.equal(r.warn, true);
  assert.equal(shouldPersistPopulation({ cohort: 50, stored: { playerCount: 640, computedAt: hoursAgo(71) }, ratedD2Plus: 2000, nowMs: NOW }).warn, false);
});

test('gespeicherte Gruppe ohne Zeitstempel gilt als alt', () => {
  const r = shouldPersistPopulation({ cohort: 600, stored: { playerCount: 5000, computedAt: null }, ratedD2Plus: 2000, nowMs: NOW });
  assert.equal(r.persist, true);
  const k = shouldPersistPopulation({ cohort: 50, stored: { playerCount: 5000, computedAt: null }, ratedD2Plus: 2000, nowMs: NOW });
  assert.equal(k.persist, false);
  assert.equal(k.warn, true);
});

test('gespeicherte Gruppe ohne Spielerzahl wird ersetzt', () => {
  assert.equal(shouldPersistPopulation({ cohort: 1, stored: { playerCount: null, computedAt: hoursAgo(1) }, ratedD2Plus: 2000, nowMs: NOW }).persist, true);
});

test('ungueltige Kohorte wirft', () => {
  assert.throws(() => shouldPersistPopulation({ cohort: -1, stored: null, ratedD2Plus: 1 }), /Kohorte/);
  assert.throws(() => shouldPersistPopulation({ cohort: NaN, stored: null, ratedD2Plus: 1 }), /Kohorte/);
});
