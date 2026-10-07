// Tests der Suchsperre. Die Sperr-Faelle stammen woertlich aus dem Protokoll
// der Sitzung 30a1b307 (07.10.2026), die der User abbrechen musste, weil
// grep.exe beim Spielen die CPU belegte — Haupt-Sitzung und Subagenten.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSearch, searchDenyText, WIEDERHOLUNG_MAX } from './search-policy.mjs';

const PROJ = 'D:/Metastats/metastats';
const norm = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const MIT_NM = new Set([
  'd:/metastats/metastats/node_modules',
  'd:/metastats/metastats/apps/overwolf-app/node_modules',
  'd:/metastats/metastats/.next/node_modules',
]);
const KINDER = { 'd:/metastats/metastats/apps': ['overwolf-app'] };
const OPTS = {
  projectDir: PROJ,
  home: 'C:/Users/dtaub',
  platform: 'win32',
  exists: (p) => MIT_NM.has(norm(p)),
  kinder: (d) => KINDER[norm(d)] || [],
};
const bash = (cmd, cwd = PROJ) => checkSearch('Bash', cmd, cwd, OPTS);
const pwsh = (cmd, cwd = PROJ) => checkSearch('PowerShell', cmd, cwd, OPTS);
const OVERWOLF = 'D:\\Metastats\\metastats\\apps\\overwolf-app';

// ------------------------------------------------ Vorfall-Befehle, woertlich

const VORFALL = [
  ['Haupt-Sitzung 18:46: \\{0,3000\\} ueber das 68-MB-Protokoll',
    `cd "C:/Users/dtaub/.claude/projects/D--Metastats-metastats" && grep -o '"text":"[^"]\\{0,3000\\}' 30a1b307-99da-41de-a288-9db494ac8c2e.jsonl | grep -n -i "fehlerliste\\|Aufgabe C\\|Punkt C\\|C)\\|Bug-Liste\\|Buglist\\|bug list" | cut -c1-1500 | tail -15`, PROJ],
  ['Haupt-Sitzung 18:36: grep -rln . in apps/overwolf-app',
    'ls; grep -rln "stub" --include=*.ts --include=*.mjs --include=*.html . 2>/dev/null | grep -v node_modules | head; grep -n -i "stub" "C:/Users/dtaub/.claude/projects/D--Metastats-metastats/memory/reference_companion_architecture.md" | head -20', OVERWOLF],
  ['Subagent 19:14: grep -rlE . vom Projektordner',
    'grep -rlE "ssh .*root@|HETZNER_(HOST|IP)" --include=*.mjs --include=*.sh --include=*.md . 2>/dev/null | grep -v node_modules | head -5', PROJ],
  ['Subagent 19:14: cd /d/… ; grep -rln .',
    'cd /d/Metastats/metastats; grep -rln "explorer-duckdb-server\\|build-explorer-store" --include=*.mjs --include=*.ts --include=*.json --include=*.sh --include=*.yml . 2>/dev/null | grep -v node_modules', 'C:\\Users\\dtaub'],
  ['Subagent 19:17: grep -rn .',
    'grep -rn "get_tft_marketvalue_history\\|get_tft_team_marketvalues" --include=*.ts --include=*.tsx --include=*.mjs --include=*.sql --include=*.json . 2>/dev/null', PROJ],
  ['Subagent: .\\{300\\} in BRE',
    `grep -o '.\\{300\\}\\(Gewinner\\|winners\\|npm ci\\|28\\.09\\)[^"]\\{0,400\\}' "$F"`, PROJ],
  ['Subagent: -E .{0,1500}', `grep -o -E 'System map misses.{0,1500}' "$F"`, PROJ],
  ['Subagent: -E .{0,4000}', `grep -o -E '\\*\\*Code agent:\\*\\*.{0,4000}' "$F"`, PROJ],
  ['Subagent 17:15: find . -not -path in apps/overwolf-app',
    "cd /d/Metastats/metastats/apps/overwolf-app && find . -name manifest.json -not -path './node_modules/*'", PROJ],
];

for (const [name, cmd, cwd] of VORFALL) {
  test(`Vorfall gesperrt: ${name}`, () => {
    assert.ok(bash(cmd, cwd), cmd);
  });
}

// ------------------------------------------------ weitere Sperr-Faelle

const GESPERRT_BASH = [
  'cd /d/Metastats/metastats && grep -r x',
  'grep -r --include=*.ts x .',
  "find . -not -path '*/node_modules/*' -name x",
  'LC_ALL=C grep -r x .',
  'du -sh --max-depth=1 node_modules',
  'du -sh node_modules',
  'du -sh .',
  'grep -r x *',
  'grep -r x apps/overwolf-app',
  'grep -r x apps',
  'grep -r x ~',
  'grep -r x /c/',
  'grep -r x /c/*',
  'grep -r x ..',
  'find / -name x',
  'find . -maxdepth 5 -name x',
  "grep -E 'a{1,500}' f",
  "egrep 'a{0,101}' f",
  "grep -P '.{200}' f",
  'timeout 30 grep -r x .',
  'nice -n 19 grep -r x .',
  'env LC_ALL=C grep -r x .',
  '/usr/bin/grep -R x .',
  'grep --recursive x',
  'grep -d recurse x .',
  'grep --directories=recurse x .',
  'grep -r x . --exclude-dir=.git',
  'x=$(grep -r a .)',
  'if grep -rq a .; then echo ja; fi',
  'cd apps/overwolf-app && grep -r x',
];
for (const cmd of GESPERRT_BASH) {
  test(`gesperrt (bash): ${cmd}`, () => assert.ok(bash(cmd), cmd));
}

