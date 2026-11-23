import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FP_MAX_AGE_MS, emptyState, keySpreadMs, loadState, pruneState, recordSent, rowFingerprint, rowKey, selectChanged, targetId,
} from './mv-sync-diff.mjs';

const KEY = ['puuid', 'region', 'snapshot_date'];
const row = (puuid, final_value = 100, extra = {}) => ({
  puuid, region: 'euw1', snapshot_date: '2026-11-22', set_number: 18, final_value, multiplier: 1.25, agents: { a: 1 }, rated: true, ...extra,
});
const opts = (now, maxAgeMs = FP_MAX_AGE_MS) => ({ keyOf: (r) => rowKey(r, KEY), fpOf: (r) => rowFingerprint(r, ['updated_at']), now, maxAgeMs });
const H = 3_600_000;

test('erster Lauf ohne Zustand: alles neu und alles fuer die Peaks', () => {
  const st = emptyState('t');
  const sel = selectChanged([row('a'), row('b')], st, opts(0));
  assert.equal(sel.send.length, 2);
  assert.deepEqual(sel.counts, { total: 2, unchanged: 0, fresh: 2, changed: 0, expired: 0 });
  assert.ok(sel.meta.every((m) => m[2] === true));
});

test('unveraendert → nicht senden; geaendert → senden; abgelaufen → senden, aber nicht fuer die Peaks', () => {
  const st = emptyState('t');
  const now = 10 * 24 * H;
  const first = selectChanged([row('a'), row('b'), row('c')], st, opts(now));
  recordSent(st, first.meta, now);
  const later = now + 6 * H;
  const sel = selectChanged([row('a'), row('b', 200), row('d')], st, opts(later));
  assert.deepEqual(sel.send.map((r) => r.puuid), ['b', 'd']);
  assert.deepEqual(sel.counts, { total: 3, unchanged: 1, fresh: 1, changed: 1, expired: 0 });
  // Nach 22 h geht dieselbe Zeile noch einmal raus (Selbstheilung).
  const day = now + 22 * H + 60_000;
  const sel2 = selectChanged([row('a')], st, opts(day));
  assert.equal(sel2.send.length, 1);
  assert.equal(sel2.counts.expired, 1);
  assert.equal(sel2.meta[0][2], false, 'tägliche Neusendung zählt nicht als neu');
});

test('maxAgeMs 0 (--full): alles raus, auch unveraenderte', () => {
  const st = emptyState('t');
  const s1 = selectChanged([row('a')], st, opts(1000));
  recordSent(st, s1.meta, 1000);
  const s2 = selectChanged([row('a')], st, opts(2000, 0));
  assert.equal(s2.send.length, 1);
});

test('Fingerabdruck: updated_at egal, jede andere Spalte zaehlt, Date stabil', () => {
  const a = row('a', 100, { updated_at: new Date('2026-11-22T01:00:00Z') });
  const b = row('a', 100, { updated_at: new Date('2026-11-23T01:00:00Z') });
  assert.equal(rowFingerprint(a, ['updated_at']), rowFingerprint(b, ['updated_at']));
  assert.notEqual(rowFingerprint(a), rowFingerprint(b));
  assert.notEqual(rowFingerprint(row('a', 100)), rowFingerprint(row('a', 100, { rated: false })));
  assert.notEqual(rowFingerprint(row('a', 100)), rowFingerprint(row('a', 100, { set_number: 19 })));
  assert.equal(rowFingerprint(row('a', 100, { first_match_at: new Date(5) })), rowFingerprint(row('a', 100, { first_match_at: new Date(5) })));
  assert.notEqual(rowKey(row('a'), KEY), rowKey(row('a', 1, { snapshot_date: '2026-11-21' }), KEY));
});

test('loadState: fehlt, kaputt, andere Supabase-Adresse → leer mit Grund', () => {
  const t = targetId('https://abc.supabase.co/');
  assert.equal(t, targetId('https://ABC.supabase.co'));
  assert.notEqual(t, targetId('https://xyz.supabase.co'));
  assert.equal(loadState(null, t).reason, 'kein Zustand');
  assert.equal(loadState({ v: 1, target: t, entries: [] }, t).reason, 'Zustand unlesbar');
  assert.equal(loadState({ v: 2, target: t, entries: {} }, t).reason, 'Zustand unlesbar');
  assert.match(loadState({ v: 1, target: 'anders', entries: {} }, t).reason, /anderen Supabase-Adresse/);
  const good = { v: 1, target: t, entries: { k: ['fp', 1] } };
  assert.equal(loadState(good, t).reason, null);
  assert.equal(loadState(good, t).state, good);
});

test('pruneState entfernt nur Schluessel ausserhalb der Auswahl', () => {
  const st = { v: 1, target: 't', entries: { a: ['x', 1], b: ['y', 1] } };
  assert.equal(pruneState(st, new Set(['a'])), 1);
  assert.deepEqual(Object.keys(st.entries), ['a']);
});

test('Verteilung beim Aufbau: Versatz in [0, 22 h), Neusendung faellt auf alle vier Laeufe', () => {
  const st = emptyState('t');
  const rows = Array.from({ length: 4000 }, (_, i) => row(`p${i}`));
  const t0 = 100 * 24 * H;
  const s = selectChanged(rows, st, opts(t0));
  recordSent(st, s.meta, t0, FP_MAX_AGE_MS);
  for (const [k] of s.meta) {
    const off = keySpreadMs(k, FP_MAX_AGE_MS);
    assert.ok(off >= 0 && off < FP_MAX_AGE_MS);
  }
  const perRun = [6, 12, 18, 24].map((h) => selectChanged(rows, st, opts(t0 + h * H)).send.length);
  // Ohne Verteilung laege alles im 24-h-Lauf. Jeder Lauf bekommt einen Teil.
  assert.ok(perRun[0] > 600 && perRun[0] < perRun[3], `Verteilung ${perRun}`);
  assert.equal(perRun[3], 4000, 'nach 24 h ist jede Zeile mindestens einmal faellig');
});
