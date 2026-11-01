import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideRefresh, listingStamp, nextBundleStamp, patchDayAlarm } from './tft-data-freshness.mjs';

const HTML = '<tr><td class="link"><a href="en_us.json" title="en_us.json">en_us.json</a></td><td class="size">23.1 MiB</td><td class="date">2026-Oct-31 00:47</td></tr>'
  + '<tr><td class="link"><a href="es_ar.json">es_ar.json</a></td><td class="date">2026-Nov-01 10:00</td></tr>';
const STAMP = '2026-10-31T00:47:00.000Z';

test('Listing lesen, die richtige Datei', () => {
  assert.equal(listingStamp(HTML), STAMP);
  assert.equal(listingStamp(HTML, 'es_ar.json'), '2026-11-01T10:00:00.000Z');
  assert.equal(listingStamp('<html></html>'), null);
  assert.equal(listingStamp('<a href="en_us.json">x</a><td class="date">kaputt</td>'), null);
});

test('frische Datei zaehlt nicht als gezogen: Cloudflare koennte noch die alte liefern', () => {
  const t = Date.parse(STAMP);
  assert.equal(nextBundleStamp({ listing: STAMP, previous: 'alt', nowMs: t + 64 * 60_000 }), 'alt');
  assert.equal(nextBundleStamp({ listing: STAMP, previous: 'alt', nowMs: t + 66 * 60_000 }), STAMP);
  assert.equal(nextBundleStamp({ listing: null, previous: 'alt', nowMs: t }), 'alt');
  assert.equal(nextBundleStamp({ listing: null, previous: undefined, nowMs: t }), null);
});

const base = { manual: false, listing: STAMP, bundleStamp: STAMP, notesHash: 'a', bundleNotesHash: 'a', previousConclusion: 'success' };
const SUNDAY = new Date('2026-11-01T14:40:00Z');

test('nichts Neues: kein Lauf', () => {
  assert.deepEqual(decideRefresh({ ...base, now: SUNDAY }), { run: false, reasons: [] });
});

test('CDragon neu: erst wenn aelter als der Cache', () => {
  const listing = '2026-11-01T14:00:00.000Z';
  assert.equal(decideRefresh({ ...base, listing, now: SUNDAY }).run, false);
  assert.equal(decideRefresh({ ...base, listing, now: new Date('2026-11-01T15:10:00Z') }).run, true);
});

test('Notes geaendert, roter Vorlauf, Tageslauf, von Hand', () => {
  assert.equal(decideRefresh({ ...base, notesHash: 'b', now: SUNDAY }).run, true);
  assert.equal(decideRefresh({ ...base, previousConclusion: 'failure', now: SUNDAY }).run, true);
  assert.equal(decideRefresh({ ...base, now: new Date('2026-11-01T08:40:00Z') }).run, true);
  assert.equal(decideRefresh({ ...base, now: new Date('2026-11-01T11:10:00Z') }).run, true, 'verspaeteter Start zaehlt');
  assert.equal(decideRefresh({ ...base, now: new Date('2026-11-01T11:40:00Z') }).run, false);
  assert.equal(decideRefresh({ ...base, manual: true, now: SUNDAY }).run, true);
});

test('Quelle nicht erreichbar ist kein Grund', () => {
  assert.equal(decideRefresh({ ...base, listing: null, notesHash: null, now: SUNDAY }).run, false);
});

test('Wochen-Crawl hat Vorfahrt, von Hand nicht', () => {
  const saturday = new Date('2026-11-07T05:40:00Z');
  assert.equal(decideRefresh({ ...base, notesHash: 'b', now: saturday }).run, false);
  assert.equal(decideRefresh({ ...base, notesHash: 'b', manual: true, now: saturday }).run, true);
  assert.equal(decideRefresh({ ...base, notesHash: 'b', now: new Date('2026-11-07T08:40:00Z') }).run, true);
});

const META = { patchStarts: { a: { patch: '18.6', from_day: '2026-11-04' } } };

test('Patchtag-Alarm erst ab Mittag und nur bei altem Stand', () => {
  const alarm = (now, bundleStamp = STAMP) => patchDayAlarm({ meta: META, livePatch: '18.6', bundleStamp, now: new Date(now) });
  assert.equal(alarm('2026-11-04T09:00:00Z'), null);
  assert.match(alarm('2026-11-04T12:00:00Z'), /18\.6/);
  assert.equal(alarm('2026-11-04T12:00:00Z', '2026-11-04T08:00:00.000Z'), null);
  assert.equal(alarm('2026-11-04T12:00:00Z', null), null);
  assert.equal(patchDayAlarm({ meta: {}, livePatch: '18.6', bundleStamp: STAMP, now: new Date() }), null);
});
