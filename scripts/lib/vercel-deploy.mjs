// Vercel-Variablen setzen und die Produktion neu ausrollen — der eine Weg fuer
// alle Skripte, die ein Geheimnis zwischen Vercel und anderen Stellen teilen
// (refresh-riot-key, refresh-supabase-key, rotate-refresh-token,
// deploy-revalidate-secret, sync-vercel-blob-env).
//
// Herausgeloest aus refresh-riot-key.mjs am 24.10.2026. Bis dahin hatte nur
// dieses Skript den gemessenen sicheren Weg; die anderen setzten die Variable
// ohne Zeitlimit ueber die Shell und deployten gar nicht oder per leerem Commit.
// rotate-refresh-token liess die Live-Seite so auf dem alten Token stehen,
// waehrend die Box schon das neue verlangte.
//
// Lehren aus dem 2026-09-18 (siehe feedback_auto_deploy_riot_key):
//   - Das CLI laeuft OHNE Shell ueber sein JS-Entry und process.execPath. Mit
//     `shell: true` toetet ein Zeitlimit nur die cmd.exe, der Node-Enkel lief
//     als Waise 898 s weiter.
//   - Angestossen wird mit `--no-wait`, gewartet wird hier, wo wir abbrechen
//     koennen.
//   - Ob die Domain umgehaengt ist, wird rueckwaerts gemessen (welches
//     Deployment liefert die Domain aus), nicht aus der Zuweisungsliste gelesen.
//
// Erfolg heisst: die Domain liefert ein Deployment aus, das NACH dem Setzen der
// Variable entstanden ist. Das kann unseres sein oder ein neueres (ein Push
// waehrend der Rotation) — beide tragen den neuen Wert. Ein neueres Deployment
// wird nie zurueckgerollt (Pruefer-Befund 24.10.2026: der fruehere Nachhol-Tipp
// `vercel promote <unseres>` haette genau das getan).
//
// Absichtlich NICHT hier: der Live-Abruf (je Skript verschieden, wird als
// `probe` uebergeben), GitHub-Secrets, SSH zur Box.

