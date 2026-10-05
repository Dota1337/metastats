/**
 * collect-tft-allranks.mjs bis zur ersten Riot-Abfrage: welcher Patch-Name
 * fuer einen Sammeltag gilt, wie --set/--patch des Treibers wirken, und dass
 * jede kaputte Eingabe den Lauf abbricht, bevor gesammelt oder geschrieben
 * wird. Laeuft ohne Netz und ohne Schluessel — --label-only endet nach der
 * Namensbestimmung.
 *
 * Als Prozess statt als Import, weil das Skript beim Laden sofort loslaeuft und
 * genau Exit-Code und Ausgabe zaehlen.
 *
 * Anlass: der Sammler hat den Namen aus game_version geraten; seit Set 18
 * steht dort keine Nummer mehr, so landeten der 23. und 24.09.2026 als 18.2b
 * statt 18.3 / 18.3b in der Datenbank.
 *
 * Lauf: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crawlPatch } from './lib/tft-patch-day.mjs';
import { resolveCrawlDay } from './lib/tft-crawl-window.mjs';

const SCRIPT = fileURLToPath(new URL('./collect-tft-allranks.mjs', import.meta.url));
const SEEN = '2026-10-05T00:56:50.541Z';
const START = (patch, from_day) => ({ set: Number(patch.split('.')[0]), patch, from_day, seen_at: SEEN });
const CUT = (patch, base, from_day) => ({
  set: Number(base.split('.')[0]), patch, base, from_day, source: 'patch-notes', detected_at: SEEN,
});
// Spiegel der echten Datei (Stand 2026-10-05), bewusst ohne Termine fuer Set 19.
const META = {
  setNumber: 18, setName: 'Enchanted Wilds', latestPatch: '18.3', lolPatch: '16.19.1',
  patchCuts: [CUT('18.1b', '18.1', '2026-09-01'), CUT('18.2b', '18.2', '2026-09-14'), CUT('18.3b', '18.3', '2026-09-24')],
  patchStarts: [
    START('18.1', '2026-08-26'), START('18.2', '2026-09-10'), START('18.3', '2026-09-23'),
    START('18.4', '2026-10-07'), START('18.5', '2026-10-21'), START('18.6', '2026-11-04'),
  ],
};

// file: Objekt -> JSON, String -> Rohinhalt, null -> keine Datei.
// tft-assets.json liegt wie auf der Box daneben: die Klassifikation liest beim
// Laden ihr Set ueber current-set.mjs und weicht auf diese Datei aus, wenn
// tft-set.json fehlt — erst danach kommt der Sammler selbst an die Reihe.
function run(file, extra, assets = { set: 18 }) {
  const dir = mkdtempSync(join(tmpdir(), 'collect-tft-allranks-'));
  mkdirSync(join(dir, 'public'));
  if (file !== null) {
    writeFileSync(join(dir, 'public', 'tft-set.json'), typeof file === 'string' ? file : JSON.stringify(file, null, 2));
  }
  if (assets !== null) writeFileSync(join(dir, 'public', 'tft-assets.json'), JSON.stringify(assets));
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...extra], {
      cwd: dir, timeout: 30_000,
      env: { ...process.env, RIOT_API_KEY_TFT: '', SUPABASE_SERVICE_ROLE_KEY: '' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (status) => {
      rmSync(dir, { recursive: true, force: true });
      resolve({ status, stdout, stderr, ms: Date.now() - t0 });
    });
  });
}
const label = (day, extra = [], file = META) => run(file, ['--day', day, '--label-only', ...extra]);

// "[label] day=… set=… patch=…" -> { day, set, patch }; null ohne diese Zeile.
function parsed(stdout) {
  const m = stdout.match(/^\[label\] day=(\S+) set=(\d+) patch=(\S+)$/m);
  return m ? { day: m[1], set: Number(m[2]), patch: m[3] } : null;
}

test('Tag-Regel: Go-Live-Tag gehoert zum neuen Patch, B-Patch ab seinem Stichtag', async () => {
  const want = [
    ['2026-09-14', '18.2b'], ['2026-09-22', '18.2b'], ['2026-09-23', '18.3'],
    ['2026-09-24', '18.3b'], ['2026-10-06', '18.3b'], ['2026-10-07', '18.4'],
  ];
  const rs = await Promise.all(want.map(([day]) => label(day)));
  want.forEach(([day, patch], i) => {
    assert.equal(rs[i].status, 0, `${day}: ${rs[i].stderr}`);
    assert.deepEqual(parsed(rs[i].stdout), { day, set: 18, patch });
    assert.equal(rs[i].stderr, '', `${day}: unerwartete Meldung`);
  });
});

test('Vorgabe des Treibers: gleicher Wert still, abweichender Wert gilt mit Warnung', async () => {
  const [same, other] = await Promise.all([
    label('2026-09-24', ['--set', '18', '--patch', '18.3b']),
    label('2026-09-24', ['--patch', '18.3c']),
  ]);
  assert.equal(same.status, 0, same.stderr);
  assert.deepEqual(parsed(same.stdout), { day: '2026-09-24', set: 18, patch: '18.3b' });
  assert.equal(same.stderr, '');

  assert.equal(other.status, 0, other.stderr);
  assert.deepEqual(parsed(other.stdout), { day: '2026-09-24', set: 18, patch: '18.3c' });
  assert.match(other.stderr, /\[patch\] Patch-Vorgabe 18\.3c, eigene Rechnung 18\.3b — die Vorgabe gilt/);
});

test('Schreibweise mit Gleichheitszeichen wirkt wie die getrennte', async () => {
  const args = ['--day=2026-09-24', '--label-only', `--set=${META.setNumber}`];
  args.push('--patch=18.3c');
  const r = await run(META, args);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(parsed(r.stdout), { day: '2026-09-24', set: 18, patch: '18.3c' });
  assert.match(r.stderr, /Patch-Vorgabe 18\.3c/);
});

test('Set-Vorgabe ohne eigenen Terminplan: nur mit Patch-Vorgabe, und dann mit Warnung', async () => {
  const [bare, withPatch] = await Promise.all([
    label('2026-12-02', ['--set', '19']),
    label('2026-12-02', ['--set', '19', '--patch', '19.1']),
  ]);
  assert.equal(bare.status, 1);
  assert.match(bare.stderr, /kein Patch-Name fuer 2026-12-02 \(Set 19\) — Abbruch, nichts geschrieben/);
  assert.equal(bare.stdout, '');

  assert.equal(withPatch.status, 0, withPatch.stderr);
  assert.deepEqual(parsed(withPatch.stdout), { day: '2026-12-02', set: 19, patch: '19.1' });
  assert.match(withPatch.stderr, /Set-Vorgabe 19, tft-set\.json sagt 18 — die Vorgabe gilt/);
  assert.match(withPatch.stderr, /Patch-Vorgabe 19\.1, eigene Rechnung – — die Vorgabe gilt/);
});

test('kaputte Vorgaben brechen ab, bevor gesammelt wird', async () => {
  const cases = [
    ['Patch nicht kanonisch', ['--patch', '18.03'], /ungueltige Patch-Vorgabe "18\.03"/],
    ['Patch einer anderen Set', ['--patch', '17.9'], /Patch-Vorgabe 17\.9 gehoert nicht zu Set 18/],
    ['Patch mit zwei Buchstaben', ['--patch', '18.3bb'], /ungueltige Patch-Vorgabe "18\.3bb"/],
    ['Set keine Zahl', ['--set', 'abc'], /ungueltige Set-Vorgabe "abc"/],
    ['Set ohne Wert am Ende', ['--set'], /ungueltige Set-Vorgabe ""/],
    ['Patch ohne Wert vor dem naechsten Schalter', ['--patch', '--mode', 'auto'], /ungueltige Patch-Vorgabe ""/],
  ];
  const rs = await Promise.all(cases.map(([, extra]) => label('2026-09-24', extra)));
  cases.forEach(([name, , msg], i) => {
    assert.equal(rs[i].status, 1, name);
    assert.match(rs[i].stderr, /\[patch\] .* — Abbruch, nichts geschrieben/, name);
    assert.match(rs[i].stderr, msg, name);
    assert.equal(rs[i].stdout, '', name);
  });
});

test('--day muss ein echter Kalendertag sein', async () => {
  const cases = [['--day', '2026-02-30'], ['--day', '2026-9-1'], ['--day', ''], ['--day']];
  const rs = await Promise.all(cases.map((c) => run(META, [...c, '--label-only'])));
  cases.forEach((c, i) => {
    assert.equal(rs[i].status, 1, c.join(' '));
    assert.match(rs[i].stderr, /Invalid --day/, c.join(' '));
    assert.equal(rs[i].stdout, '', c.join(' '));
  });
});

test('ohne Terminplan: Rueckfall auf latestPatch mit Warnung, fremder latestPatch bricht ab', async () => {
  const [fb, foreign] = await Promise.all([
    label('2026-09-25', [], { ...META, patchStarts: undefined }),
    label('2026-09-25', [], { ...META, patchStarts: undefined, latestPatch: '17.9' }),
  ]);
  assert.equal(fb.status, 0, fb.stderr);
  assert.deepEqual(parsed(fb.stdout), { day: '2026-09-25', set: 18, patch: '18.3b' });
  assert.match(fb.stderr, /\[patch\] .*Rueckfall/);

  assert.equal(foreign.status, 1);
  assert.match(foreign.stderr, /kein Patch-Name fuer 2026-09-25/);
  assert.equal(foreign.stdout, '');
});

test('tft-set.json fehlt, ist kein Objekt oder ohne Set: Abbruch, nach kurzem Warten', async () => {
  const [missing, list, cut, noSet, both] = await Promise.all([
    label('2026-09-24', [], null),
    label('2026-09-24', [], '[]'),
    label('2026-09-24', [], JSON.stringify(META).slice(0, 40)),
    label('2026-09-24', [], { ...META, setNumber: undefined }),
    run(null, ['--day', '2026-09-24', '--label-only'], null),
  ]);
  for (const [name, r] of [['fehlt', missing], ['Liste', list], ['abgeschnitten', cut]]) {
    assert.equal(r.status, 1, name);
    assert.match(r.stderr, /\[set\] public\/tft-set\.json nicht lesbar: .* — Abbruch, nichts geschrieben/, name);
    assert.ok(r.ms >= 3500, `${name}: nur ${r.ms} ms gewartet`);
    assert.equal(r.stdout, '', name);
  }
  assert.match(list.stderr, /kein JSON-Objekt/);

  assert.equal(noSet.status, 1);
  assert.match(noSet.stderr, /\[patch\] tft-set\.json ohne gueltige setNumber/);
  assert.equal(noSet.stdout, '');

  // Ohne beide Dateien bricht schon das Laden der Klassifikation ab.
  assert.equal(both.status, 1);
  assert.match(both.stderr, /\[current-set\] Weder public\/tft-set\.json noch public\/tft-assets\.json/);
  assert.equal(both.stdout, '');
});

// Der Tag kommt hier aus der Uhr; vorher und nachher gerechnet, falls der Lauf
// genau ueber 05:00 UTC faellt.
test('ohne --day: Tag aus der Uhr, Name trotzdem aus dem Terminplan', async () => {
  for (const mode of ['auto', 'today']) {
    const before = resolveCrawlDay(new Date(), mode);
    const r = await run(META, ['--mode', mode, '--label-only']);
    const after = resolveCrawlDay(new Date(), mode);
    assert.equal(r.status, 0, `${mode}: ${r.stderr}`);
    const p = parsed(r.stdout);
    assert.ok(p && (p.day === before || p.day === after), `${mode}: ${r.stdout}`);
    assert.deepEqual(p, { day: p.day, set: 18, patch: crawlPatch(p.day, META).patch }, mode);
  }
});

test('ohne Schluessel und ohne --label-only: Abbruch vor der ersten Riot-Abfrage', async () => {
  const r = await run(META, ['--day', '2026-09-24']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /RIOT_API_KEY_TFT env var required/);
  assert.equal(r.stdout, '');
});
