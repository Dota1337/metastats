import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMon, monitorCount, gameMonitor, monitorOf, pickTarget, centerOn, isOffscreen, type Mon } from './monitors.ts';

// Aufbau des Entwickler-PCs (gemessen 10.10.): drei 1920x1080, links negativ.
const D1: Mon = { id: '\\\\.\\DISPLAY1', x: 0, y: 0, width: 1920, height: 1080, primary: true, handle: 101 };
const D2: Mon = { id: '\\\\.\\DISPLAY2', x: 1920, y: 0, width: 1920, height: 1080, primary: false, handle: 102 };
const D3: Mon = { id: '\\\\.\\DISPLAY3', x: -1920, y: 0, width: 1920, height: 1080, primary: false, handle: 103 };
const three = [D1, D2, D3];

test('toMon: Overwolf-Display einlesen, Unsinn verwerfen', () => {
  assert.deepEqual(
    toMon({ id: 'X', x: -1920, y: 0, width: 1920, height: 1080, is_primary: false, handle: { value: 7 } }),
    { id: 'X', x: -1920, y: 0, width: 1920, height: 1080, primary: false, handle: 7 },
  );
  assert.equal(toMon({ id: 'X', x: 0, y: 0, width: 0, height: 1080 }), null);
  assert.equal(toMon({ x: 0, y: 0, width: 10, height: 10 }), null);
  assert.equal(toMon({ id: 'X', x: 0, y: 0, width: 10, height: 10, handle: null })?.handle, null);
});

test('monitorCount: leer oder unbekannt = 1', () => {
  assert.equal(monitorCount(null), 1);
  assert.equal(monitorCount([]), 1);
  assert.equal(monitorCount(three), 3);
});

test('gameMonitor: per Handle, sonst Hauptbildschirm', () => {
  assert.equal(gameMonitor(three, 102), D2);
  assert.equal(gameMonitor(three, null), D1);
  assert.equal(gameMonitor(three, 999), D1);
  assert.equal(gameMonitor([], null), null);
});

test('pickTarget: 1 Bildschirm = keiner; gewaehlter zuerst; sonst naechster, rechts bei Gleichstand', () => {
  assert.equal(pickTarget([D1], 101, null), null);
  assert.equal(pickTarget([D1, D2], 101, null), D2);
  assert.equal(pickTarget(three, 101, null), D2);
  assert.equal(pickTarget(three, 101, D3.id), D3);
  // Gewaehlt ist der Spiel-Bildschirm: zaehlt nicht.
  assert.equal(pickTarget(three, 102, D2.id), D1);
  assert.equal(pickTarget(three, 103, null), D1);
});

test('centerOn: mittig, hoechstens 90 %, auch bei negativen Koordinaten', () => {
  assert.deepEqual(centerOn(D3, { width: 1280, height: 800 }), { left: -1920 + 320, top: 140, width: 1280, height: 800 });
  assert.deepEqual(centerOn(D2, { width: 3000, height: 2000 }), { left: 1920 + 96, top: 54, width: 1728, height: 972 });
});

test('monitorOf und isOffscreen', () => {
  assert.equal(monitorOf(three, { left: -1500, top: 100, width: 800, height: 600 }), D3);
  assert.equal(monitorOf(three, { left: 0, top: 0, width: 10, height: 10 }, D2.id), D2);
  assert.equal(monitorOf(three, { left: 9000, top: 0, width: 10, height: 10 }), null);
  assert.equal(isOffscreen(three, { left: 9000, top: 0, width: 800, height: 600 }), true);
  assert.equal(isOffscreen(three, { left: -1500, top: 100, width: 800, height: 600 }), false);
  assert.equal(isOffscreen(three, { left: 100, top: -200, width: 800, height: 600 }), true);
  assert.equal(isOffscreen([], { left: 9000, top: 0, width: 800, height: 600 }), false);
});
