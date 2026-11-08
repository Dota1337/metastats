// Vertrag disk-free (box/platz-datenplatte, box/platz-systemplatte): Bewertung
// des freien Platzes. Das Lesen (statfs, Geraetenummer) wird live geprueft
// (node scripts/check-contracts.mjs --id box/platz-datenplatte).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { evaluateDiskFree } from './contracts.mjs';
import { redactReport } from './contracts-alert.mjs';

const GB = 1e9;
const DATA = { label: 'Datenplatte', totalBytes: 211.0 * GB, warnFreeBytes: 40 * GB, minFreeBytes: 15 * GB };
const check = (freeGb, extra = {}) => evaluateDiskFree({ ...DATA, freeBytes: freeGb * GB, ...extra });
// wie reasonKey in contracts-alert.mjs: gleicher Schluessel = keine neue Mail
const mailKey = (detail) => detail.replace(/\d+/g, '#');

test('gemessener Stand vom 08.11. (89,8 GB frei) ist gruen', () => {
  // statfsSync auf der Box, 08.11.2026 nach dem Loeschen der 2 aeltesten Dumps
  const r = evaluateDiskFree({ ...DATA, freeBytes: 89805180928, totalBytes: 211047911424 });
  assert.equal(r.status, 'ok');
  assert.equal(r.detail, 'Datenplatte: 89.8 GB frei von 211.0 GB');
});

test('Grenzen: genau auf gelb gruen, knapp darunter gelb; genau auf rot gelb, darunter rot', () => {
  assert.equal(check(40).status, 'ok');
  assert.equal(check(39.99).status, 'warn');
  assert.equal(check(15).status, 'warn');
  assert.equal(check(14.99).status, 'broken');
  assert.equal(check(0).status, 'broken');
});

test('Wortlaut nennt Stufe und Grenzen', () => {
  assert.equal(check(35.2).detail, 'Datenplatte: nur noch 35.2 GB frei (gelb unter 40.0 GB, rot unter 15.0 GB)');
  assert.equal(check(12.1).detail, 'Datenplatte: nur noch 12.1 GB frei (rot unter 15.0 GB)');
});

test('innerhalb einer Stufe keine neue Mail, auch ueber Stellenwechsel; Stufenwechsel = neuer Grund', () => {
  assert.equal(mailKey(check(39.9).detail), mailKey(check(15.1).detail));
  assert.equal(mailKey(check(14.9).detail), mailKey(check(0.9).detail));
  assert.equal(mailKey(check(9.95).detail), mailKey(check(10.04).detail));
  assert.notEqual(mailKey(check(15.1).detail), mailKey(check(14.9).detail));
});

test('nicht eingehaengt ist rot, egal wie viel scheinbar frei ist', () => {
  const r = check(200, { mounted: false });
  assert.equal(r.status, 'broken');
  assert.equal(r.detail, 'Datenplatte nicht eingehaengt');
});

test('kaputte Grenzen sind ein Fehler, kein Gruen', () => {
  assert.equal(check(50, { warnFreeBytes: 10 * GB }).status, 'error');
  assert.equal(check(50, { minFreeBytes: 0 }).status, 'error');
  assert.equal(check(50, { warnFreeBytes: undefined }).status, 'error');
});

test('Text nennt keinen Pfad und bleibt bei GB', () => {
  const cases = [check(89.8), check(35), check(3), check(200, { mounted: false })];
  for (const { detail } of cases) {
    assert.doesNotMatch(detail, /[/\\]|mnt|HC_Volume|\bMB\b|GiB/, detail);
  }
});

test('oeffentlicher Grund: Lesefehler bleibt auf der Box, Befund geht raus', () => {
  const typeById = new Map([['box/platz-datenplatte', 'disk-free']]);
  const report = (status, detail) => redactReport({
    checkedAt: 'x', summary: {}, results: [{ id: 'box/platz-datenplatte', status, detail }],
  }, typeById).results[0];
  const err = report('error', "ENOENT: no such file or directory, statfs '/mnt/HC_Volume_105869432'");
  assert.doesNotMatch(err.reason, /mnt|ENOENT/);
  assert.equal(err.sensitive, false);
  const warn = check(35.2).detail;
  assert.equal(report('warn', warn).reason, warn);
});

test('Register: beide Platten, gueltige Grenzen, Owner existiert, nur die Datenplatte prueft das Einhaengen', () => {
  const reg = JSON.parse(readFileSync(new URL('../../infra/contracts.json', import.meta.url), 'utf8'));
  const list = (reg.contracts || reg).filter((x) => x.type === 'disk-free');
  assert.deepEqual(list.map((c) => c.id).sort(), ['box/platz-datenplatte', 'box/platz-systemplatte']);
  for (const c of list) {
    assert.ok(existsSync(new URL(`../../${c.owner}`, import.meta.url)), `Owner ${c.owner} fehlt`);
    assert.ok(c.label && !/[/\\]/.test(c.label), c.id);
    assert.ok(c.minFreeBytes > 0 && c.warnFreeBytes > c.minFreeBytes, c.id);
    assert.notEqual(evaluateDiskFree({ ...c, freeBytes: c.warnFreeBytes, totalBytes: 1 }).status, 'error', c.id);
  }
  const data = list.find((c) => c.id === 'box/platz-datenplatte');
  const sys = list.find((c) => c.id === 'box/platz-systemplatte');
  assert.equal(data.mountpoint, true);
  assert.equal(sys.path, '/');
  assert.ok(!sys.mountpoint, '/ hat keinen Elternordner auf einem anderen Geraet');
  // Datenplatte: Rot muss ueber einer Dump-Groesse liegen (08.11.: 9,05 GB)
  assert.ok(data.minFreeBytes > 9.05 * GB);
  // gleiche Ablage wie die Sicherung
  const backup = (reg.contracts || reg).find((x) => x.id === 'box/datenbank-sicherung');
  assert.ok(backup.dir.startsWith(`${data.path}/`));
});
