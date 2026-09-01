// Verhaltens-Tests der Gate-Policy.
//
// Der Grund fuer diese Datei: die Shell-Erkennung entscheidet ueber jeden
// Bash-Aufruf, und ihre Fehler gehen in beide Richtungen schief. Zu scharf
// heisst, dass rein lesende `node -e`-Proben blockieren — der schnellste Weg,
// das Gate abgeschaltet zu bekommen. Zu lasch heisst, dass `sed -i` die
// Seitentuer bleibt, die dieses Gate schliessen soll.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isExempt, toRel, planQuality, pathsWrittenByShell } from './gate-policy.mjs';

const P = 'C:/projekt';
const rels = (cmd, read) =>
  pathsWrittenByShell(cmd, P, read).map((c) => toRel(c.path, P, c.base));
const blocks = (cmd, read) => rels(cmd, read).some((r) => !isExempt(r));

// ------------------------------------------------------------- Freistellungen

test('Freistellungen: Werkzeug ja, Produktcode nein', () => {
  for (const r of [
    '../ausserhalb/x.mjs', '.claude/plan-current.md', '.git/hooks/pre-push',
    'scripts/hooks/write-gate.mjs', 'infra/claude-settings/hooks.json',
    'infra/claude-settings/discipline.md', 'notizen.md', 'AGENTS.md',
  ]) assert.equal(isExempt(r), true, r);

  for (const r of [
    'app/tft/page.tsx', 'scripts/tft-build-aggregator.mjs',
    'infra/claude-agents/metastats-architect.md', 'app/lib/i18n.tsx',
    'scripts/memory-health.mjs',
  ]) assert.equal(isExempt(r), false, r);
});

test('scripts/hooks ist frei, damit das Gate seine eigene Reparatur nicht sperrt', () => {
  assert.equal(blocks('sed -i s/a/b/ scripts/hooks/write-gate.mjs'), false);
  assert.equal(blocks('sed -i s/a/b/ scripts/tft-build-aggregator.mjs'), true);
});

// ---------------------------------------------------------------- Shell-Kanal

test('Redirect, sed -i, tee, cp: Ziel wird erkannt', () => {
  assert.equal(blocks('echo x > app/lib/neu.ts'), true);
  assert.equal(blocks('cat foo >> scripts/a.mjs'), true);
  assert.equal(blocks('sed -i "s/a/b/" app/page.tsx'), true);
  assert.equal(blocks('cp /tmp/x app/lib/i18n.tsx'), true);
  assert.equal(blocks('rm app/lib/alt.ts'), true);
});

test('Nicht-Schreibwege bleiben offen', () => {
  assert.equal(blocks('grep -rn "foo" app/'), false);
  assert.equal(blocks('cat app/lib/i18n.tsx'), false);
  assert.equal(blocks('npm ci'), false);
  assert.equal(blocks('node scripts/check-drift.mjs > /dev/null'), false);
  assert.equal(blocks('git status'), false);
  assert.equal(blocks('git log --oneline -5'), false);
});

test('cd setzt die Basis — Scratchpad blockt nicht, Projekt schon', () => {
  assert.equal(blocks('cd /tmp/scratch && sed -i s/a/b/ x.mjs'), false);
  assert.equal(blocks('cd C:/projekt && sed -i s/a/b/ app/page.tsx'), true);
  // 49 % aller gemessenen Bash-Kommandos enthalten ein cd; ohne diese Regel
  // wuerde jeder Scratchpad-Schreibvorgang faelschlich blockiert.
});

test('ssh/docker: der Rest laeuft nicht auf dieser Platte', () => {
  assert.equal(blocks('ssh box "sed -i s/a/b/ /opt/metastats-crawler/app/x.mjs"'), false);
  assert.equal(blocks('docker run x sh -c "rm app/page.tsx"'), false);
});

test('node -e: Inhalt entscheidet, nicht der Aufruf', () => {
  assert.equal(blocks(`node -e "console.log(require('fs').readdirSync('app'))"`), false);
  assert.equal(blocks(`node -e "require('fs').writeFileSync('app/x.ts','')"`), true);
});

test('node <skript>: Skript-Inhalt entscheidet', () => {
  const lesend = () => 'import {readFileSync} from "fs"; console.log(1);';
  const schreibend = () => 'import {writeFileSync} from "fs"; writeFileSync("app/x","");';
  assert.equal(blocks('node scripts/probe.mjs', lesend), false);
  assert.equal(blocks('node scripts/patch.mjs', schreibend), true);
  // Nicht lesbar (generiert, geloescht): nicht blocken statt raten.
  assert.equal(blocks('node /tmp/weg.mjs', () => { throw new Error('ENOENT'); }), false);
});

test('PowerShell-Kanal ist zu', () => {
  assert.equal(blocks('Set-Content app/lib/neu.ts "x"'), true);
  assert.equal(blocks('Out-File app/x.txt'), true);
  assert.equal(blocks('Get-ChildItem app'), false);
});

test('git-Befehle, die den Baum ueberschreiben', () => {
  assert.equal(blocks('git checkout -- app/page.tsx'), true);
  assert.equal(blocks('git reset --hard origin/main'), true);
  assert.equal(blocks('git clean -fd'), true);
  assert.equal(blocks('git diff --stat'), false);
});

// -------------------------------------------------------------- npm-Kanal (B9)

