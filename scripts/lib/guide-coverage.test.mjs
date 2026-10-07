import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureGuideCoverage, evaluateGuideCoverage } from './guide-coverage.mjs';

const NOW = Date.parse('2026-10-08T12:00:00Z');
const OPTS = { set: 18, minRatio: 0.70, warnRatio: 0.80, minFamilies: 3, now: NOW };

// n Comps mit je `games` Spielen; die ersten `covered` haben eine Anleitung.
function body({ n = 4, covered = 4, games = [400, 300, 200, 100], ...over } = {}) {
  return {
    v: 1,
    set: 18,
    generatedAt: '2026-10-08T11:00:00Z',
    guides: { set: 18, clusterId: 425, fetchedAt: '2026-10-07T05:45:43.003Z' },
    comps: Array.from({ length: n }, (_, i) => ({
      key: `T${i}__C${i}`,
      name: `Trait${i} · Carry${i}`,
      games: games[i] ?? 10,
      ...(i < covered ? { guideId: `g${i}` } : {}),
    })),
    ...over,
  };
}

test('misst nach Spielen, nicht nach Comps; Luecken absteigend', () => {
  const b = body({ covered: 0 });
  b.comps[0].guideId = 'g0';            // 400 von 1000
  b.comps[3].guideId = 'g3';            // +100
  const m = measureGuideCoverage(b);
  assert.equal(m.totalGames, 1000);
  assert.equal(m.coveredGames, 500);
  assert.equal(m.ratio, 0.5);
  assert.equal(m.coveredFamilies, 2);
  assert.deepEqual(m.gaps.map((g) => g.games), [300, 200]);
});

test('ok ueber der Warnschwelle', () => {
  const r = evaluateGuideCoverage(body({ covered: 3 }), OPTS);   // 900/1000
  assert.equal(r.status, 'ok');
  assert.match(r.detail, /^90\.0 % der Spiele mit Anleitung .* 3\/4 Comps, Set 18, MetaTFT-Stand 2026-10-07/);
});

test('warn zwischen 70 und 80 %, ohne Mail-Status', () => {
  const r = evaluateGuideCoverage(body({ covered: 2, games: [450, 300, 150, 100] }), OPTS);   // 750/1000
  assert.equal(r.status, 'warn');
  assert.match(r.detail, /75\.0 %.*grösste Lücken: Trait2 · Carry2 \(150\), Trait3 · Carry3 \(100\)/);
});

test('broken unter 70 %', () => {
  const r = evaluateGuideCoverage(body({ covered: 1 }), OPTS);   // 400/1000
  assert.equal(r.status, 'broken');
  assert.match(r.detail, /^nur 40\.0 %/);
});

test('genau auf der Schwelle zaehlt als erreicht', () => {
  const r = evaluateGuideCoverage(body({ covered: 2, games: [400, 300, 200, 100] }), OPTS);  // 700/1000
  assert.equal(r.status, 'warn');
});

test('zu wenige Comps: broken mit eigener Begruendung', () => {
  const r = evaluateGuideCoverage(body({ n: 2, covered: 2 }), OPTS);
  assert.equal(r.status, 'broken');
  assert.match(r.detail, /nur 2 Comps in der Liste \(min 3\)/);
});

test('falsches Set, fehlende Datei, altes Feld, Fehlerantwort', () => {
  assert.match(evaluateGuideCoverage(body({ set: 17 }), OPTS).detail, /Route liefert Set 17, erwartet Set 18/);
  assert.match(evaluateGuideCoverage(body({ guides: null }), OPTS).detail, /keine MetaTFT-Datei für Set 18/);
  assert.match(evaluateGuideCoverage(body({ guides: undefined }), OPTS).detail, /ohne Feld guides/);
  assert.match(evaluateGuideCoverage(body({ guides: { set: 17, fetchedAt: 'x' } }), OPTS).detail, /Datei ist für Set 17/);
  assert.match(evaluateGuideCoverage({ v: 1, error: 'comps_unavailable' }, OPTS).detail, /comps_unavailable/);
  for (const b of [body({ set: 17 }), body({ guides: null }), { v: 1, error: 'x' }, null]) {
    assert.equal(evaluateGuideCoverage(b, OPTS).status, 'broken');
  }
});

test('alte Antwort stuft gruen auf warn, rot bleibt rot', () => {
  const old = { generatedAt: '2026-10-07T12:00:00Z' };   // 24 h
  assert.equal(evaluateGuideCoverage(body({ covered: 4, ...old }), OPTS).status, 'warn');
  assert.match(evaluateGuideCoverage(body({ covered: 4, ...old }), OPTS).detail, /24\.0 h alt/);
  assert.equal(evaluateGuideCoverage(body({ covered: 1, ...old }), OPTS).status, 'broken');
  assert.match(evaluateGuideCoverage(body({ covered: 4, generatedAt: undefined }), OPTS).detail, /ohne Zeitstempel/);
});
