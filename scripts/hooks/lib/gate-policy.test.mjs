// Verhaltens-Tests der Gate-Policy.
//
// Der Grund fuer diese Datei: die Shell-Erkennung entscheidet ueber jeden
// Bash-Aufruf, und ihre Fehler gehen in beide Richtungen schief. Zu scharf
// heisst, dass rein lesende `node -e`-Proben blockieren — der schnellste Weg,
// das Gate abgeschaltet zu bekommen. Zu lasch heisst, dass `sed -i` die
// Seitentuer bleibt, die dieses Gate schliessen soll.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isExempt, toRel, planQuality, pathsWrittenByShell } from './gate-policy.mjs';

const P = 'C:/projekt';
const rels = (cmd, read) =>
  pathsWrittenByShell(cmd, P, read).map((c) => toRel(c.path, P, c.base));
const blocks = (cmd, read) => rels(cmd, read).some((r) => !isExempt(r));

// ------------------------------------------------------------- Freistellungen

test('Freistellungen: Werkzeug ja, Produktcode nein', () => {
  for (const r of [
    '../ausserhalb/x.mjs', '.claude/plan-current.md', '.git/HEAD', '.git/COMMIT_EDITMSG',
    'scripts/hooks/write-gate.mjs', 'infra/claude-settings/hooks.json',
    'infra/claude-settings/discipline.md', 'notizen.md', 'AGENTS.md',
  ]) assert.equal(isExempt(r), true, r);

  for (const r of [
    'app/tft/page.tsx', 'scripts/tft-build-aggregator.mjs',
    'infra/claude-agents/metastats-architect.md', 'app/lib/i18n.tsx',
    'scripts/memory-health.mjs',
  ]) assert.equal(isExempt(r), false, r);
});

// Die vier Stellen, an denen das Gate selbst haengt. Sie liegen in Ordnern, die
// sonst freigestellt sind — bis zur Durchsicht am 19.09.2026 waren sie es auch,
// und damit konnte sich der Assistent die Freigabe selbst schreiben.
test('die Stellen, an denen das Gate selbst haengt, sind nicht freigestellt', () => {
  for (const r of [
    '.git/metastats-discipline/freigabe.json', '.git/hooks/pre-push', '.git/config',
    '.claude/settings.json',
  ]) assert.equal(isExempt(r), false, r);
  // Drumherum bleibt frei: sonst waere der Plan selbst nicht schreibbar.
  assert.equal(isExempt('.claude/plan-current.md'), true);
  assert.equal(isExempt('.git/HEAD'), true);
});

// Auf dieser Workstation ist .claude/settings.json ein Verweis nach Dropbox.
// Ueber den Zielpfad geschrieben sah die Datei aus wie 'ausserhalb des Projekts'
// und war damit frei — das Gate liess sich ueber diesen Umweg abschalten.
test('ein Verweis auf eine Gate-Stelle wird auf ihren Projektnamen zurueckgerechnet', () => {
  const { mkdtempSync, mkdirSync, writeFileSync: schreib, symlinkSync } = fs;
  const wurzel = mkdtempSync(join(tmpdir(), 'gate-verweis-'));
  const projekt = join(wurzel, 'projekt');
  const aussen = join(wurzel, 'aussen');
  mkdirSync(join(projekt, '.claude'), { recursive: true });
  mkdirSync(aussen, { recursive: true });
  const ziel = join(aussen, 'settings.json');
  schreib(ziel, '{}');
  try {
    symlinkSync(ziel, join(projekt, '.claude', 'settings.json'), 'file');
  } catch {
    return;                       // ohne Recht auf Verweise nicht pruefbar
  }
  assert.equal(toRel(ziel, projekt), '.claude/settings.json');
  assert.equal(isExempt(toRel(ziel, projekt)), false);
});

test('scripts/hooks ist frei, damit das Gate seine eigene Reparatur nicht sperrt', () => {
  assert.equal(blocks('sed -i s/a/b/ scripts/hooks/write-gate.mjs'), false);
  assert.equal(blocks('sed -i s/a/b/ scripts/tft-build-aggregator.mjs'), true);
});

// ---------------------------------------------------------------- Shell-Kanal

