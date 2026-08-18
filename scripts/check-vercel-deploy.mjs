#!/usr/bin/env node
/**
 * Prueft, ob der aktuelle HEAD-Commit auf Vercel wirklich deployed wurde.
 *
 * Anlass (2026-08-18): Commit 6960242 lief in CI gruen durch, bekam aber NIE
 * ein Deployment — die drei Commits davor hatten je eins, 40 Minuten spaeter
 * stand `vercel ls` immer noch auf dem Vorgaenger. Erst ein leerer
 * Nachschiebe-Commit loeste den Build aus. Es gab kein Signal dafuer: Push
 * gruen, CI gruen, Live alt. Genau diese Luecke schliesst das Skript.
 *
 * Bewusst KEIN pre-push-Gate: ein Push muss auch ohne Netz und ohne `gh`
 * durchgehen. Aufruf nach dem Push, wenn die Aenderung live sichtbar sein soll:
 *
 *   npm run check:deploy            # wartet bis zu 5 Minuten
 *   npm run check:deploy -- --once  # eine einzelne Abfrage
 *
 * Exit 0 = Deployment fuer HEAD existiert (oder Status noch offen bei --once),
 * Exit 1 = nach dem Warten keins gefunden → Deploy nachschieben.
 */

import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const once = args.includes('--once');
const timeoutMs = Number((args.find(a => a.startsWith('--timeout=')) || '').split('=')[1] || 300_000);
const POLL_MS = 15_000;

function sh(cmd, cmdArgs) {
  return execFileSync(cmd, cmdArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

let sha;
try {
  sha = sh('git', ['rev-parse', 'HEAD']);
} catch (e) {
  console.error('FEHLER: kein git-Repo?', e.message);
  process.exit(1);
}
const short = sha.slice(0, 7);

// `gh` statt der Vercel-CLI: die Git-Integration legt pro Build ein
// GitHub-Deployment an, und `gh` ist hier ohnehin authentifiziert. Die
// Vercel-CLI braeuchte zusaetzlich den Schannel-Workaround (siehe
// reference_vercel_env_quirks).
function deploymentsForHead() {
  const raw = sh('gh', ['api', `repos/{owner}/{repo}/deployments?sha=${sha}&per_page=20`]);
  return JSON.parse(raw);
}

function stateOf(deploymentId) {
  try {
    const raw = sh('gh', ['api', `repos/{owner}/{repo}/deployments/${deploymentId}/statuses?per_page=1`]);
    const st = JSON.parse(raw);
    return st[0]?.state ?? 'pending';
  } catch {
    return 'unbekannt';
  }
}

const deadline = Date.now() + timeoutMs;
for (;;) {
  let deployments;
  try {
    deployments = deploymentsForHead();
  } catch (e) {
    console.error(`FEHLER: gh api fehlgeschlagen (${e.message.split('\n')[0]}).`);
    console.error('Ohne `gh` laesst sich das nicht pruefen — Alternative: npx vercel ls');
    process.exit(1);
  }

  if (deployments.length > 0) {
    for (const d of deployments) {
      console.log(`OK: ${short} hat ein Deployment (#${d.id}, environment=${d.environment}, status=${stateOf(d.id)})`);
    }
    process.exit(0);
  }

  const restMs = deadline - Date.now();
  if (once || restMs <= 0) {
    console.error(`KEIN Deployment fuer ${short}.`);
    console.error('Vercel hat den Commit uebersprungen. Nachschieben:');
    console.error('  git commit --allow-empty -m "chore: deploy anstossen" && git push');
    process.exit(1);
  }
  console.log(`noch kein Deployment fuer ${short} — erneuter Versuch in ${POLL_MS / 1000}s (Rest ${Math.round(restMs / 1000)}s)`);
  await new Promise(r => setTimeout(r, POLL_MS));
}
