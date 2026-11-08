#!/usr/bin/env node
/**
 * Gleicht die Vercel-Firewall-Regeln mit infra/vercel/firewall.json ab.
 *
 *   node scripts/vercel-firewall.mjs --check   # Abweichung → Exit 1
 *   node scripts/vercel-firewall.mjs --apply   # fehlende Regeln anlegen, abweichende ersetzen
 *
 * Warum: Die zwei Beobachtungs-Regeln (seit 02.09.2026) standen nur in Vercel und
 * in keiner Datei — eine Regel, die niemand sieht, driftet. Die Datei ist der
 * Soll-Stand, Vercel der Ist-Stand. Abgeglichen wird je Regel-Name.
 *
 * Laeuft ueber `vercel api` (Anmeldung der Vercel-CLI), braucht also keinen
 * eigenen Schluessel. Regeln, die nur in Vercel stehen, werden gemeldet, aber nie
 * geloescht — Loeschen bleibt Handarbeit im Dashboard.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVercelDeploy } from './lib/vercel-deploy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONF = JSON.parse(readFileSync(join(ROOT, 'infra', 'vercel', 'firewall.json'), 'utf8'));
const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--check') ? 'check' : null;
if (!mode) {
  console.error('Aufruf: node scripts/vercel-firewall.mjs --check | --apply');
  process.exit(2);
}
const QS = `projectId=${CONF.projectId}&teamId=${CONF.teamId}`;
// Ohne Shell ueber vc.js (sonst trennt cmd.exe die Adresse am &), Muster refresh-riot-key.
const { vercel } = createVercelDeploy({ log: () => {} });

function vercelApi(path, { method = 'GET', body } = {}) {
  const args = ['api', path, '--raw'];
  let dir = null;
  if (method !== 'GET') args.push('-X', method);
  if (body !== undefined) {
    dir = mkdtempSync(join(tmpdir(), 'vfw-'));
    const f = join(dir, 'body.json');
    writeFileSync(f, JSON.stringify(body));
    args.push('--input', f);
  }
  try {
    const r = vercel(args, { timeout: 60_000 });
    if (r.status !== 0) throw new Error(`vercel api ${method} ${path.split('?')[0]} → Exit ${r.status}: ${(r.stderr || r.stdout || '').slice(0, 400)}`);
    return r.stdout.trim() ? JSON.parse(r.stdout) : null;
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

// Vergleich nur ueber die Felder, die die Datei festlegt; Vercel ergaenzt Felder
// (id, valid, validationErrors) und laesst leere weg.
function norm(v) {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      if (['id', 'valid', 'validationErrors'].includes(k)) continue;
      if (v[k] === null || v[k] === undefined || v[k] === false && k === 'neg') continue;
      out[k] = norm(v[k]);
    }
    return out;
  }
  return v;
}
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
const pick = (r) => ({ name: r.name, description: r.description, active: r.active, conditionGroup: r.conditionGroup, action: r.action });

const live = vercelApi(`/v1/security/firewall/config/active?${QS}`);
if (!live?.firewallEnabled) console.warn('! Firewall ist in Vercel ausgeschaltet');
const byName = new Map((live?.rules || []).map((r) => [r.name, r]));
let drift = 0;

for (const want of CONF.rules) {
  const have = byName.get(want.name);
  byName.delete(want.name);
  if (have && same(pick(have), pick(want))) {
    console.log(`= ${want.name}`);
    continue;
  }
  drift++;
  console.log(`${have ? '~ abweichend' : '+ fehlt'}: ${want.name}`);
  if (mode === 'apply') {
    const value = { ...pick(want), description: want.description ?? '' };
    vercelApi(`/v1/security/firewall/config?${QS}`, {
      method: 'PATCH',
      body: have ? { action: 'rules.update', id: have.id, value } : { action: 'rules.insert', id: null, value },
    });
    console.log(`  → ${have ? 'ersetzt' : 'angelegt'}`);
  }
}
for (const name of byName.keys()) console.log(`? nur in Vercel, nicht in der Datei: ${name}`);

if (mode === 'apply' && drift) {
  const after = vercelApi(`/v1/security/firewall/config/active?${QS}`);
  const names = new Map((after?.rules || []).map((r) => [r.name, r]));
  const bad = CONF.rules.filter((w) => !names.has(w.name) || !same(pick(names.get(w.name)), pick(w)));
  if (bad.length) {
    console.error(`✗ nach dem Einspielen weichen noch ab: ${bad.map((b) => b.name).join(', ')}`);
    process.exit(1);
  }
  console.log('✓ eingespielt und nachgeprueft');
} else if (mode === 'check' && drift) {
  console.error(`✗ ${drift} Regel(n) weichen ab — node scripts/vercel-firewall.mjs --apply`);
  process.exit(1);
} else {
  console.log('✓ Firewall wie in infra/vercel/firewall.json');
}
