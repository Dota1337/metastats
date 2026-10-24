// Ablaeufe von vercel-deploy.mjs gegen ein nachgebautes Vercel-CLI: kein
// echter Prozess, keine echte Zeit. Geprueft wird vor allem, dass ein neueres
// Deployment nie zurueckgerollt wird und der Git-Rueckfall nicht an
// unversionierten Dateien scheitert (Pruefer-Befunde 24.10.2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createVercelDeploy, acquireLock, DeployError, extractJson } from './vercel-deploy.mjs';

const T0 = Date.parse('2026-10-24T04:00:00Z');

function fakeVercel(setup = {}) {
  const clock = { now: T0 };
  const deps = new Map();   // host -> { url, createdAt, states: [..], i }
  const calls = [];
  const logs = [];
  const add = (host, createdAt, states = ['READY']) => {
    deps.set(host, { url: `https://${host}`, createdAt, states, i: 0 });
    return host;
  };
  const st = {
    clock, deps, calls, logs, add,
    serving: add('old.vercel.app', T0 - 86_400_000),
    autoAlias: true,
    redeployFails: false,
    gitStatus: '',
    onRedeploy: null,       // (newHost) => void, fuer Fremd-Deployments
    pushes: 0,
  };
  Object.assign(st, setup);
  let n = 0;
  const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
  const spawn = (cmd, args, opts) => {
    if (cmd === 'git') {
      calls.push(['git', ...args]);
      if (args[0] === 'status') return ok(st.gitStatus);
      if (args[0] === 'push') {
        st.pushes++;
        const h = st.add(`git${st.pushes}.vercel.app`, clock.now + 1000);
        if (st.autoAlias) st.serving = h;
        return ok();
      }
      return ok();
    }
    const a = args.slice(1); // args[0] ist das JS-Entry
    calls.push(a);
    if (a[0] === 'env') return { status: 0, stdout: '', stderr: '', input: opts.input };
    if (a[0] === 'inspect') {
      if (st.laterServe && clock.now > T0 + 10_000) st.serving = st.laterServe;
      return ok(`Vercel CLI 50\n${JSON.stringify({ url: st.deps.get(st.serving)?.url })}`);
    }
    if (a[0] === 'redeploy') {
      if (st.redeployFails) return { status: 1, stdout: '', stderr: 'boom' };
      const h = st.add(`new${++n}.vercel.app`, clock.now + 1000, setup.buildStates || ['BUILDING', 'READY']);
      st.onRedeploy?.(h, st);
      return { status: 0, stdout: '', stderr: `Inspect: x\nhttps://${h}\n` };
    }
    if (a[0] === 'promote') { st.serving = a[1]; return ok(); }
    if (a[0] === 'api') {
      const p = a[1];
      const m = /^\/v13\/deployments\/([^?]+)/.exec(p);
      if (m) {
        const d = st.deps.get(m[1]);
        if (!d) return { status: 1, stdout: '', stderr: 'not found' };
        const state = d.states[Math.min(d.i, d.states.length - 1)];
        d.i++;
        // automatisch zugewiesen, sobald READY
        if (state === 'READY' && st.autoAlias && d.createdAt > T0 && !d.aliased) {
          d.aliased = true;
          const cur = st.deps.get(st.serving);
          if (!cur || d.createdAt > cur.createdAt) st.serving = m[1];
        }
        return ok(JSON.stringify({ readyState: state, createdAt: d.createdAt, url: m[1] }));
      }
      if (p.startsWith('/v6/deployments')) {
        const list = [...st.deps.entries()].map(([h, d]) => ({ url: h, created: d.createdAt }))
          .sort((x, y) => y.created - x.created);
        return ok(JSON.stringify({ deployments: list }));
      }
    }
    return { status: 1, stdout: '', stderr: `unerwartet: ${a.join(' ')}` };
  };
  const dep = createVercelDeploy({
    spawn,
    vercelEntry: 'fake-vc.js',
    now: () => clock.now,
    sleep: async (ms) => { clock.now += ms; },
    log: (m) => logs.push(m),
    timeouts: { pollMs: 1000, readyMs: 60_000, aliasMs: 5_000, liveMs: 5_000 },
  });
  return { st, dep };
}

test('Normalfall: Build fertig, automatisch umgehaengt, Probe bekommt den Host', async () => {
  const { st, dep } = fakeVercel();
  let probed = null;
  const host = await dep.redeployProduction({ since: T0, probe: async (h) => { probed = h; } });
  assert.equal(host, 'new1.vercel.app');
  assert.equal(probed, 'new1.vercel.app');
  assert.ok(!st.calls.some(c => c[0] === 'promote'), 'kein Umhaengen noetig');
  // Quelle ist das ausgelieferte Deployment, nicht das juengste fertige
  assert.deepEqual(st.calls.find(c => c[0] === 'redeploy').slice(0, 2), ['redeploy', 'old.vercel.app']);
});

