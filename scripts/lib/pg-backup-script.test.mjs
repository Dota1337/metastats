// Fuehrt das echte Sicherungs-Skript aus, mit einem Testverzeichnis statt der
// Ablage und einer Attrappe statt `sudo -u postgres pg_dump`. Geprueft wird das
// Aufraeumen: es loescht Sicherungen, deshalb reicht Lesen des Skripts nicht.
// Braucht GNU find und flock; auf der Workstation uebersprungen, auf CI und der Box aktiv.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = readFileSync(new URL('../../infra/hetzner/metastats-pg-backup.sh', import.meta.url), 'utf8');
const REAL_DEST = SCRIPT.match(/^DEST=(.+)$/m)[1].trim();
const skip = process.platform === 'win32' ? 'braucht GNU find, flock und bash' : false;
const LOCK = '.backup.lock';
const today = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

// ages: Stunden je Tagesdatei (Name unabhaengig vom Alter, es zaehlt die
// Aenderungszeit). sizes: Bytes je Tagesdatei (Standard 1). extra: weitere
// Dateien {name, hours, dir?}. minBytes ersetzt MIN_BYTES im Skript.
function run({ ages = [], sizes = [], dumpFails = false, sortFails = false, extra = [], minBytes = 1, holdLock = false, noDest = false }) {
  const root = mkdtempSync(join(tmpdir(), 'pg-backup-test-'));
  try {
    const dest = join(root, 'backups');
    const bin = join(root, 'bin');
    if (!noDest) mkdirSync(dest);
    mkdirSync(bin);
    const now = Date.now();
    const put = (p, hours, bytes = 1) => {
      writeFileSync(p, 'x'.repeat(bytes));
      const t = new Date(now - hours * 3_600_000);
      utimesSync(p, t, t);
    };
    const files = ages.map((hours, i) => {
      const name = `metastats_1999010${i}.dump`;
      put(join(dest, name), hours, sizes[i] ?? 1);
      return { name, hours };
    });
    for (const e of extra) {
      const dir = e.dir ? join(dest, e.dir) : dest;
      mkdirSync(dir, { recursive: true });
      put(join(dir, e.name), e.hours);
      if (!e.dir) files.push({ name: e.name, hours: e.hours });
    }
    const stub = join(bin, 'sudo');
    writeFileSync(stub, dumpFails ? '#!/bin/sh\nprintf partial\nexit 1\n' : '#!/bin/sh\nprintf dump\n');
    chmodSync(stub, 0o755);
    if (sortFails) {
      const sortStub = join(bin, 'sort');
      writeFileSync(sortStub, '#!/bin/sh\nexit 1\n');
      chmodSync(sortStub, 0o755);
    }
    const copy = join(root, 'backup.sh');
    const body = SCRIPT.replace(`DEST=${REAL_DEST}`, `DEST=${dest}`).replace(/^MIN_BYTES=\d+$/m, `MIN_BYTES=${minBytes}`);
    assert.ok(!body.includes(REAL_DEST), 'echte Ablage steht noch im Testskript');
    assert.match(body, new RegExp(`^MIN_BYTES=${minBytes}$`, 'm'));
    writeFileSync(copy, body);
    const env = { PATH: `${bin}:/usr/bin:/bin` };
    // Sperre von aussen halten: der Elternprozess behaelt fd 8, das Skript
    // oeffnet die Datei neu und bekommt die Sperre nicht.
    const res = holdLock
      ? spawnSync('bash', ['-c', `exec 8>"$1/${LOCK}"; flock -n 8 || exit 99; bash "$2"`, '_', dest, copy], { encoding: 'utf8', env })
      : spawnSync('bash', [copy], { encoding: 'utf8', env });
    if (noDest) return { status: res.status, stderr: res.stderr, destExists: existsSync(dest) };
    const left = readdirSync(dest).filter((n) => n !== LOCK && !extra.some((e) => e.dir && n === e.dir)).sort();
    const hoursOf = (name) => files.find((f) => f.name === name)?.hours ?? 'neu';
    const inDirs = extra.filter((e) => e.dir).map((e) => existsSync(join(dest, e.dir, e.name)));
    return { status: res.status, stderr: res.stderr, left: left.map(hoursOf), names: left, inDirs };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const num = (xs) => xs.filter((x) => x !== 'neu').sort((a, b) => a - b);

// Alter beim Lauf um 04:30 UTC, wenn die Dumps um ~05:10 UTC fertig wurden
const HEALTHY = [23.4, 47.4, 71.4, 95.4, 119.4];

test('Normalfall: die 2 neuesten bleiben, mit dem neuen Dump liegen 3', { skip }, () => {
  const r = run({ ages: HEALTHY });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(num(r.left), [23.4, 47.4]);
  assert.equal(r.left.filter((x) => x === 'neu').length, 1);
  assert.equal(r.left.length, 3);
});

test('Stand vom 08.11. mit 2 und 3 Dateien endet ebenfalls bei 3', { skip }, () => {
  assert.equal(run({ ages: [23.4, 47.4] }).left.length, 3);
  assert.equal(run({ ages: [23.4, 47.4, 71.4] }).left.length, 3);
  assert.deepEqual(run({ ages: [23.4] }).left.length, 2);
});

test('zweiter Lauf am selben Tag: die heutige Datei zaehlt nicht mit, es bleiben 3', { skip }, () => {
  const r = run({ ages: [23.4, 47.4, 71.4], extra: [{ name: `metastats_${today()}.dump`, hours: 6 }] });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(num(r.left), [6, 23.4, 47.4]);
  assert.equal(r.left.length, 3);
});

test('Dauerausfall: die 2 neuesten bleiben, auch wenn sie zu alt sind', { skip }, () => {
  const r = run({ ages: [119.4, 143.4, 167.4], dumpFails: true });
  assert.notEqual(r.status, 0);
  assert.deepEqual(num(r.left), [119.4, 143.4]);
});

test('Dauerausfall ueber Wochen: letzte Kopie bleibt', { skip }, () => {
  const one = run({ ages: [500], dumpFails: true });
  assert.deepEqual(one.left, [500]);
  const two = run({ ages: [500, 600], dumpFails: true });
  assert.deepEqual(num(two.left), [500, 600]);
});

test('gescheiterter Dump hinterlaesst nichts unter dem echten Namen und keinen Rest', { skip }, () => {
  const r = run({ ages: [23.4], dumpFails: true });
  assert.notEqual(r.status, 0);
  assert.deepEqual(r.names, ['metastats_19990100.dump']);
});

test('leere Ablage: Dump laeuft trotzdem', { skip }, () => {
  const r = run({ ages: [] });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.left, ['neu']);
});

test('Fehler beim Aufraeumen: nichts wird geloescht, der Dump laeuft trotzdem', { skip }, () => {
  const r = run({ ages: HEALTHY, sortFails: true });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.left.filter((x) => x === 'neu').length, 1);
  assert.equal(r.left.length, HEALTHY.length + 1);
});

