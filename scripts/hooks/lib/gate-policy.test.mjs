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
import { isExempt, toRel, planQuality, pathsWrittenByShell, toNativePath, onlyTmpWrites } from './gate-policy.mjs';

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

test('toNativePath: Git-Bash-Laufwerkspfade werden zu Windows-Pfaden', () => {
  assert.equal(toNativePath('/d/Metastats/x', 'win32'), 'D:/Metastats/x');
  assert.equal(toNativePath('/c', 'win32'), 'C:/');
  assert.equal(toNativePath('/c/', 'win32'), 'C:/');
  assert.equal(toNativePath('/dev/null', 'win32'), '/dev/null');
  assert.equal(toNativePath('/tmp/x', 'win32'), '/tmp/x');
  assert.equal(toNativePath('app/x.ts', 'win32'), 'app/x.ts');
  assert.equal(toNativePath('/d/x', 'linux'), '/d/x');
  assert.equal(toNativePath(undefined, 'win32'), undefined);
});

// Luecke aus dem logic-flow-Befund (07.10.2026): `cd /d/…` wurde nicht als
// Projektpfad erkannt, ein anschliessendes `rm app/x.ts` lief am Gate vorbei.
// Nur unter Windows pruefbar — dort uebersetzt toNativePath den Pfad.
test('cd /c/… und /c/…-Schreibziele zaehlen als Projekt', { skip: process.platform !== 'win32' }, () => {
  assert.equal(blocks('cd /c/projekt && rm app/x.ts'), true);
  assert.equal(blocks('echo x > /c/projekt/app/y.ts'), true);
  assert.equal(isExempt(toRel('/c/Users/u/tmp.txt', P)), true);
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
  // Anderer Fehler darf sich NICHT als "kein Plan" tarnen — und seit 24.10.2026
  // auch nicht als bestandener Plan (plan-pruefung-faellt-offen).
  const eacces = () => { const e = new Error('nope'); e.code = 'EACCES'; throw e; };
  assert.equal(planQuality('x', eacces).ok, false);
  assert.match(planQuality('x', eacces).why, /nicht lesbar \(EACCES\)/);
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

// ------------------------------------------- Runde 10: Sicherheitsdurchsicht 24.10.2026
//
// Je Befund ein Test, und zu jedem die Gegenprobe. Die Zerlegung ist seit
// dieser Runde dieselbe wie die der Suchsperre (shell-words.mjs).

const ENV = { TEMP: 'C:/Users/u/AppData/Local/Temp', USERPROFILE: 'C:/Users/u' };
const relsMit = (cmd, opts = {}, read) =>
  pathsWrittenByShell(cmd, P, read, 0, { env: ENV, home: 'C:/Users/u', ...opts })
    .map((c) => toRel(c.path, P, c.base));
const blocksMit = (cmd, opts, read) => relsMit(cmd, opts, read).some((r) => !isExempt(r));
const ps = (cmd, read) => blocksMit(cmd, { shell: 'pwsh' }, read);

test('gate-selbst-schreibweise: Gate-Stellen ohne Ruecksicht auf Gross-/Kleinschreibung', () => {
  for (const r of ['.CLAUDE/Settings.json', '.Git/Hooks/pre-push', '.git/CONFIG', '.git/Metastats-Discipline/x']) {
    assert.equal(isExempt(r), false, r);
  }
  assert.equal(isExempt('.claude/PLAN-current.md'), true);
});

test('gate-selbst-schreibweise: Windows-Schreibweisen derselben Datei', { skip: process.platform !== 'win32' }, () => {
  assert.equal(toRel('C:/PROJEKT/.CLAUDE/SETTINGS.JSON', P), '.claude/settings.json');
  assert.equal(toRel('C:/projekt/.claude/settings.json::$DATA', P), '.claude/settings.json');
  assert.equal(toRel('C:/projekt/.claude/settings.json.', P), '.claude/settings.json');
  assert.equal(toRel('C:/projekt/.git/config:strom', P), '.git/config');
  assert.equal(blocksMit('echo {} > .claude/SETTINGS.json'), true);
  assert.equal(blocksMit('cd .git && echo x > config:strom'), true);
});

test('hooks-abschaltbar-settings-local: settings.local.json ist eine Gate-Stelle', () => {
  assert.equal(isExempt('.claude/settings.local.json'), false);
  assert.equal(blocksMit('echo {} > .claude/settings.local.json'), true);
  assert.equal(ps("Set-Content .claude/settings.local.json '{}'"), true);
});

test('pipe-schreibweg-unerkannt: Schreiber hinter einer Pipe', () => {
  assert.equal(ps('Get-Content x | Set-Content app/y.ts'), true);
  assert.equal(ps('echo x | Out-File app/z.ts'), true);
  assert.equal(ps("@'\nx\n'@ | Set-Content -Path app/y.ts -Encoding utf8"), true);
  assert.equal(blocksMit('cat x | xargs rm'), true);
  assert.equal(blocksMit('find app -name "*.ts" -delete'), true);
  assert.equal(blocksMit('find app -name "*.ts" -exec rm {} +'), true);
  // Gegenprobe: lesende Pipes und Temp-Ziele
  assert.equal(ps('npm test 2>&1 | Out-File $env:TEMP\\t.txt'), false);
  assert.equal(ps('Get-Content app/x.ts | Select-String foo'), false);
  assert.equal(ps('Get-ChildItem app | Out-Null'), false);
  assert.equal(blocksMit('find app -name "*.ts" -exec grep -l foo {} +'), false);
  assert.equal(blocksMit('git ls-files | xargs wc -l'), false);
});

test('PowerShell: Wert-Parameter sind keine Ziele, Pfad-Parameter schon', () => {
  assert.deepEqual(relsMit('Set-Content .claude/plan-progress.md -Value done', { shell: 'pwsh' }), ['.claude/plan-progress.md']);
  assert.deepEqual(relsMit('Set-Content -Path app/x.ts -Encoding utf8 -Value 1', { shell: 'pwsh' }), ['app/x.ts']);
  assert.deepEqual(relsMit('Copy-Item app/a.ts -Destination app/b.ts', { shell: 'pwsh' }), ['app/b.ts']);
  assert.equal(ps('New-Item -ItemType File -Name x.ts'), true);
  assert.equal(ps("[IO.File]::WriteAllText('app/x.ts', 'a')"), true);
  assert.equal(ps('$null = New-Item -ItemType Directory app/neu'), true);
  assert.equal(ps('Get-Content app/x.ts | Tee-Object -Variable inhalt'), false);
  assert.equal(ps('Set-Item env:WRITE_GATE 1'), false);
  assert.equal(ps("$p = Join-Path $env:TEMP 'x.txt'; Set-Content $p 1"), false);
  assert.equal(ps("[IO.File]::ReadAllText('app/x.ts')"), false);
});

test('inline-shell-unerkannt: bash -c, powershell -Command, cmd /c, eval, kodiert', () => {
  assert.equal(blocksMit('bash -c "echo a > app/x.ts"'), true);
  assert.equal(blocksMit("sh -lc 'rm app/x.ts'"), true);
  assert.equal(blocksMit('powershell -Command "Set-Content app/x.ts 1"'), true);
  assert.equal(blocksMit('pwsh -NoProfile -c "Remove-Item app/x.ts"'), true);
  const kodiert = Buffer.from('Set-Content app/x.ts 1', 'utf16le').toString('base64');
  assert.equal(blocksMit(`powershell -EncodedCommand ${kodiert}`), true);
  assert.equal(ps('cmd /c "del app\\x.ts"'), true);
  assert.equal(blocksMit('eval "rm app/x.ts"'), true);
  assert.equal(blocksMit('echo "$(rm app/x.ts)"'), true);
  assert.equal(ps('Invoke-Expression "Remove-Item app/x.ts"'), true);
  // Gegenprobe
  assert.equal(blocksMit('bash -c "git status"'), false);
  assert.equal(blocksMit('powershell -Command "Get-ChildItem app"'), false);
});

test('Heredoc: Daten bleiben Daten, Code wird geprueft', () => {
  const commit = 'git commit -m "$(cat <<\'EOF\'\nfix: a | tee app/x.ts\n> durch "zitat"\nEOF\n)"';
  assert.deepEqual(relsMit(commit), []);
  assert.deepEqual(relsMit("git commit -F - <<'EOF'\nrm app/x.ts > y\nEOF"), []);
  assert.equal(blocksMit("node - <<'EOF'\nrequire('fs').writeFileSync('app/x.ts','')\nEOF"), true);
  assert.equal(blocksMit("python3 - <<EOF\nopen('app/x','w').write('a')\nEOF"), true);
  assert.equal(blocksMit("cat <<'EOF' | node -\nrequire('fs').writeFileSync('app/x.ts','')\nEOF"), true);
  assert.equal(blocksMit("bash <<'EOF'\nrm app/x.ts\nEOF"), true);
  assert.equal(blocksMit("cat > app/x.ts <<'EOF'\ninhalt\nEOF"), true);
  // Gegenprobe
  assert.equal(blocksMit("node - <<'EOF'\nconsole.log(require('fs').readFileSync('app/x.ts','utf8'))\nEOF"), false);
  assert.equal(blocksMit("cat > \"$TEMP/x.txt\" <<'EOF'\ninhalt\nEOF"), false);
});

test('fernbefehl-umleitung-unerkannt: lokale Ziele von Fernbefehlen', () => {
  assert.equal(blocksMit('ssh box cat /opt/x > app/y.ts'), true);
  assert.equal(blocksMit('scp box:/opt/x.mjs app/a.ts'), true);
  assert.equal(blocksMit('scp -i key box:/opt/x.mjs scripts/'), true);
  assert.equal(blocksMit('rsync -a box:/opt/dir/ app/'), true);
  assert.equal(blocksMit('vercel env pull'), true);
  assert.equal(blocksMit('vercel env pull .env.production'), true);
  assert.equal(blocksMit('docker cp ctr:/x app/x'), true);
  assert.equal(blocksMit('gh run download 123'), true);
  // Gegenprobe: alles, was nur entfernt schreibt
  assert.equal(blocksMit('ssh box "cd /opt/x && echo a > scripts/y"'), false);
  assert.equal(blocksMit('scp app/a.ts box:/opt/a.ts'), false);
  assert.equal(blocksMit('ssh box "systemctl status x" > "$TEMP/s.txt"'), false);
  assert.equal(blocksMit('gh pr view 30'), false);
  assert.equal(blocksMit('vercel env ls'), false);
});

test('schreib-api-unerkannt: neuere Node- und Python-Schreibbefehle', () => {
  for (const code of [
    "import {promises as fsp} from 'fs'; await fsp.writeFile('app/x','')",
    "import {rm} from 'fs/promises'; await rm('app', {recursive:true})",
    "require('fs').cpSync('a','app/b')",
    "require('fs').symlinkSync('a','app/b')",
    "import shutil; shutil.copy('a','app/b')",
    "import os; os.remove('app/x')",
    "from pathlib import Path; Path('app/x').write_text('a')",
  ]) assert.equal(blocksMit('node scripts/x.mjs', {}, () => code), true, code);
  assert.equal(blocksMit('node scripts/x.mjs', {}, () => "process.stdout.write('a')"), false);
});

test('tmp-ausnahme-per-kommentar: ein Kommentar macht kein Skript harmlos', () => {
  const trick = () => "import {writeFileSync} from 'fs';\nwriteFileSync('app/x.ts', y) // tmpdir";
  assert.equal(blocksMit('node scripts/x.mjs', {}, trick), true);
  const trick2 = () => "import {writeFileSync} from 'fs';\n/* tmpdir */ writeFileSync('app/x.ts', y)";
  assert.equal(blocksMit('node scripts/x.mjs', {}, trick2), true);
  assert.equal(onlyTmpWrites("writeFileSync(join(tmpdir(), 'x'), y) // ok"), true);
});

test('schreibziel-ohne-arbeitsordner: Pfade gelten relativ zum Arbeitsordner des Befehls', () => {
  assert.equal(blocksMit('echo x > ../app/x.ts', { base: 'C:/projekt/scripts' }), true);
  assert.equal(blocksMit('cd scripts && rm ../app/x.ts'), true);
  assert.equal(blocksMit('cd scripts && sed -i s/a/b/ ../app/x.ts'), true);
  // Gegenprobe: Variablen, die aus dem Projekt herausfuehren
  assert.equal(blocksMit('node x.mjs > "$TEMP/out.txt"'), false);
  assert.equal(blocksMit('S="$TEMP/w"; echo x > "$S/a.txt"'), false);
  assert.equal(blocksMit('echo x > ~/notiz.txt'), false);
  assert.equal(blocksMit('T=$(mktemp); echo x > $T'), true);   // Wert unbekannt: lieber ein Hinweis
});

test('Routine-Ops: der Pruefer-Schritt 0 laeuft vor der Freigabe', () => {
  const schreibend = () => 'import {writeFileSync} from "fs"; writeFileSync(f, k);';
  assert.equal(blocksMit('node scripts/agentdb/ensure-daemon.mjs --quiet', {}, schreibend), false);
  assert.equal(isExempt('scripts/agentdb/ensure-daemon.mjs'), false);
});

test('Korpus-Abgleich 24.10.2026: Luecken und Fehlalarme aus echten Aufrufen', () => {
  // Echte Schreiber, die das alte Gate nicht sah
  assert.equal(blocksMit('git checkout HEAD -- app/components/SideDrawer.tsx'), true);
  assert.equal(blocksMit('F="app/x.tsx"; git checkout HEAD -- "$F"'), true);
  assert.equal(blocksMit('git stash apply'), true);
  // Fehlalarme des alten Gates
  assert.equal(blocksMit('curl -s https://x -o "$TMPDIR/c.json"', { env: {} }), false);
  assert.equal(blocksMit('H=$(cat "$S/boxhost.txt"); scp -q a.mjs "$H:/root/a.mjs"'), false);
  assert.equal(blocksMit('H=root@37.27.219.140; E=/mnt/v; scp a.mjs "$H:$E/a.mjs"'), false);
  assert.equal(blocksMit("sed -n 's/`a`/b/p' app/x.ts"), false);
  assert.equal(blocksMit('git checkout -b neu'), false);
  // Skript im Scratchpad, das neben sich schreibt
  const neben = () => 'echo x > "$(dirname "$0")/out.txt"';
  assert.equal(blocksMit('bash C:/Users/u/AppData/Local/Temp/s/w.sh', {}, neben), false);
  assert.equal(blocksMit('bash scripts/w.sh', {}, neben), true);
});

test('nie geschlossenes Anfuehrungszeichen verschluckt keinen Befehl', () => {
  assert.equal(blocksMit('echo "a ; rm app/x.ts'), true);
});