test('ohne automatisches Umhaengen wird unseres umgehaengt', async () => {
  const { st, dep } = fakeVercel({ autoAlias: false });
  const host = await dep.redeployProduction({ since: T0 });
  assert.equal(host, 'new1.vercel.app');
  assert.ok(st.calls.some(c => c[0] === 'promote' && c[1] === 'new1.vercel.app'));
});

test('neueres Deployment waehrend der Rotation: nie zurueckrollen, darauf warten', async () => {
  const { st, dep } = fakeVercel({
    autoAlias: false,
    onRedeploy: (h, s) => {
      // ein Push kommt kurz nach unserem Anstoss und wird nach 10 s ausgeliefert
      s.laterServe = s.add('push.vercel.app', s.clock.now + 5000);
    },
  });
  const host = await dep.redeployProduction({ since: T0 });
  assert.equal(host, 'push.vercel.app');
  assert.ok(!st.calls.some(c => c[0] === 'promote'), 'unseres darf das neuere nicht verdraengen');
});

test('Build-Fehler wird als build-failed gemeldet', async () => {
  const { dep } = fakeVercel({ buildStates: ['BUILDING', 'ERROR'] });
  await assert.rejects(dep.redeployProduction({ since: T0 }), (e) => e instanceof DeployError && e.deployPhase === 'build-failed');
});

test('Git-Rueckfall: unversionierte Dateien zaehlen nicht, Nachricht ohne Anfuehrungszeichen', async () => {
  const { st, dep } = fakeVercel({ redeployFails: true });
  const host = await dep.redeployProduction({ since: T0, gitMessage: 'chore: refresh x' });
  assert.equal(host, 'git1.vercel.app');
  const status = st.calls.find(c => c[0] === 'git' && c[1] === 'status');
  assert.ok(status.includes('--untracked-files=no'));
  const commit = st.calls.find(c => c[0] === 'git' && c[1] === 'commit');
  assert.equal(commit[commit.length - 1], 'chore: refresh x');
});

test('Git-Rueckfall bricht bei geaenderten versionierten Dateien ab, ohne Commit', async () => {
  const { st, dep } = fakeVercel({ redeployFails: true, gitStatus: ' M app/page.tsx\n' });
  await assert.rejects(dep.redeployProduction({ since: T0 }), (e) => e.deployPhase === 'unknown');
  assert.ok(!st.calls.some(c => c[0] === 'git' && c[1] === 'commit'));
});

test('ohne since kein Deploy', async () => {
  const { st, dep } = fakeVercel();
  await assert.rejects(dep.redeployProduction({}), /since/);
  assert.equal(st.calls.length, 0);
});

test('setEnv gibt den Wert nur ueber stdin weiter und meldet Fehler', () => {
  const { st, dep } = fakeVercel();
  dep.setEnv('X_TOKEN', 'geheim-123', ['production']);
  const add = st.calls.find(c => c[0] === 'env' && c[1] === 'add');
  assert.ok(!add.includes('geheim-123'), 'Wert nicht in den Argumenten');
  assert.ok(!st.logs.join('\n').includes('geheim-123'), 'Wert nicht in der Ausgabe');

  const bad = createVercelDeploy({ spawn: () => ({ status: 1, stdout: '', stderr: '' }), vercelEntry: 'x', log: () => {} });
  assert.throws(() => bad.setEnv('X_TOKEN', 'v', ['production']), /X_TOKEN production/);
});

test('Sperre: zweiter Lauf scheitert, alte Sperre wird ersetzt', () => {
  const file = join(tmpdir(), `vercel-deploy-test-${process.pid}.lock`);
  try { unlinkSync(file); } catch { /* frisch */ }
  const release = acquireLock('a', { file });
  assert.throws(() => acquireLock('b', { file }), /bereits ein Lauf/);
  release();
  assert.equal(existsSync(file), false);

  writeFileSync(file, '1 alt\n');
  const old = (Date.now() - 31 * 60_000) / 1000;
  utimesSync(file, old, old);
  const r2 = acquireLock('c', { file });
  r2();
});

test('extractJson schneidet den JSON-Block aus CLI-Ausgabe', () => {
  assert.deepEqual(extractJson('Vercel CLI 50.1\n{"url":"a.vercel.app"}\n'), { url: 'a.vercel.app' });
  assert.equal(extractJson('kein json'), null);
});