// Schreibwege, die die grobe Zerlegung strukturell nicht sieht, weil sie nicht
// an der einfachen Pipe trennt und bei Interpretern nur -e kannte. Alle vier
// liefen bis zur Durchsicht am 19.09.2026 ungesehen durch.
test('tee hinter der Pipe, dd, awk -i inplace und Inline-Code werden erkannt', () => {
  assert.equal(blocks('echo x | tee app/lib/neu.ts'), true);
  assert.equal(blocks('cat vorlage | tee -a scripts/tft-build-aggregator.mjs'), true);
  assert.equal(blocks(`node --eval "require('fs').writeFileSync('app/x.ts',1)"`), true);
  assert.equal(blocks(`node -p "require('fs').writeFileSync('app/x.ts',1)"`), true);
  assert.equal(blocks(`python3 -c "open('app/x.ts','w').write(1)"`), true);
  assert.equal(blocks('dd if=/dev/zero of=app/lib/i18n.tsx'), true);
  assert.equal(blocks(`awk -i inplace "{print}" app/page.tsx`), true);
});

// Die Gegenprobe ist der eigentliche Punkt: ein Netz ueber die ganze Zeile haette
// alle diese Aufrufe mitgeblockt, und ein Gate, das bei Alltagsbefehlen nervt,
// wird abgeschaltet (feedback_disable_gateguard).
test('lesende Aufrufe und Commit-Botschaften bleiben offen', () => {
  assert.equal(blocks(`node -p "require('./package.json').version"`), false);
  assert.equal(blocks(`git commit -m "fix: sed -i geregelt"`), false);
  assert.equal(blocks('grep -c NODE_ENV app/api/tft/positions/submit/route.ts'), false);
  assert.equal(blocks('git log --oneline | head -20'), false);
  assert.equal(blocks(`grep -E "app|scripts" infra/system-map.json`), false);
  assert.equal(blocks('cat app/page.tsx | wc -l'), false);
  // Syntaxpruefung, kein Lauf: die Datei enthaelt writeFileSync, wird aber nur geparst.
  assert.equal(blocks('node --check scripts/hooks/session-start.mjs'), false);
  assert.equal(blocks(`ssh box "tee /opt/metastats/x.mjs"`), false);
});

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
    gen: 'node scripts/gen.mjs',
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
  assert.equal(blocks('npm run gen', fakeRead), true);
  assert.equal(blocks('npm run check:drift', fakeRead), false);
  assert.equal(blocks('npm test', fakeRead), false);        // Alias ohne `run`
  assert.equal(blocks('npm ci', fakeRead), false);          // echter Unterbefehl
  assert.equal(blocks('npm install lodash', fakeRead), false);
});

test('Build-Einstiege sind namentlich frei — ein Gate, das den Build sperrt, wird abgeschaltet', () => {
  // User-Entscheid 2026-09-01. Die Ausnahme haengt am NAMEN, nicht am Inhalt:
  // `build` regeneriert Artefakte und ist der haeufigste Schritt vor einem
  // Commit. Ein Script, das nicht so heisst, bleibt bewertet.
  assert.equal(blocks('npm run build', fakeRead), false);
  assert.equal(blocks('npm run build 2>&1', fakeRead), false);
  assert.equal(blocks('npm run build:system-map', fakeRead), false);
  assert.equal(blocks('npm run dev', fakeRead), false);
  // Mit angehaengten Argumenten faellt die Ausnahme weg: was da steht, hat
  // niemand in package.json geprueft.
  assert.equal(blocks('npm run build -- --write app', fakeRead), true);
  // Und der Rest bleibt bewertet.
  assert.equal(blocks('npm run gen', fakeRead), true);
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
  assert.equal(blocks('yarn gen', fakeRead), true);
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

test('Routine-Ops: Key-Rotation laeuft, das Skript selbst bleibt gesperrt', () => {
  // User-Entscheidung 2026-09-02: der taegliche LoL-Key darf nicht jedes Mal
  // durch Spec + Multi-Review. Freigestellt ist nur der Aufruf.
  const schreibend = () => 'import {writeFileSync} from "fs"; writeFileSync(f, k);';
  assert.equal(blocks('node scripts/refresh-riot-key.mjs', schreibend), false);
  assert.equal(blocks('node scripts/refresh-riot-key.mjs --skip-box', schreibend), false);
  // Die Datei zu aendern bleibt planpflichtig — sonst waere der Eintrag ein
  // Schlupfloch (umschreiben, dann durch die Ausnahme ausfuehren).
  assert.equal(isExempt('scripts/refresh-riot-key.mjs'), false);
  // Nachbarskripte erben nichts.
  assert.equal(blocks('node scripts/refresh-highelo-marketvalues.mjs', schreibend), true);
});
