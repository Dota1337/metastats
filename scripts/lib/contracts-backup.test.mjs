// Vertrag backup-file (box/datenbank-sicherung): Bewertung von Alter und Groesse
// der neuesten Sicherung. Das Lesen der Ablage wird live geprueft
// (node scripts/check-contracts.mjs --id box/datenbank-sicherung).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { evaluateBackupFile } from './contracts.mjs';
import { redactReport } from './contracts-alert.mjs';

const H = 3_600_000;
const GB = 1e9;
const NOW = Date.parse('2026-11-03T23:00:00Z');
const RULES = { now: NOW, maxAgeHours: 30, repeatAlarmHours: 72, minBytes: 0.3 * GB, minShareOfLargest: 0.7 };

const file = (gb, hoursAgo) => ({ bytes: gb * GB, mtimeMs: NOW - hoursAgo * H });
const check = (files) => evaluateBackupFile({ files, ...RULES });
// wie reasonKey in contracts-alert.mjs: gleicher Schluessel = keine neue Mail
const mailKey = (detail) => detail.replace(/\d+/g, '#');

// ls -la in der Ablage, 03.11.2026
const MEASURED = [
  { bytes: 5910415679, mtimeMs: Date.parse('2026-10-30T04:57:00Z') },
  { bytes: 6310434422, mtimeMs: Date.parse('2026-10-31T05:00:00Z') },
  { bytes: 6697752929, mtimeMs: Date.parse('2026-11-01T05:04:00Z') },
  { bytes: 7055311281, mtimeMs: Date.parse('2026-11-02T05:07:00Z') },
  { bytes: 7437794559, mtimeMs: Date.parse('2026-11-03T05:08:00Z') },
];

test('gemessener Stand vom 03.11. ist gruen', () => {
  const r = check(MEASURED);
  assert.equal(r.status, 'ok');
  assert.equal(r.detail, 'Neueste Sicherung 18 h alt, 7.44 GB, 5 Dateien');
});

test('ausgefallener Tag ist rot, unabhaengig von der Reihenfolge der Dateien', () => {
  const r = check(MEASURED.slice(0, 4).reverse());
  assert.equal(r.status, 'broken');
  assert.match(r.detail, /^Neueste Sicherung 42 h alt \(max 30 h\)$/);
});

test('Grenze 30 h: genau 30 h gilt noch, darueber rot', () => {
  assert.equal(check([file(7, 30)]).status, 'ok');
  assert.equal(check([file(7, 30.1)]).status, 'broken');
});

test('wachsendes Alter loest keine weitere Mail aus, ab 72 h genau eine', () => {
  const at = (h) => mailKey(check([file(7, h)]).detail);
  assert.equal(at(42), at(66));
  assert.notEqual(at(66), at(90));
  assert.equal(at(90), at(114));
  assert.match(check([file(7, 72)]).detail, /der Ausfall dauert an$/);
  assert.doesNotMatch(check([file(7, 71.9)]).detail, /dauert an/);
});

test('leere Ablage ist rot', () => {
  const r = check([]);
  assert.equal(r.status, 'broken');
  assert.equal(r.detail, 'Keine Sicherung vorhanden');
});

test('Untergrenze 0,3 GB: darunter rot, genau darauf gruen', () => {
  assert.equal(check([file(0.29, 18)]).status, 'broken');
  assert.match(check([file(0.29, 18)]).detail, /nur 0\.29 GB \(min 0\.30 GB\)/);
  assert.equal(check([file(0.3, 18)]).status, 'ok');
});

test('eine einzelne Datei wird nur gegen die Untergrenze geprueft', () => {
  assert.equal(check([file(0.5, 18)]).status, 'ok');
});

test('Abfall unter 70 % der groessten Datei ist gelb, knapp darueber gruen', () => {
  assert.equal(check([file(5.2, 18), file(7.44, 42)]).status, 'warn');
  assert.equal(check([file(5.21, 18), file(7.44, 42)]).status, 'ok');
});

test('Abfall bleibt gelb, solange die grosse Datei noch da ist (kein Selbstheilen)', () => {
  // Tag 2 nach dem Absturz: gegen die Vortagsdatei waere das gruen.
  assert.equal(check([file(3, 18), file(3, 42), file(7.44, 66)]).status, 'warn');
});

test('langsamer Schwund von 25 % je Tag wird gemeldet', () => {
  assert.equal(check([file(4.19, 18), file(5.58, 42), file(7.44, 66)]).status, 'warn');
});

