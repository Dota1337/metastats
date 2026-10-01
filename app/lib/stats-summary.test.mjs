// Drift-Waechter: die Kurztexte unter den Kategorien der Spielerseite kommen in
// ko/zh/es/fr aus den Vorlagen statSum.<id> (i18n.tsx) plus summaryVals
// (stats-categories.ts). Passen Vorlage und Zahlen-Reihenfolge nicht mehr
// zusammen, stuende dort eine falsche Zahl. Die de/en-Vorlagen muessen deshalb
// exakt den fertigen Satz summary/summaryEn ergeben.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateStatsOverview } from './stats-categories.ts';

const i18n = readFileSync(new URL('./i18n.tsx', import.meta.url), 'utf8');
const templates = {};
for (const [, id, args] of i18n.matchAll(/^\s*'statSum\.([a-z_]+)': t6\((.*)\),\s*$/gm)) {
  templates[id] = new Function(`return [${args}]`)();
}
const fill = (tpl, vals) => tpl.replace(/\{(\d+)\}/g, (m, i) => vals[Number(i)] ?? m);

// Kuenstliche Spiele: jedes Zahlenfeld bekommt einen eigenen, je Spiel
// verschiedenen Wert, damit vertauschte Platzhalter auffallen.
function numbers(i) {
  return (k) => { let h = 0; for (const c of k) h = (h * 31 + c.charCodeAt(0)) % 997; return (h % 13) + i * 0.7 + 1; };
}
function fakeMatch(i) {
  const num = numbers(i);
  const challenges = new Proxy({ teamDamagePercentage: 0.2 + i * 0.01 }, {
    get: (t, k) => (k in t ? t[k] : typeof k === 'string' ? num(k) : undefined),
  });
  const fixed = {
    challenges,
    matchId: `M${i}`, role: 'MIDDLE', win: i % 3 !== 0, queueId: 420, gameMode: 'CLASSIC',
    gameEndedInEarlySurrender: false, gameCreation: 1_700_000_000_000 + i * 3_600_000,
    gameDuration: 1500 + i * 37, champion: 'Ahri',
  };
  return new Proxy(fixed, {
    get(t, k) {
      if (k in t) return t[k];
      return typeof k === 'string' ? num(k) : undefined;
    },
  });
}

test('de/en-Vorlagen ergeben exakt summary/summaryEn, alle 6 Sprachen nutzen nur vorhandene Werte', () => {
  for (const sign of [1, -1]) {
    const matches = Array.from({ length: 24 }, (_, i) => fakeMatch(sign > 0 ? i : 23 - i));
    const { categories } = calculateStatsOverview(matches, null);
    assert.equal(categories.length, 17);
    for (const c of categories) {
      const t = templates[c.id];
      assert.ok(t && t.length === 6, `Vorlage fehlt: statSum.${c.id}`);
      assert.ok(Array.isArray(c.summaryVals), `summaryVals fehlt: ${c.id}`);
      assert.ok(!c.summaryVals.some((v) => v.includes('NaN')), `${c.id}: ${c.summaryVals}`);
      assert.equal(fill(t[0], c.summaryVals), c.summary, c.id);
      assert.equal(fill(t[1], c.summaryVals), c.summaryEn, c.id);
      for (const tpl of t) {
        const used = [...tpl.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));
        assert.deepEqual([...new Set(used)].sort(), c.summaryVals.map((_, i) => i), `${c.id}: ${tpl}`);
      }
    }
  }
});
