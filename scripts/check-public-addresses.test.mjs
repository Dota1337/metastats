import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  boxVariants, certsWithAddress, findPublicIPv4, hasPrivateKey, isPublicIPv4, localBoxIp, scanRepo,
} from './check-public-addresses.mjs';

// Beispielwerte zusammengesetzt, damit diese Datei sich nicht selbst meldet.
const PUB = ['37', '120', '5', '9'].join('.');
const KEY_HEAD = '-----BEGIN ' + 'PRIVATE KEY-----';

test('Repo: keine oeffentliche Adresse, kein Adress-Zertifikat, kein privater Schluessel', () => {
  const found = scanRepo({ boxIp: localBoxIp() });
  assert.deepEqual(found.map((f) => `${f.file}:${f.line} ${f.kind}`), []);
});

test('isPublicIPv4: private, Loopback und Doku-Netze sind frei', () => {
  for (const ip of ['10.0.0.1', '127.0.0.1', '172.20.1.1', '192.168.1.1', '169.254.1.1', '100.64.0.1',
    '192.0.2.5', '198.51.100.1', '203.0.113.7', '0.0.0.0', '255.255.255.255']) {
    assert.equal(isPublicIPv4(ip), false, ip);
  }
  assert.equal(isPublicIPv4(PUB), true);
  assert.equal(isPublicIPv4('999.1.1.1'), false);
});

test('findPublicIPv4: findet Adressen auch in Kommentaren, nicht Versionsnummern', () => {
  assert.deepEqual(findPublicIPv4(`// ssh root@${PUB} 'x'`), [PUB]);
  assert.deepEqual(findPublicIPv4(`"host": "${PUB}"`), [PUB]);
  assert.deepEqual(findPublicIPv4('Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36'), []);
  assert.deepEqual(findPublicIPv4('version 1.2.3.4.5'), []);
  assert.deepEqual(findPublicIPv4('fixture 1.2.3.4'), []);
});

test('hasPrivateKey: PEM-, OpenSSH- und PuTTY-Schluessel', () => {
  assert.equal(hasPrivateKey(KEY_HEAD), true);
  assert.equal(hasPrivateKey('-----BEGIN ' + 'EC PRIVATE KEY-----'), true);
  assert.equal(hasPrivateKey('-----BEGIN ' + 'OPENSSH PRIVATE KEY-----'), true);
  assert.equal(hasPrivateKey('PuTTY-User-Key-File-' + '3: ssh-ed25519'), true);
  assert.equal(hasPrivateKey('-----BEGIN CERTIFICATE-----'), false);
});

test('boxVariants: Bindestrich, rueckwaerts, Unterstrich', () => {
  assert.deepEqual(boxVariants('203.0.113.7'), ['203-0-113-7', '7-113-0-203', '203_0_113_7']);
  assert.deepEqual(boxVariants(null), []);
});

let hasOpenssl = true;
try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); } catch { hasOpenssl = false; }

test('certsWithAddress: Zertifikat mit IP im SAN wird erkannt, Namens-Zertifikat nicht', { skip: !hasOpenssl && 'openssl fehlt' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'pubaddr-'));
  const make = (name, subj, san) => {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
      '-days', '2', '-subj', subj, '-addext', `subjectAltName=${san}`,
      '-keyout', join(dir, `${name}.key`), '-out', join(dir, `${name}.pem`)], { stdio: 'ignore' });
    return readFileSync(join(dir, `${name}.pem`), 'utf8');
  };
  try {
    assert.equal(certsWithAddress(make('ip', '/CN=x', 'IP:203.0.113.7')).length, 1);
    assert.equal(certsWithAddress(make('cn', '/CN=203.0.113.7', 'DNS:x.invalid')).length, 1);
    assert.equal(certsWithAddress(make('name', '/CN=box.invalid', 'DNS:box.invalid')).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scanRepo: Gegenprobe in einem Wegwerf-Repo findet jede Art', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pubaddr-repo-'));
  try {
    const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
    git('init', '-q');
    writeFileSync(join(dir, 'a.conf'), `# scp x root@${PUB}:/etc/x\n`);
    writeFileSync(join(dir, 'b.md'), `static.${['9', '5', '120', '37'].join('.')}.clients.your-server${'.de'}\n`);
    writeFileSync(join(dir, 'e.md'), `Server unter ${PUB}.\n`);
    writeFileSync(join(dir, 'c.txt'), `${KEY_HEAD}\nabc\n`);
    writeFileSync(join(dir, 'd.txt'), 'host-203-0-113-7.example\n');
    writeFileSync(join(dir, 'ok.txt'), 'http://127.0.0.1:4100 Chrome/131.0.0.0 203.0.113.7 v1.2.3.4.5 HeadlessChrome/120.0.0.0\n');
    writeFileSync(join(dir, 'ungetrackt.txt'), `${PUB}\n`);
    git('add', 'a.conf', 'b.md', 'c.txt', 'd.txt', 'e.md', 'ok.txt');
    const kinds = scanRepo({ root: dir, boxIp: '203.0.113.7' }).map((f) => `${f.file} ${f.kind}`).sort();
    assert.deepEqual(kinds, [
      'a.conf oeffentliche IPv4-Adresse',
      'b.md Hetzner-Rueckwaertsname',
      'b.md oeffentliche IPv4-Adresse',
      'c.txt privater Schluessel',
      'd.txt Box-Adresse (andere Schreibweise)',
      'e.md oeffentliche IPv4-Adresse',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
