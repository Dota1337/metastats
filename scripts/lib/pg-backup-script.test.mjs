// Fuehrt das echte Sicherungs-Skript aus, mit einem Testverzeichnis statt der
// Ablage und einer Attrappe statt `sudo -u postgres pg_dump`. Geprueft wird das
// Aufraeumen: es loescht Sicherungen, deshalb reicht Lesen des Skripts nicht.
// Braucht GNU find; auf der Workstation uebersprungen, auf CI und der Box aktiv.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = readFileSync(new URL('../../infra/hetzner/metastats-pg-backup.sh', import.meta.url), 'utf8');
const REAL_DEST = SCRIPT.match(/^DEST=(.+)$/m)[1].trim();
const skip = process.platform === 'win32' ? 'braucht GNU find und bash' : false;

function run({ ages, dumpFails = false, sortFails = false }) {
  const root = mkdtempSync(join(tmpdir(), 'pg-backup-test-'));
  try {
    const dest = join(root, 'backups');
    const bin = join(root, 'bin');
    mkdirSync(dest);
    mkdirSync(bin);
    const now = Date.now();
    // Name unabhaengig vom Alter: es zaehlt die Aenderungszeit, nicht der Name.
    const files = ages.map((hours, i) => {
      const name = `metastats_1999010${i}.dump`;
      const p = join(dest, name);
      writeFileSync(p, 'x');
      const t = new Date(now - hours * 3_600_000);
      utimesSync(p, t, t);
      return { name, hours };
    });
    const stub = join(bin, 'sudo');
    writeFileSync(stub, dumpFails ? '#!/bin/sh\nprintf partial\nexit 1\n' : '#!/bin/sh\nprintf dump\n');
    chmodSync(stub, 0o755);
    if (sortFails) {
      const sortStub = join(bin, 'sort');
      writeFileSync(sortStub, '#!/bin/sh\nexit 1\n');
      chmodSync(sortStub, 0o755);
    }
    const copy = join(root, 'backup.sh');
    const body = SCRIPT.replace(`DEST=${REAL_DEST}`, `DEST=${dest}`);
    assert.ok(!body.includes(REAL_DEST), 'echte Ablage steht noch im Testskript');
    writeFileSync(copy, body);
    const res = spawnSync('bash', [copy], { encoding: 'utf8', env: { PATH: `${bin}:/usr/bin:/bin` } });
    const left = readdirSync(dest).sort();
    const hoursOf = (name) => files.find((f) => f.name === name)?.hours ?? 'neu';
    return { status: res.status, stderr: res.stderr, left: left.map(hoursOf), names: left };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// Alter beim Lauf um 04:30 UTC, wenn die Dumps um ~05:05 UTC fertig wurden
const HEALTHY = [23.4, 47.4, 71.4, 95.4, 119.4];

test('Normalfall: nur die Datei ueber 4 volle Tage geht, wie bisher bleiben 5', { skip }, () => {
  const r = run({ ages: HEALTHY });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.left.filter((x) => x !== 'neu').sort((a, b) => a - b), [23.4, 47.4, 71.4, 95.4]);
  assert.equal(r.left.filter((x) => x === 'neu').length, 1);
  assert.equal(r.left.length, 5);
});

test('Dauerausfall: die 2 neuesten bleiben, auch wenn sie zu alt sind', { skip }, () => {
  const r = run({ ages: [119.4, 143.4, 167.4], dumpFails: true });
  assert.notEqual(r.status, 0);
  assert.deepEqual(r.left.sort((a, b) => a - b), [119.4, 143.4]);
});

test('Dauerausfall ueber Wochen: letzte Kopie bleibt', { skip }, () => {
  const one = run({ ages: [500], dumpFails: true });
  assert.deepEqual(one.left, [500]);
  const two = run({ ages: [500, 600], dumpFails: true });
  assert.deepEqual(two.left.sort((a, b) => a - b), [500, 600]);
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

test('Reihenfolge: Aufraeumen vor dem Dump (Vorfall 25.06.), Fehler darin stoppt nicht', () => {
  const cleanup = SCRIPT.indexOf('find "$DEST"');
  const dump = SCRIPT.indexOf('pg_dump -Fc');
  assert.ok(cleanup > 0 && dump > cleanup, 'Aufraeumen muss vor pg_dump stehen');
  assert.match(SCRIPT.slice(cleanup, dump), /done \|\| true/);
  assert.match(SCRIPT, /^KEEP_NEWEST=2$/m);
  assert.doesNotMatch(SCRIPT, /\r/);
});
