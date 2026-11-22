#!/usr/bin/env node
// Waechter: keine oeffentliche Server-Adresse und kein privater Schluessel im
// Repo (seit 22.11.2026). Das Repo ist oeffentlich; die Adresse der Box stand in
// 16 Dateien und im gepinnten Zertifikat. Sie kommt seitdem nur noch aus
// geheimen Einstellungen (HETZNER_REFRESH_URL / HETZNER_HOST).
//
// Geprueft werden alle getrackten Textdateien (git grep, beachtet nur Getracktes):
//   1. oeffentliche IPv4-Adressen, auch in Kommentaren. Frei: private Netze,
//      Loopback, Dokumentations-Netze (192.0.2/24, 198.51.100/24, 203.0.113/24),
//      Versionsnummern wie Chrome/131.0.0.0 und bekannte Platzhalter.
//   2. Rueckwaerts-Namen von Hetzner (static.<Adresse>.clients.your-server[.]de)
//      — darin steht die Adresse, nur anders geschrieben.
//   3. Zertifikate (PEM), in deren Subject oder SAN eine Adresse steht.
//   4. private Schluessel. Doppelt zu gitleaks (.github/workflows/secret-scan.yml),
//      das aber erst NACH dem Push laeuft — dann waere der Schluessel schon oeffentlich.
//   5. nur lokal, wenn die Box-Adresse in .env.local steht: deren Schreibweisen
//      mit Bindestrich/Unterstrich (z. B. in Hostnamen).
//
// Aufruf: node scripts/check-public-addresses.mjs   (Fund → Exit 1)
// Laeuft ueber scripts/check-public-addresses.test.mjs in npm test (pre-push + CI).
// Ausgaben nennen Datei und Zeile, nie den gefundenen Wert.

import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { isIPv4 } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boxHost } from './lib/box-host.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} ip */
export function isPublicIPv4(ip) {
  if (!isIPv4(ip)) return false;
  const [a, b, c] = ip.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

// Keine Adressen: Platzhalter in Testdaten.
const KNOWN_NON_ADDRESSES = new Set(['1.2.3.4']);
// Versionsnummer direkt hinter einem Produktnamen (User-Agent: Chrome/131.0.0.0).
const VERSION_CONTEXT = /[A-Za-z]\/$/;
// Nicht Teil einer laengeren Zahlenkette (1.2.3.4.5), ein Punkt am Satzende
// zaehlt aber nicht als Verlaengerung.
const IPV4 = /(?<!\d)(?<!\d\.)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?!\d)(?!\.\d)/g;

/** Oeffentliche IPv4-Adressen in einem Textstueck. @param {string} text */
export function findPublicIPv4(text) {
  const out = [];
  for (const m of text.matchAll(IPV4)) {
    const ip = m[0];
    if (!isPublicIPv4(ip) || KNOWN_NON_ADDRESSES.has(ip)) continue;
    if (VERSION_CONTEXT.test(text.slice(0, m.index))) continue;
    out.push(ip);
  }
  return out;
}

const PRIVATE_KEY = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----|PuTTY-User-Key-File-\d/;
/** @param {string} text */
export function hasPrivateKey(text) {
  return PRIVATE_KEY.test(text);
}

const PEM_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
/** Fingerabdruecke der Zertifikate mit Adresse in Subject oder SAN. @param {string} text */
export function certsWithAddress(text) {
  const out = [];
  for (const m of text.matchAll(PEM_BLOCK)) {
    let x;
    try { x = new X509Certificate(m[0]); } catch { continue; }
    const san = x.subjectAltName || '';
    if (/IP Address:/.test(san) || new RegExp(IPV4.source).test(x.subject)) out.push(x.fingerprint256);
  }
  return out;
}

/** Andere Schreibweisen der Box-Adresse (nur lokal bekannt). @param {string | null} ip */
export function boxVariants(ip) {
  if (!ip || !isIPv4(ip)) return [];
  const p = ip.split('.');
  return [p.join('-'), [...p].reverse().join('-'), p.join('_')];
}