const GESPERRT_PWSH = [
  'gci -Recurse -Exclude node_modules',
  'Get-ChildItem -Recurse',
  'Get-ChildItem -r -Filter *.mjs',
  'Get-ChildItem C:\\ -Recurse',
  'Get-ChildItem -Path . -Recurse | Select-String foo',
  'Set-Location apps\\overwolf-app; gci -Recurse',
  'dir -Recurse node_modules',
  'gci -Depth 5',
  'Get-ChildItem -Path:$env:USERPROFILE -Recurse',
  'grep -r x .',
];
for (const cmd of GESPERRT_PWSH) {
  test(`gesperrt (PowerShell): ${cmd}`, () => assert.ok(pwsh(cmd), cmd));
}

// ------------------------------------------------ erlaubt

const ERLAUBT_BASH = [
  'grep -rn x app/',
  'grep -r x node_modules/next/dist/docs',
  'find . -maxdepth 1 -type f -size 0',
  'grep -r x . --exclude-dir=node_modules',
  'grep -r --exclude-dir={node_modules,.git} x .',
  'du -sh .next',
  'git grep -n x',
  "ssh root@host 'grep -r x /'",
  "ssh host 'du -sh node_modules'",
  "git commit -m \"$(cat <<'EOF'\nfix: grep -r x . durch Grep-Tool ersetzt\nfind / -name x\nEOF\n)\"",
  'git commit -m "fix; grep -r x ."',
  'echo "grep -r x ."',
  'rg x .',
  'find . -name node_modules -prune -o -name x -print',
  "grep -E 'a{1,50}' f",
  "grep -F 'a{0,3000}' f",
  "grep 'a{0,3000}' f",
  "grep -E 'a\\{0,3000\\}' f",
  'grep -rn "x" app/components/tft/compare/*.ts*',
  'grep -rln "onError" app/components app/lib',
  'find ~/AppData/Local/npm-cache/_npx -maxdepth 3 -name "playwright*" -type d',
  'find /c/Users/dtaub/AppData/Local/Temp/claude -name "stub.js"',
  'grep -n x file.txt',
  'grep x',
  'cat a | grep -v node_modules',
  'ls -la',
  'node scripts/x.mjs',
];
for (const cmd of ERLAUBT_BASH) {
  test(`erlaubt (bash): ${cmd.split('\n')[0]}`, () => assert.equal(bash(cmd), null, cmd));
}

const ERLAUBT_PWSH = [
  'Get-ChildItem -Path scripts -Recurse -Filter *.mjs',
  'Get-ChildItem',
  'gci -Depth 2',
  'Get-ChildItem -Recurse:$false',
  "git commit -m @'\nGet-ChildItem -Recurse\n'@",
  'Get-ChildItem app -Recurse',
  "Write-Output '-Recurse'",
  'find /i "x" file.txt',
];
for (const cmd of ERLAUBT_PWSH) {
  test(`erlaubt (PowerShell): ${cmd.split('\n')[0]}`, () => assert.equal(pwsh(cmd), null, cmd));
}

test('andere Tools und leere Eingaben werden nicht geprueft', () => {
  assert.equal(checkSearch('Edit', 'grep -r x .', PROJ, OPTS), null);
  assert.equal(checkSearch('Bash', '', PROJ, OPTS), null);
  assert.equal(checkSearch('Bash', undefined, PROJ, OPTS), null);
  assert.equal(checkSearch(undefined, 'grep -r x .', PROJ, OPTS), null);
});

test('ohne cwd gilt der Projektordner als Basis', () => {
  assert.ok(checkSearch('Bash', 'grep -r x .', undefined, OPTS));
});

test('unbekannte Variable als Ziel wird nicht geraten', () => {
  assert.equal(bash('grep -r x "$DIR"'), null);
});

test('Grenze liegt bei mehr als WIEDERHOLUNG_MAX', () => {
  assert.equal(bash(`grep -E 'a{0,${WIEDERHOLUNG_MAX}}' f`), null);
  assert.ok(bash(`grep -E 'a{0,${WIEDERHOLUNG_MAX + 1}}' f`));
});

test('Ablehnungstext nennt Grund, Befehl, Ausweg und Notschalter', () => {
  const v = bash('grep -r x .');
  const t = searchDenyText(v);
  assert.match(t, /Suchsperre: rekursives grep ueber den Projektordner/);
  assert.match(t, /Befehl: grep -r x \./);
  assert.match(t, /Grep- oder Glob-Tool/);
  assert.match(t, /SEARCH_GATE=0/);
});

test('20-KB-Befehl ist in wenigen Millisekunden geprueft', () => {
  const lang = `git commit -m "${'wort; '.repeat(3400)}" && grep -n x f`;
  assert.ok(lang.length > 20000);
  const start = process.hrtime.bigint();
  for (let i = 0; i < 10; i++) checkSearch('Bash', lang, PROJ, OPTS);
  const ms = Number(process.hrtime.bigint() - start) / 1e6 / 10;
  assert.ok(ms < 20, `${ms.toFixed(2)} ms pro Pruefung`);
});