test('neueste Tagesdatei unter MIN_BYTES: nichts wird geloescht', { skip }, () => {
  const sizes = [10, 1000, 1000, 1000, 1000];
  const small = run({ ages: HEALTHY, sizes, minBytes: 100 });
  assert.equal(small.status, 0, small.stderr);
  assert.equal(small.left.length, HEALTHY.length + 1);
  // knapp darueber wird normal geraeumt; aeltere kleine Dateien bremsen nicht
  const ok = run({ ages: HEALTHY, sizes: [100, 1000, 5, 5, 5], minBytes: 100 });
  assert.equal(ok.left.length, 3);
});

test('nur exakte Tagesnamen direkt in der Ablage zaehlen', { skip }, () => {
  const r = run({
    ages: HEALTHY,
    extra: [
      { name: 'metastats_vor-migration.dump', hours: 1 },
      { name: 'metastats_2026110.dump', hours: 2 },
      { name: 'metastats_19980101.dump', hours: 500, dir: 'alt' },
    ],
  });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.names.includes('metastats_vor-migration.dump'));
  assert.ok(r.names.includes('metastats_2026110.dump'));
  assert.deepEqual(r.inDirs, [true]);
  assert.deepEqual(num(r.left.filter((x) => x !== 1 && x !== 2)), [23.4, 47.4]);
});

test('Reste abgebrochener Laeufe: ueber 12 h weg, frische bleiben', { skip }, () => {
  const r = run({
    ages: [23.4],
    extra: [
      { name: '.metastats_19990101.dump.tmp', hours: 13 },
      { name: '.metastats_19990102.dump.tmp', hours: 1 },
    ],
  });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.names.includes('.metastats_19990101.dump.tmp'));
  assert.ok(r.names.includes('.metastats_19990102.dump.tmp'));
});

test('laeuft schon ein Lauf, endet der zweite ohne zu loeschen und ohne Dump', { skip }, () => {
  const r = run({ ages: HEALTHY, holdLock: true });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /laeuft bereits/);
  assert.equal(r.left.length, HEALTHY.length);
  assert.ok(!r.left.includes('neu'));
});

test('Ablage fehlt (Volume nicht eingehaengt): Fehler, und nichts wird angelegt', { skip }, () => {
  const r = run({ noDest: true });
  assert.notEqual(r.status, 0);
  assert.equal(r.destExists, false);
});

test('Reihenfolge: Sperre, dann Aufraeumen, dann Dump; Fehler im Aufraeumen stoppt nicht', () => {
  const lock = SCRIPT.indexOf('flock -n 9');
  const cleanup = SCRIPT.indexOf('find "$DEST"');
  const dump = SCRIPT.indexOf('pg_dump -Fc');
  assert.ok(lock > 0 && cleanup > lock, 'Sperre muss vor dem Aufraeumen stehen');
  assert.ok(cleanup > 0 && dump > cleanup, 'Aufraeumen muss vor pg_dump stehen');
  assert.match(SCRIPT.slice(cleanup, dump), /done \|\| true/);
  assert.match(SCRIPT, /^KEEP_NEWEST=2$/m);
  assert.doesNotMatch(SCRIPT, /-mtime|RETENTION_DAYS=/);
  assert.doesNotMatch(SCRIPT, /\r/);
});

test('MIN_BYTES im Skript = minBytes im Vertrag box/datenbank-sicherung', () => {
  const reg = JSON.parse(readFileSync(new URL('../../infra/contracts.json', import.meta.url), 'utf8'));
  const c = (reg.contracts || reg).find((x) => x.id === 'box/datenbank-sicherung');
  assert.equal(Number(SCRIPT.match(/^MIN_BYTES=(\d+)$/m)?.[1]), c.minBytes);
  assert.equal(c.maxFiles, 3);
});