function gitGrep(args, cwd) {
  try {
    return execFileSync('git', ['grep', '-I', ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    if (err.status === 1) return ''; // kein Treffer
    throw new Error(`git grep fehlgeschlagen (Exit ${err.status})`);
  }
}

// "datei:zeile:treffer" — Dateinamen ohne Doppelpunkt (git ls-files im Repo).
function parse(out) {
  return out.split('\n').filter(Boolean).map((l) => {
    const i = l.indexOf(':');
    const j = l.indexOf(':', i + 1);
    return { file: l.slice(0, i), line: Number(l.slice(i + 1, j)), text: l.slice(j + 1) };
  });
}

/** Box-Adresse aus der Umgebung bzw. .env.local, falls vorhanden. */
export function localBoxIp(root = ROOT) {
  const env = { ...process.env };
  const file = join(root, '.env.local');
  if (existsSync(file)) {
    for (const l of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = l.match(/^\s*(HETZNER_HOST|HETZNER_REFRESH_URL)\s*=\s*(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, '$2');
    }
  }
  const host = boxHost(env);
  return host && isIPv4(host) ? host : null;
}

/**
 * @param {{ root?: string, boxIp?: string | null }} [opts]
 * @returns {{ file: string, line: number, kind: string }[]}
 */
export function scanRepo({ root = ROOT, boxIp = null } = {}) {
  const found = [];
  // Kurzer Vorlauf (Produktname) fuer die Versions-Ausnahme; -o, damit lange
  // Zeilen (minifizierte JSON-Dateien) nicht ganz ausgegeben werden.
  const ipOut = gitGrep(['-n', '-o', '-E', '-e', '[A-Za-z0-9/._-]{0,8}[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}([.][0-9]{1,3})?', '--', '.', ':!*.svg'], root);
  for (const h of parse(ipOut)) {
    if (findPublicIPv4(h.text).length) found.push({ file: h.file, line: h.line, kind: 'oeffentliche IPv4-Adresse' });
  }
  for (const h of parse(gitGrep(['-n', '-i', '-o', '-E', '[a-z0-9.-]*your-server[.]de', '--', '.'], root))) {
    found.push({ file: h.file, line: h.line, kind: 'Hetzner-Rueckwaertsname' });
  }
  // -e vor jedem Muster: es beginnt mit '-' und waere sonst eine Option.
  for (const h of parse(gitGrep(['-n', '-o', '-E', '-e', '-----BEGIN ([A-Z0-9]+ )*PRIVATE KEY-----|PuTTY-User-Key-File-[0-9]', '--', '.'], root))) {
    if (hasPrivateKey(h.text)) found.push({ file: h.file, line: h.line, kind: 'privater Schluessel' });
  }
  for (const file of gitGrep(['-l', '-F', '-e', '-----BEGIN CERTIFICATE-----', '--', '.'], root).split('\n').filter(Boolean)) {
    if (certsWithAddress(readFileSync(join(root, file), 'utf8')).length) found.push({ file, line: 0, kind: 'Zertifikat mit Adresse' });
  }
  const variants = boxVariants(boxIp);
  if (variants.length) {
    const args = ['-n', '-o', '-F'];
    for (const v of variants) args.push('-e', v);
    for (const h of parse(gitGrep([...args, '--', '.'], root))) {
      found.push({ file: h.file, line: h.line, kind: 'Box-Adresse (andere Schreibweise)' });
    }
  }
  return found;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const found = scanRepo({ boxIp: localBoxIp() });
  if (!found.length) {
    console.log('✓ keine oeffentliche Adresse, kein Adress-Zertifikat, kein privater Schluessel im Repo');
  } else {
    for (const f of found) console.error(`✗ ${f.file}${f.line ? `:${f.line}` : ''}  ${f.kind}`);
    console.error(`${found.length} Fund(e). Adressen gehoeren in die geheimen Einstellungen (HETZNER_REFRESH_URL / HETZNER_HOST).`);
    process.exit(1);
  }
}