import { spawnSync as nodeSpawnSync } from 'node:child_process';
import { existsSync, writeFileSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

// Die Produktions-Domain. `metastats.gg` antwortet 307 auf `www.` (gemessen
// 2026-09-18), ein Check gegen die nackte Domain pruefte also die Weiterleitung
// statt das Deployment.
export const PROD_DOMAIN = 'www.metastats.gg';

// Zeitdeckel. Basis: Build 37-100 s ueber 12 Prod-Deployments, schlechtester
// Lauf 229 s, an Tagen mit Warteschlange bis 9 min 33 s (2026-09-18).
export const DEFAULTS = Object.freeze({
  callMs: 90_000,          // jeder einzelne CLI-Aufruf
  redeployCallMs: 60_000,  // --no-wait liefert nur die URL zurueck
  readyMs: 600_000,
  aliasMs: 30_000,         // Auto-Alias kam gemessen mit 0 s Verzug
  liveMs: 60_000,          // Edge-Ausbreitung nach dem Umhaengen
  pollMs: 10_000,
  gitCallMs: 120_000,
});

export class DeployError extends Error {
  constructor(message, phase, extra = {}) {
    super(message);
    this.deployPhase = phase;
    Object.assign(this, extra);
  }
}

export const deploymentHost = (urlOrHost) =>
  String(urlOrHost || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');

const createdOf = (d) => Number(d?.createdAt || d?.created || 0);

// Das CLI schreibt Update-Banner und Fortschritt in denselben Strom wie die
// JSON-Antwort, deshalb wird der JSON-Block herausgeschnitten.
export function extractJson(text) {
  const s = String(text || '');
  for (const pair of [['{', '}'], ['[', ']']]) {
    const a = s.indexOf(pair[0]);
    const b = s.lastIndexOf(pair[1]);
    if (a >= 0 && b > a) {
      try { return JSON.parse(s.slice(a, b + 1)); } catch { /* naechste Klammerform */ }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sperre: eine fuer alle Skripte. Zwei Laeufe wuerden sich sonst die Variable
// gegenseitig loeschen (`env rm` vor `env add`), um die Domain streiten oder
// auf der Box gleichzeitig dieselbe Datei umschreiben. `wx` legt atomar an.
// ---------------------------------------------------------------------------
export const LOCK_FILE = join(tmpdir(), 'metastats-vercel-env.lock');
const LOCK_STALE_MS = 30 * 60_000;

export function acquireLock(label, { file = LOCK_FILE, now = Date.now } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(file, `${process.pid} ${label}\n`, { flag: 'wx' });
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        try { unlinkSync(file); } catch { /* schon weg */ }
      };
      process.once('exit', release);
      return release;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let age = 0;
      let owner = '?';
      try {
        age = now() - statSync(file).mtimeMs;
        owner = readFileSync(file, 'utf8').trim();
      } catch { continue; } // zwischen den Aufrufen verschwunden
      if (age < LOCK_STALE_MS) {
        throw new Error(`Es laeuft bereits ein Lauf (${owner}, ${Math.round(age / 1000)} s, ${file}). Abgebrochen — zwei Laeufe wuerden sich die Vercel-Variablen gegenseitig ueberschreiben.`);
      }
      try { unlinkSync(file); } catch { /* egal */ }
    }
  }
  throw new Error(`Sperre ${file} liess sich nicht anlegen.`);
}

// ---------------------------------------------------------------------------
// Fabrik. Alles, was nach aussen geht (Prozesse, Zeit, Ausgabe), ist
// einspeisbar — die Tests fahren die Ablaeufe mit einem nachgebauten CLI.
// ---------------------------------------------------------------------------
export function createVercelDeploy(opts = {}) {
  const spawn = opts.spawn || nodeSpawnSync;
  const sleep = opts.sleep || ((ms) => new Promise(r => setTimeout(r, ms)));
  const now = opts.now || Date.now;
  const log = opts.log || ((m) => console.log(m));
  const t = { ...DEFAULTS, ...(opts.timeouts || {}) };
  const domain = opts.domain || PROD_DOMAIN;

  let entry = opts.vercelEntry;
  function vercelEntry() {
    if (entry !== undefined) return entry;
    entry = '';
    const candidates = [];
    // Erst der Starter auf dem PATH: `npm root -g` zeigt auf dieser Workstation
    // ins Node-Installationsverzeichnis, das globale Paket liegt aber unter
    // %APPDATA%\npm (gemessen 2026-09-18).
    const which = spawn(process.platform === 'win32' ? 'where' : 'which', ['vercel'],
      { encoding: 'utf8', shell: true, timeout: 30_000 }).stdout?.trim();
    for (const line of String(which || '').split(/\r?\n/)) {
      const p = line.trim();
      if (p) candidates.push(join(dirname(p), 'node_modules', 'vercel', 'dist', 'vc.js'));
    }
    const root = spawn('npm', ['root', '-g'], { encoding: 'utf8', shell: true, timeout: 60_000 }).stdout?.trim();
    if (root) candidates.push(join(root, 'vercel', 'dist', 'vc.js'));
    if (process.env.APPDATA) candidates.push(join(process.env.APPDATA, 'npm', 'node_modules', 'vercel', 'dist', 'vc.js'));
    for (const c of candidates) {
      if (existsSync(c)) { entry = c; break; }
    }
    if (!entry) log('      WARN: vercel-Entry nicht gefunden — CLI laeuft ueber die Shell, ein Zeitlimit kann dann einen Waisenprozess hinterlassen.');
    return entry;
  }

  function vercel(args, { timeout = t.callMs, input } = {}) {
    const e = vercelEntry();
    const o = { input, encoding: 'utf8', timeout, killSignal: 'SIGKILL' };
    const r = e
      ? spawn(process.execPath, [e, ...args], o)
      : spawn('vercel', args, { ...o, shell: true });
    r.timedOut = r.error?.code === 'ETIMEDOUT';
    return r;
  }

  function vercelJson(args, o) {
    const r = vercel(args, o);
    if (r.status !== 0) return null;
    return extractJson(r.stdout);
  }

  // Ohne Shell: die Nachricht kommt so wie sie ist an, ohne Anfuehrungszeichen.
  function git(args) {
    const r = spawn('git', args, { encoding: 'utf8', timeout: t.gitCallMs, killSignal: 'SIGKILL' });
    r.timedOut = r.error?.code === 'ETIMEDOUT';
    return r;
  }

  // ----------------------------------------------------------------- Variablen

  /**
   * Setzt eine Variable in den genannten Umgebungen. Der Wert erscheint in
   * keiner Ausgabe. Das `rm` schlaegt planmaessig fehl, wenn es die Variable
   * noch nicht gibt; gegen Ueberschneidungen schuetzt die Sperre.
   */
  function setEnv(name, value, targets = ['production', 'development']) {
    for (const target of targets) {
      vercel(['env', 'rm', name, target, '--yes', '--no-color']);
      const add = vercel(['env', 'add', name, target, '--no-color'], { input: value });
      if (add.status !== 0) {
        throw new Error(`vercel env add ${name} ${target} fehlgeschlagen${add.timedOut ? ' (Zeitlimit)' : ''}`);
      }
    }
  }

  // ----------------------------------------------------------------- Deployments

  const fetchDeployment = (idOrHost) =>
    vercelJson(['api', `/v13/deployments/${deploymentHost(idOrHost)}?withGitRepoInfo=false`]);

  function listProd(query) {
    const j = vercelJson(['api', `/v6/deployments?${query}`]);
    return Array.isArray(j?.deployments) ? j.deployments : [];
  }
  const newestProd = () => listProd('limit=1&target=production')[0] || null;

  // Rueckwaerts: welches Deployment liefert die Domain gerade aus? Die
  // Zuweisungsliste von `vercel inspect <deployment>` taugt dafuer nicht.
  function servingHost() {
    const j = vercelJson(['inspect', domain, '--format', 'json', '--no-color']);
    return deploymentHost(j?.url || j?.deployment?.url || '') || null;
  }
  function serving() {
    const host = servingHost();
    if (!host) return null;
    const d = fetchDeployment(host);
    return { host, created: createdOf(d) };
  }

  // Neu gebaut wird, was die Domain AUSLIEFERT: nach einer bewussten
  // Ruecknahme bleibt die Ruecknahme stehen. Rueckfall: juengstes READY.
  function pickSource() {
    const live = servingHost();
    if (live) return live;
    const ready = listProd('limit=20&target=production&state=READY');
    ready.sort((a, b) => createdOf(b) - createdOf(a));
    return ready[0] ? deploymentHost(ready[0].url) : null;
  }

  async function waitForReady(host, deadline) {
    let last = null;
    while (now() < deadline) {
      const d = fetchDeployment(host);
      if (d) {
        last = d;
        const state = d.readyState || d.status;
        if (state === 'READY') return d;
        if (state === 'ERROR' || state === 'CANCELED') {
          throw new DeployError(`Build ${state}: ${d.inspectorUrl || host}`, 'build-failed',
            { deployUrl: host, inspectorUrl: d.inspectorUrl });
        }
      }
      await sleep(t.pollMs);
    }
    throw new DeployError(
      `Der Build war nach ${Math.round(t.readyMs / 1000)} s noch nicht fertig (zuletzt: ${last?.readyState || 'unbekannt'}).`,
      'unknown', { deployUrl: host, inspectorUrl: last?.inspectorUrl });
  }

  // Liefert die Domain ein Deployment aus, das nach `since` entstand?
  async function waitForFresh(since, deadline) {
    let last = null;
    while (now() < deadline) {
      last = serving();
      if (last && last.created >= since) return last;
      await sleep(t.pollMs);
    }
    return null;
  }

  /**
   * Wartet, bis die Domain ein Deployment ausliefert, das nach `since`
   * entstand, und haengt unseres nur um, wenn kein neueres existiert.
   */
  async function awaitDeployment(url, since) {
    const host = deploymentHost(url);
    const ours = await waitForReady(host, now() + t.readyMs);
    log('      Build fertig.');
    // Unser Deployment entstand nach dem Setzen — seine Server-Zeit ist die
    // ehrlichere Grenze, falls die lokale Uhr vorgeht.
    const bar = createdOf(ours) > 0 ? Math.min(since, createdOf(ours)) : since;

    let fresh = await waitForFresh(bar, now() + t.aliasMs);
    if (!fresh) {
      const newest = newestProd();
      const newer = newest && deploymentHost(newest.url) !== host && createdOf(newest) > createdOf(ours);
      if (newer) {
        // Ein neueres Deployment (Push waehrend der Rotation) ist unterwegs. Es
        // entstand nach unserem und damit nach dem Setzen — es traegt den neuen
        // Wert. Nicht umhaengen, sondern auf es warten.
        log(`      Neueres Deployment unterwegs (${newest.url}) — es traegt den neuen Wert, warte darauf statt umzuhaengen.`);
        fresh = await waitForFresh(bar, now() + t.readyMs);
        if (!fresh) {
          throw new DeployError(`Das neuere Deployment ${newest.url} wurde nicht ausgeliefert.`, 'foreign',
            { deployUrl: host, foreignUrl: newest.url });
        }
      } else {
        log('      Domain haengt noch am alten Stand — haenge um...');
        const p = vercel(['promote', host, '--timeout', '90s', '--yes', '--no-color']);
        if (p.status !== 0) {
          throw new DeployError(`vercel promote fehlgeschlagen${p.timedOut ? ' (Zeitlimit)' : ''}.`, 'no-alias',
            { deployUrl: host, detail: String(p.stderr || '').slice(0, 300) });
        }
        fresh = await waitForFresh(bar, now() + t.liveMs);
        if (!fresh) {
          throw new DeployError(`Die Domain ${domain} liefert weiterhin ein aelteres Deployment aus (${servingHost() || 'unbekannt'}).`,
            'no-alias', { deployUrl: host });
        }
      }
    }
    if (fresh.host !== host) log(`      Domain liefert das neuere Deployment ${fresh.host} aus (traegt den neuen Wert).`);
    return fresh.host;
  }

  // Rueckfall, wenn `vercel redeploy` gar nicht greift. Unversionierte Dateien
  // zaehlen nicht als schmutzig (sie kommen ohnehin nicht in den Commit) —
  // vorher hat jede liegengebliebene Bilddatei diesen Weg still abgeschaltet.
  async function redeployViaGit(message, since) {
    const st = git(['status', '--porcelain', '--untracked-files=no']);
    if (st.status !== 0) throw new DeployError('git status fehlgeschlagen — kein Deploy-Commit angelegt.', 'unknown');
    if (String(st.stdout || '').trim()) {
      throw new DeployError('Arbeitsbaum nicht sauber — kein Deploy-Commit angelegt.', 'unknown');
    }
    const before = deploymentHost(newestProd()?.url || '');
    const c = git(['commit', '--allow-empty', '-m', message]);
    if (c.status !== 0) throw new DeployError(`git commit fehlgeschlagen: ${String(c.stderr || '').slice(0, 200)}`, 'unknown');
    if (git(['push', 'origin', 'main']).status !== 0) {
      log('      Push abgelehnt — einmal rebasen und erneut versuchen...');
      if (git(['pull', '--rebase', '--autostash', 'origin', 'main']).status !== 0) {
        throw new DeployError('git pull --rebase fehlgeschlagen — kein Deploy ausgeloest.', 'unknown');
      }
      const ahead = Number(String(git(['rev-list', '--count', '@{u}..HEAD']).stdout || '0').trim());
      if (!(ahead >= 1)) throw new DeployError('Deploy-Commit ist beim Rebase verlorengegangen — kein Deploy ausgeloest.', 'unknown');
      if (git(['push', 'origin', 'main']).status !== 0) throw new DeployError('git push fehlgeschlagen — kein Deploy ausgeloest.', 'unknown');
    }
    const deadline = now() + t.readyMs;
    while (now() < deadline) {
      const host = deploymentHost(newestProd()?.url || '');
      if (host && host !== before) return awaitDeployment(host, since);
      await sleep(t.pollMs);
    }
    throw new DeployError('Nach dem Push ist kein neues Deployment aufgetaucht.', 'unknown');
  }

  /**
   * Rollt die Produktion mit den aktuellen Variablen neu aus und wartet, bis die
   * Domain ein Deployment ausliefert, das nach `since` entstand.
   *   since       Zeitpunkt VOR dem ersten setEnv (ms)
   *   probe       optional, async: Live-Nachweis nach dem Umhaengen
   *   gitMessage  Commit-Nachricht fuer den Git-Rueckfall
   * Rueckgabe: Host des ausgelieferten Deployments. Fehler: DeployError mit
   * deployPhase build-failed | no-alias | foreign | unknown (oder was probe wirft).
   */
  async function redeployProduction({ since, probe, gitMessage = 'chore: redeploy after env change' } = {}) {
    if (!Number.isFinite(since)) throw new Error('redeployProduction braucht `since` (Zeitpunkt vor dem Setzen der Variable).');
    const source = pickSource();
    let host;
    if (!source) {
      log('      WARN: kein ausgeliefertes oder fertiges Prod-Deployment gefunden — Rueckfall auf den Git-Weg.');
      host = await redeployViaGit(gitMessage, since);
    } else {
      const r = vercel(['redeploy', source, '--target', 'production', '--no-wait', '--no-color'], { timeout: t.redeployCallMs });
      // Das CLI verteilt sich auf beide Stroeme, die frische URL kann in jedem stehen.
      const fresh = `${r.stdout || ''}\n${r.stderr || ''}`.match(/https:\/\/[^\s]+\.vercel\.app/)?.[0];
      if (r.status !== 0 || !fresh) {
        log(`      WARN: vercel redeploy fehlgeschlagen${r.timedOut ? ' (Zeitlimit)' : ''} — Rueckfall auf den Git-Weg.`);
        host = await redeployViaGit(gitMessage, since);
      } else {
        log(`      Deployment angestossen: ${fresh}`);
        host = await awaitDeployment(fresh, since);
      }
    }
    if (probe) await probe(host);
    return host;
  }

  return { vercel, vercelJson, setEnv, redeployProduction, servingHost, pickSource, fetchDeployment };
}
