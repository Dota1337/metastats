// Tests fuer die Tag-Regel der TFT-Patch-Namen (scripts/lib/tft-patch-day.mjs).
// Die Termine unten sind Riots echter Terminplan fuer Set 18/19 (Stand
// 2026-10-04, support.riotgames.com …/patch-schedule-teamfight-tactics) und
// die drei B-Patches aus den Patch-Notes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SET_LAUNCH_LOL, addDays, baseOf, crawlPatch, isDay, lolPatchFor, patchForDay, patchRanges,
  scheduleProblems, startsFor, tftBaseFromLol,
} from './tft-patch-day.mjs';
import { tftPatchLabel } from '../../app/lib/tft-patch-label.ts';

const REAL = JSON.parse(readFileSync(new URL('../../public/tft-set.json', import.meta.url), 'utf8'));

function deepFreeze(o) {
  if (o && typeof o === 'object') {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

const start = (patch, from_day, extra = {}) => ({ set: Number(patch.split('.')[0]), patch, from_day, seen_at: '2026-10-04T00:00:00Z', ...extra });
const cut = (patch, from_day, extra = {}) => ({ set: Number(patch.split('.')[0]), patch, base: baseOf(patch), from_day, ...extra });

const STARTS = [
  start('18.1', '2026-08-26'), start('18.2', '2026-09-10'), start('18.3', '2026-09-23'),
  start('18.4', '2026-10-07'), start('18.5', '2026-10-21'), start('18.6', '2026-11-04'),
  start('19.1', '2026-12-01'), start('19.2', '2026-12-15'),
];
const CUTS = [cut('18.1b', '2026-09-01'), cut('18.2b', '2026-09-14'), cut('18.3b', '2026-09-24')];
const META = deepFreeze({ setNumber: 18, latestPatch: '18.3', lolPatch: '16.19.1', patchStarts: STARTS, patchCuts: CUTS });

const meta = (over) => deepFreeze({ setNumber: 18, latestPatch: '18.3', lolPatch: '16.19.1', patchStarts: STARTS, patchCuts: CUTS, ...over });

function daysBetween(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

test('Grenztage: Go-Live gehoert zum neuen Patch, Vortag zum alten', () => {
  const cases = [
    ['2026-08-26', '18.1', 'schedule'], ['2026-08-31', '18.1', 'schedule'],
    ['2026-09-01', '18.1b', 'schedule+cut'], ['2026-09-09', '18.1b', 'schedule+cut'],
    ['2026-09-10', '18.2', 'schedule'], ['2026-09-13', '18.2', 'schedule'],
    ['2026-09-14', '18.2b', 'schedule+cut'], ['2026-09-22', '18.2b', 'schedule+cut'],
    ['2026-09-23', '18.3', 'schedule'], ['2026-09-24', '18.3b', 'schedule+cut'],
    ['2026-10-06', '18.3b', 'schedule+cut'], ['2026-10-07', '18.4', 'schedule'],
  ];
  for (const [day, patch, source] of cases) {
    const r = patchForDay(day, META);
    assert.equal(r.patch, patch, day);
    assert.equal(r.base, baseOf(patch), day);
    assert.equal(r.source, source, day);
    assert.equal(r.trusted, true, `${day}: ${r.warnings.join(' | ')}`);
    assert.equal(r.beyondSchedule, false, day);
    assert.deepEqual(r.warnings, [], day);
  }
});

test('Reihenfolge der Eintraege spielt keine Rolle', () => {
  const reversed = meta({ patchStarts: [...STARTS].reverse(), patchCuts: [...CUTS].reverse() });
  for (const d of daysBetween('2026-08-26', '2026-11-30')) {
    assert.deepEqual(patchForDay(d, reversed), patchForDay(d, META), d);
  }
  assert.deepEqual(patchRanges(reversed), patchRanges(META));
});

test('ohne Terminplan: Rueckfall auf latestPatch, nie vertrauenswuerdig', () => {
  const noSchedule = meta({ patchStarts: undefined });
  const r = patchForDay('2026-09-25', noSchedule);
  assert.equal(r.patch, '18.3b');
  assert.equal(r.source, 'fallback');
  assert.equal(r.trusted, false);
  assert.ok(r.warnings.some((w) => w.includes('Rueckfall')), r.warnings.join(' | '));

  const before = patchForDay('2026-08-20', META);
  assert.equal(before.source, 'fallback');
  assert.equal(before.trusted, false);
  assert.ok(before.warnings.some((w) => w.includes('vor dem ersten Termin')));
});

test('ungueltige Eingaben ergeben null statt einer Ausnahme', () => {
  for (const day of ['', null, undefined, '2026-9-1', '2026-02-30', '2026-13-01', 20260901, '2026-09-01T05:00:00Z']) {
    const r = patchForDay(day, META);
    assert.equal(r.patch, null, String(day));
    assert.equal(r.trusted, false, String(day));
  }
  for (const m of [null, undefined, {}, 'kaputt', 42]) {
    const r = patchForDay('2026-09-25', m);
    assert.equal(r.patch, null, String(m));
    assert.equal(r.trusted, false, String(m));
  }
  // Set 17 hat keine Termine, und latestPatch gehoert zu Set 18.
  assert.equal(patchForDay('2026-09-25', META, 17).patch, null);
  assert.equal(patchForDay('2026-09-25', META, 'x').patch, null);
  assert.equal(patchForDay('2026-09-25', META, 0).patch, null);
});

test('kaputte oder widerspruechliche Eintraege machen jeden Tag unsicher', () => {
  const broken = {
    'Patch-Nummer kaputt': meta({ patchStarts: [...STARTS, start('18.7', '2026-11-18', { patch: '18.x' })] }),
    'Set passt nicht zur Nummer': meta({ patchStarts: [...STARTS, { set: 17, patch: '18.7', from_day: '2026-11-18' }] }),
    'Datum gibt es nicht': meta({ patchStarts: [...STARTS, start('18.7', '2026-11-31')] }),
    'Basis doppelt': meta({ patchStarts: [...STARTS, start('18.2', '2026-10-01')] }),
    'zwei Patches am selben Tag': meta({ patchStarts: [...STARTS, start('18.7', '2026-11-04')] }),
    'zwei Patches am selben Tag (umgekehrt)': meta({ patchStarts: [start('18.7', '2026-11-04'), ...STARTS] }),
    'Terminplan keine Liste': meta({ patchStarts: 'kaputt' }),
    'B-Patch passt nicht zur Basis': meta({ patchCuts: [...CUTS, { set: 18, patch: '18.3c', base: '18.2', from_day: '2026-10-01' }] }),
    'B-Patch vor dem Go-Live seiner Basis': meta({ patchCuts: [...CUTS, cut('18.4b', '2026-10-05')] }),
    'B-Patch am Go-Live-Tag seiner Basis': meta({ patchCuts: [...CUTS, cut('18.4b', '2026-10-07')] }),
    'B-Patch nach dem naechsten Go-Live': meta({ patchCuts: [...CUTS, cut('18.2c', '2026-09-25')] }),
    'B-Patch ohne Basis im Terminplan': meta({ patchStarts: STARTS.filter((s) => s.patch !== '18.2') }),
    'B-Patch mit kaputtem Datum': meta({ patchCuts: [...CUTS, cut('18.4b', '2026-10-32')] }),
  };
  for (const [name, m] of Object.entries(broken)) {
    assert.ok(scheduleProblems(m).length > 0, `${name}: keine Probleme gemeldet`);
    for (const d of ['2026-09-02', '2026-09-25', '2026-10-10']) {
      const r = patchForDay(d, m);
      assert.equal(r.trusted, false, `${name} / ${d}`);
      assert.ok(r.warnings.length > 0, `${name} / ${d}: keine Warnung`);
    }
  }
});

test('der echte Terminplan meldet keine Probleme', () => {
  assert.deepEqual(scheduleProblems(META), []);
  assert.deepEqual(scheduleProblems(META, 19), []);
});

test('zweiter B-Patch auf derselben Basis loest den ersten ab', () => {
  const m = meta({ patchCuts: [...CUTS, cut('18.3c', '2026-10-01')] });
  assert.deepEqual(scheduleProblems(m), []);
  assert.equal(patchForDay('2026-09-30', m).patch, '18.3b');
  assert.equal(patchForDay('2026-10-01', m).patch, '18.3c');
  assert.equal(patchForDay('2026-10-06', m).patch, '18.3c');
  assert.equal(patchForDay('2026-10-07', m).patch, '18.4');
  assert.ok(patchForDay('2026-10-01', m).trusted);
});

test('B-Patches einer anderen Set werden ignoriert', () => {
  const m = meta({ patchCuts: [...CUTS, { set: 17, patch: '17.9b', base: '17.9', from_day: '2026-09-15' }] });
  assert.deepEqual(scheduleProblems(m), []);
  for (const d of daysBetween('2026-08-26', '2026-11-30')) {
    assert.deepEqual(patchForDay(d, m), patchForDay(d, META), d);
  }
});

test('nach dem letzten bekannten Termin ist nichts mehr sicher', () => {
  const m = meta({ patchStarts: STARTS.filter((s) => s.from_day <= '2026-10-07') });
  const before = patchForDay('2026-10-06', m);
  assert.equal(before.patch, '18.3b');
  assert.equal(before.trusted, true);
  const at = patchForDay('2026-10-07', m);
  assert.equal(at.patch, '18.4');
  assert.equal(at.beyondSchedule, true);
  assert.equal(at.trusted, false);
});

test('abgeloeste Set: Name bleibt, aber unsicher', () => {
  const old = patchForDay('2026-12-02', META, 18);
  assert.equal(old.patch, '18.6');
  assert.equal(old.trusted, false);
  assert.ok(old.warnings.some((w) => w.includes('abgeloest')));
  const fresh = patchForDay('2026-12-02', META, 19);
  assert.equal(fresh.patch, '19.1');
  assert.equal(fresh.trusted, true);
  assert.equal(patchForDay('2026-12-15', META, 19).beyondSchedule, true);
});

test('patchRanges: lueckenlose Abschnitte, deckungsgleich mit patchForDay', () => {
  const ranges = patchRanges(META);
  assert.deepEqual(ranges.map((r) => [r.patch, r.from_day, r.to_day]), [
    ['18.1', '2026-08-26', '2026-08-31'],
    ['18.1b', '2026-09-01', '2026-09-09'],
    ['18.2', '2026-09-10', '2026-09-13'],
    ['18.2b', '2026-09-14', '2026-09-22'],
    ['18.3', '2026-09-23', '2026-09-23'],
    ['18.3b', '2026-09-24', '2026-10-06'],
    ['18.4', '2026-10-07', '2026-10-20'],
    ['18.5', '2026-10-21', '2026-11-03'],
    ['18.6', '2026-11-04', '2026-11-30'],
  ]);
  for (let i = 1; i < ranges.length; i++) {
    assert.equal(addDays(ranges[i - 1].to_day, 1), ranges[i].from_day, `Luecke vor ${ranges[i].patch}`);
  }
  for (const d of daysBetween('2026-08-01', '2026-12-31')) {
    const hit = ranges.filter((r) => r.from_day <= d && (r.to_day === null || d <= r.to_day));
    if (d < '2026-08-26' || d > '2026-11-30') {
      assert.equal(hit.length, 0, d);
    } else {
      assert.equal(hit.length, 1, d);
      assert.equal(hit[0].patch, patchForDay(d, META).patch, d);
    }
  }
});

test('patchRanges: offene letzte Set, leer ohne Terminplan', () => {
  assert.deepEqual(patchRanges(META, 19).map((r) => [r.patch, r.from_day, r.to_day]), [
    ['19.1', '2026-12-01', '2026-12-14'],
    ['19.2', '2026-12-15', null],
  ]);
  assert.deepEqual(patchRanges(meta({ patchStarts: undefined })), []);
  assert.deepEqual(patchRanges(null), []);
  assert.deepEqual(patchRanges(META, 17), []);
});

test('startsFor liefert die Termine einer Set in Datumsfolge', () => {
  assert.deepEqual(startsFor(META).map((s) => s.patch), ['18.1', '18.2', '18.3', '18.4', '18.5', '18.6']);
  assert.deepEqual(startsFor(meta({ patchStarts: [...STARTS].reverse() }), 19).map((s) => s.patch), ['19.1', '19.2']);
  assert.deepEqual(startsFor(null), []);
});

test('LoL <-> TFT: Umrechnung in beide Richtungen', () => {
  assert.equal(lolPatchFor('18.1'), '16.17');
  assert.equal(lolPatchFor('18.3'), '16.19');
  assert.equal(lolPatchFor('18.3b'), '16.19');
  assert.equal(lolPatchFor('17.1'), '16.8');
  // Jahreswechsel: LoL zaehlt bis x.25 und springt dann auf (x+1).1 — dieselbe
  // Naeherung wie app/lib/tft-patch-label.ts.
  assert.equal(lolPatchFor('18.9'), '16.25');
  assert.equal(lolPatchFor('18.10'), '17.1');
  assert.equal(tftBaseFromLol('16.25', 18), '18.9');
  assert.equal(tftBaseFromLol('17.1', 18), '18.10');
  for (const bad of ['99.1', '18.0', '', null, undefined, 'abc']) assert.equal(lolPatchFor(bad), null, String(bad));

  assert.equal(tftBaseFromLol('16.19.1', 18), '18.3');
  assert.equal(tftBaseFromLol('16.17', 18), '18.1');
  assert.equal(tftBaseFromLol('16.16', 18), null);
  assert.equal(tftBaseFromLol('16.19', 99), null);
  assert.equal(tftBaseFromLol('Version 16', 18), null);
  assert.equal(tftBaseFromLol(null, 18), null);

  for (const set of Object.keys(SET_LAUNCH_LOL).map(Number)) {
    for (let minor = 1; minor <= 12; minor++) {
      assert.equal(tftBaseFromLol(lolPatchFor(`${set}.${minor}`), set), `${set}.${minor}`, `${set}.${minor}`);
    }
  }
});

test('Kreuztest: app/lib/tft-patch-label.ts rechnet LoL-Labels gleich um', () => {
  const set = REAL.setNumber;
  const latestMinor = Number(baseOf(REAL.latestPatch).split('.')[1]);
  for (let minor = 1; minor <= latestMinor + 3; minor++) {
    const base = `${set}.${minor}`;
    assert.equal(tftPatchLabel(lolPatchFor(base)), base, base);
  }
});

test('echte tft-set.json: Anker und Termine passen zusammen', () => {
  assert.ok(SET_LAUNCH_LOL[REAL.setNumber], `SET_LAUNCH_LOL fehlt fuer Set ${REAL.setNumber}`);
  assert.equal(baseOf(REAL.lolPatch), lolPatchFor(REAL.latestPatch));
  assert.deepEqual(scheduleProblems(REAL), []);
  const ranges = patchRanges(REAL);
  for (let i = 1; i < ranges.length; i++) {
    assert.equal(addDays(ranges[i - 1].to_day, 1), ranges[i].from_day, `Luecke vor ${ranges[i].patch}`);
  }
});

test('patchOverride hat keinen Einfluss auf die Tag-Regel', () => {
  const m = meta({ patchOverride: '18.9' });
  for (const d of ['2026-09-01', '2026-09-23', '2026-10-07']) {
    assert.deepEqual(patchForDay(d, m), patchForDay(d, META), d);
  }
});

test('crawlPatch: ohne Vorgabe gilt die Tag-Regel', () => {
  for (const [day, patch] of [['2026-09-23', '18.3'], ['2026-09-24', '18.3b'], ['2026-10-07', '18.4'], ['2026-09-14', '18.2b']]) {
    assert.deepEqual(crawlPatch(day, META), { set: 18, patch, warnings: [], error: null }, day);
  }
});

test('crawlPatch: Vorgabe des Treibers gewinnt, Abweichung wird gemeldet', () => {
  assert.deepEqual(crawlPatch('2026-09-24', META, { set: '18', patch: '18.3b' }), { set: 18, patch: '18.3b', warnings: [], error: null });
  const other = crawlPatch('2026-09-24', META, { patch: '18.3c' });
  assert.equal(other.patch, '18.3c');
  assert.equal(other.error, null);
  assert.deepEqual(other.warnings, ['Patch-Vorgabe 18.3c, eigene Rechnung 18.3b — die Vorgabe gilt']);

  // Set-Vorgabe ohne eigenen Terminplan: die Vorgabe traegt, alles wird gemeldet.
  const next = crawlPatch('2026-12-02', meta({ patchStarts: STARTS.filter((s) => s.set !== 19) }), { set: 19, patch: '19.1' });
  assert.equal(next.patch, '19.1');
  assert.equal(next.set, 19);
  assert.equal(next.error, null);
  assert.ok(next.warnings.some((w) => w.startsWith('Set-Vorgabe 19, tft-set.json sagt 18')), next.warnings.join(' | '));
  assert.ok(next.warnings.some((w) => w.startsWith('Patch-Vorgabe 19.1, eigene Rechnung –')), next.warnings.join(' | '));
});

test('crawlPatch: Rueckfall-Warnungen werden durchgereicht', () => {
  const r = crawlPatch('2026-09-25', meta({ patchStarts: undefined }));
  assert.equal(r.patch, '18.3b');
  assert.equal(r.error, null);
  assert.ok(r.warnings.some((w) => w.includes('Rueckfall')), r.warnings.join(' | '));
});

test('crawlPatch: kaputte Eingaben brechen ab statt zu raten', () => {
  // Die erwartete Meldung je Fall haelt fest, WELCHE Pruefung greift — sonst
  // faellt eine wegfallende Pruefung nicht auf, solange eine spaetere zufaellig
  // denselben Abbruch liefert.
  const bad = [
    ['ungueltiger Tag', '2026-02-30', META, {}, /^ungueltiger Tag "2026-02-30"$/],
    ['ungueltiger Tag trotz Vorgaben', '2026-02-30', META, { set: '18', patch: '18.3' }, /^ungueltiger Tag /],
    ['Tag fehlt', undefined, META, {}, /^ungueltiger Tag /],
    ['Set-Vorgabe keine Zahl', '2026-09-24', META, { set: 'abc' }, /^ungueltige Set-Vorgabe "abc"$/],
    ['Set-Vorgabe leer', '2026-09-24', META, { set: '' }, /^ungueltige Set-Vorgabe ""$/],
    ['Set-Vorgabe 0', '2026-09-24', META, { set: '0' }, /^ungueltige Set-Vorgabe "0"$/],
    ['Patch-Vorgabe leer', '2026-09-24', META, { patch: '' }, /^ungueltige Patch-Vorgabe ""$/],
    ['Patch-Vorgabe nicht kanonisch', '2026-09-24', META, { patch: '18.03' }, /^ungueltige Patch-Vorgabe "18\.03"$/],
    ['Patch-Vorgabe Minor 0', '2026-09-24', META, { patch: '18.0' }, /^ungueltige Patch-Vorgabe "18\.0"$/],
    ['Patch-Vorgabe zwei Buchstaben', '2026-09-24', META, { patch: '18.3bb' }, /^ungueltige Patch-Vorgabe "18\.3bb"$/],
    ['Patch-Vorgabe fremde Set', '2026-09-24', META, { patch: '17.9' }, /^Patch-Vorgabe 17\.9 gehoert nicht zu Set 18$/],
    ['ohne setNumber', '2026-09-24', meta({ setNumber: undefined }), {}, /^tft-set\.json ohne gueltige setNumber/],
    ['setNumber kaputt', '2026-09-24', meta({ setNumber: 'x' }), {}, /^tft-set\.json ohne gueltige setNumber \("x"\)$/],
    ['keine tft-set.json', '2026-09-24', null, {}, /^tft-set\.json ohne gueltige setNumber/],
    ['weder Terminplan noch passender latestPatch', '2026-09-24', meta({ patchStarts: undefined, latestPatch: '17.9' }), {}, /^kein Patch-Name fuer 2026-09-24 \(Set 18\)$/],
    ['Set-Vorgabe ohne Termin und ohne Patch-Vorgabe', '2026-12-02', meta({ patchStarts: STARTS.filter((s) => s.set !== 19) }), { set: 19 }, /^kein Patch-Name fuer 2026-12-02 \(Set 19\)$/],
  ];
  for (const [name, day, m, opts, msg] of bad) {
    const r = crawlPatch(day, m, opts);
    assert.equal(r.patch, null, name);
    assert.equal(r.set, null, name);
    assert.match(r.error ?? '', msg, name);
  }
});

test('Datums-Helfer', () => {
  assert.equal(isDay('2026-02-29'), false);
  assert.equal(isDay('2028-02-29'), true);
  assert.equal(isDay('2026-10-05'), true);
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-03-29', 1), '2026-03-30');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});