test('Wachstum um gemessene 6 % je Tag ist gruen', () => {
  assert.equal(check([file(7.44, 18), file(7.06, 42), file(5.91, 114)]).status, 'ok');
});

test('mehr als maxFiles Dateien ist gelb, genau maxFiles gruen (08.11.: Aufraeumen nach Anzahl)', () => {
  const three = [file(9.05, 18), file(8.74, 42), file(8.43, 66)];
  assert.equal(check(three).status, 'ok');
  assert.equal(evaluateBackupFile({ files: three, ...RULES, maxFiles: 3 }).status, 'ok');
  const four = [...three, file(8.1, 90)];
  const r = evaluateBackupFile({ files: four, ...RULES, maxFiles: 3 });
  assert.equal(r.status, 'warn');
  assert.equal(r.detail, '4 Sicherungen liegen in der Ablage (erwartet hoechstens 3)');
  assert.equal(mailKey(r.detail), mailKey(evaluateBackupFile({ files: [...four, file(7.7, 114)], ...RULES, maxFiles: 3 }).detail));
  // rot schlaegt gelb: ein ausgefallener Tag bleibt rot, auch bei zu vielen Dateien
  assert.equal(evaluateBackupFile({ files: four.map((f) => ({ ...f, mtimeMs: f.mtimeMs - 30 * H })), ...RULES, maxFiles: 3 }).status, 'broken');
});

test('Text nennt weder Pfad noch Dateinamen und bleibt bei h und GB', () => {
  const cases = [
    check(MEASURED), check([]), check([file(7, 42)]), check([file(7, 90)]),
    check([file(0.1, 18)]), check([file(5, 18), file(7.44, 42)]),
  ];
  for (const { detail } of cases) {
    assert.doesNotMatch(detail, /[/\\]|metastats_|\.dump|\bMB\b|Tage/, detail);
  }
  // 0,95 GB und 1,20 GB duerfen keine verschiedenen Gruende sein
  const small = (gb) => mailKey(evaluateBackupFile({ files: [file(gb, 18)], ...RULES, minBytes: 2 * GB }).detail);
  assert.equal(small(0.95), small(1.2));
});

test('oeffentlicher Grund: Lesefehler bleibt auf der Box, Befund geht raus', () => {
  const typeById = new Map([['box/datenbank-sicherung', 'backup-file']]);
  const report = (status, detail) => redactReport({
    checkedAt: 'x', summary: {}, results: [{ id: 'box/datenbank-sicherung', status, detail }],
  }, typeById).results[0];
  const err = report('error', "ENOENT: no such file or directory, scandir '/mnt/x/backups'");
  assert.doesNotMatch(err.reason, /mnt|ENOENT/);
  assert.equal(err.sensitive, false);
  assert.equal(report('broken', 'Neueste Sicherung 42 h alt (max 30 h)').reason, 'Neueste Sicherung 42 h alt (max 30 h)');
});

test('Vertrag im Register passt zum Sicherungs-Skript', () => {
  const reg = JSON.parse(readFileSync(new URL('../../infra/contracts.json', import.meta.url), 'utf8'));
  const c = (reg.contracts || reg).find((x) => x.id === 'box/datenbank-sicherung');
  assert.ok(c, 'box/datenbank-sicherung fehlt');
  assert.equal(c.type, 'backup-file');
  assert.ok(existsSync(new URL(`../../${c.owner}`, import.meta.url)), `Owner ${c.owner} fehlt`);

  const sh = readFileSync(new URL('../../infra/hetzner/metastats-pg-backup.sh', import.meta.url), 'utf8');
  assert.equal(sh.match(/^DEST=(.+)$/m)?.[1].trim(), c.dir);
  assert.match(sh, /"\$DEST\/metastats_\$\{DATE\}\.dump"/);
  const name = new RegExp(c.namePattern);
  assert.ok(name.test('metastats_20261103.dump'));
  assert.ok(!name.test('.metastats_20261103.dump.tmp'));

  // Die Grenze muss zwischen "heute" (~18 h) und "gestern" (~42 h) liegen.
  assert.ok(c.maxAgeHours > 24 && c.maxAgeHours < 42, `maxAgeHours ${c.maxAgeHours}`);
  // Die zweite Mail muss spaeter als die erste kommen und innerhalb weniger Tage.
  assert.ok(c.repeatAlarmHours > 42 + 24 && c.repeatAlarmHours <= 96, `repeatAlarmHours ${c.repeatAlarmHours}`);
});