// Der Kanal war bis 2026-09-01 blind: `npm run build:system-map` lieferte [],
// waehrend `node scripts/build-system-map.mjs` geblockt wurde — ein Bypass ohne
// Trickserei. Die Tests stellen package.json UND Skript-Inhalte selbst, sonst
// laufen sie gegen ein Verzeichnis, das es nicht gibt, und werden sinnlos gruen.
const PKG = JSON.stringify({
  scripts: {
    build: 'node scripts/gen.mjs && next build',
    lint: 'eslint',
    test: 'node --test scripts/x.test.mjs',
    'check:drift': 'node scripts/check.mjs',
    ci: 'npm run ci',
  },
});
const fakeRead = (p) => {
  const f = String(p).replace(/\\/g, '/');
  if (f.endsWith('package.json')) return PKG;
  if (f.endsWith('gen.mjs')) return 'import {writeFileSync} from "fs"; writeFileSync("public/x.json","{}");';
  if (f.endsWith('check.mjs')) return 'import {readFileSync} from "fs"; console.log(1);';
  const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e;
};

test('npm run wird aufgeloest — der Script-Inhalt entscheidet', () => {
  assert.equal(blocks('npm run build', fakeRead), true);
  assert.equal(blocks('npm run check:drift', fakeRead), false);
  assert.equal(blocks('npm test', fakeRead), false);        // Alias ohne `run`
  assert.equal(blocks('npm ci', fakeRead), false);          // echter Unterbefehl
  assert.equal(blocks('npm install lodash', fakeRead), false);
});

test('npm run <name> -- --fix: die Zusatzargumente zaehlen mit', () => {
  // `lint` ist ein Pruefer, `lint -- --fix` schreibt den Baum um.
  assert.equal(blocks('npm run lint', fakeRead), false);
  assert.equal(blocks('npm run lint -- --fix', fakeRead), true);
});

test('npx/yarn/pnpm exec: der Rest ist das Kommando', () => {
  assert.equal(blocks('npx eslint --fix app', fakeRead), true);
  assert.equal(blocks('npx -y prettier --write app', fakeRead), true);
  assert.equal(blocks('npx tsc --noEmit', fakeRead), false);
  assert.equal(blocks('yarn build', fakeRead), true);
  assert.equal(blocks('pnpm exec sed -i s/a/b/ app/page.tsx', fakeRead), true);
});

test('Zyklus in package.json haengt den Hook nicht auf', () => {
  // `ci` ruft sich selbst. Ohne Tiefenbegrenzung waere das eine Endlosschleife
  // vor JEDEM Bash-Aufruf. Heute existiert kein solcher Zyklus (gemessen), die
  // Grenze schuetzt vor der einen Zeile, die ihn erzeugen wuerde.
  assert.equal(blocks('npm run ci', fakeRead), false);
});

// ---------------------------------------------------------------- planQuality

const PLAN_OK = `# Plan
## Verdicts
- metastats-architect: PASS
| Option | Vorteil | Nachteil |
|---|---|---|
| A | schnell | fragil |
| B | robust | teuer |
| C | mittel | mittel |
`;

test('planQuality verlangt Verdicts UND drei Alternativen', () => {
  assert.equal(planQuality('x', () => PLAN_OK).ok, true);
  assert.equal(planQuality('x', () => '# Plan\nnur Text').ok, false);
  assert.equal(planQuality('x', () => '## Verdicts\n- metastats-architect: PASS\n').ok, false);
  const enoent = () => { const e = new Error('nope'); e.code = 'ENOENT'; throw e; };
  assert.equal(planQuality('x', enoent).why, 'keine Plan-Datei');
  // Anderer Fehler darf sich NICHT als "kein Plan" tarnen.
  assert.equal(planQuality('x', () => { throw new Error('EACCES'); }).ok, true);
});

// ------------------------------------------------- Lockerung 2026-09-01 (B8)

test('node --test laeuft, obwohl Test-Dateien schreiben duerfen muessen', () => {
  // Der Test-Runner selbst schreibt nichts ins Repo; die Suiten legen ihre
  // Wegwerf-Projekte im Temp-Ordner an. Vorher hat das Gate den eigenen
  // Negativtest blockiert — die Bremse stand dem im Weg, was sie absichern soll.
  const schreibend = () => 'import {writeFileSync} from "fs"; writeFileSync("app/x","");';
  assert.equal(blocks('node --test scripts/hooks/lib/state.test.mjs', schreibend), false);
  assert.equal(blocks('node --test', schreibend), false);
});

test('Skript, das nachweislich nur nach TMP schreibt, laeuft', () => {
  const nurTmp = () =>
    'import {writeFileSync,mkdtempSync} from "fs"; import {tmpdir} from "os";\n' +
    'const d = mkdtempSync(tmpdir()); writeFileSync(d + "/x.json", "{}");';
  assert.equal(blocks('node scripts/probe-tmp.mjs', nurTmp), false);
});

test('Massen-Umschreiber bleibt geblockt — die Lockerung ist keine Hintertuer', () => {
  // scripts/codemod-accent.mjs ist ein echtes Werkzeug, das mit --write
  // App-Dateien umschreibt. Waere „committetes Skript = frei" die Regel
  // geworden, waere genau dieser Aufruf frei geworden.
  const codemod = () => 'import {writeFileSync} from "fs"; writeFileSync(file, out);';
  assert.equal(blocks('node scripts/codemod-accent.mjs --write', codemod), true);
});
