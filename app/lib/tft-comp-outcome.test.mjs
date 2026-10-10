/**
 * Tests fuer die Rechen-Lib der neuen Comp-Detail-Bloecke (Migration 0078).
 * Werte von Hand nachgerechnet — faellt hier etwas, stimmen Wirkung, Bereich
 * oder Stufen auf der Seite nicht mehr.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCompOutcome, buildCompEmblems, compEmblemsFromUnits, meanDiff, gradeItem, outcomeItemGroup, outcomeHasData,
} from './tft-comp-outcome.ts';

const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('meanDiff: Differenz und 95-%-Bereich aus Quadratsummen', () => {
  // mit: 1,2,1,2  ohne: 5,6,5,6,5,6
  const e = meanDiff(4, 6, 10, 6, 33, 183);
  close(e.delta, -4);
  close(e.ci, 1.96 * Math.sqrt((1 / 3) / 4 + 0.3 / 6));
  // zu wenig Werte auf einer Seite -> keine Aussage
  assert.equal(meanDiff(1, 1, 1, 6, 33, 183), null);
  assert.equal(meanDiff(4, 6, 10, 1, 5, 25), null);
});

test('gradeItem: Kern nur nach Anteil, Stark/Schwach nur bei sicherem Abstand', () => {
  assert.equal(gradeItem('standard', 0.3, null), 'core');
  assert.equal(gradeItem('standard', 0.1, { delta: -1, ci: 0.5 }), 'strong');
  assert.equal(gradeItem('standard', 0.1, { delta: 1, ci: 0.5 }), 'weak');
  assert.equal(gradeItem('standard', 0.1, { delta: -1, ci: 1.2 }), 'optional');
  assert.equal(gradeItem('standard', 0.1, null), 'optional');
  // keine Stufe fuer Sondergruppen, auch bei hohem Anteil
  for (const g of ['artifact', 'radiant', 'emblem', 'tactician']) assert.equal(gradeItem(g, 0.9, { delta: -3, ci: 0.1 }), null);
});

test('outcomeItemGroup: Set-18-IDs', () => {
  assert.equal(outcomeItemGroup('DA_Artifact_WitsEnd'), 'artifact');
  assert.equal(outcomeItemGroup('DA_Artifactinate18'), 'standard');
  assert.equal(outcomeItemGroup('DA_18_EmblemBlossom'), 'emblem');
  assert.equal(outcomeItemGroup('DA_PhantomEmblem18'), 'emblem');
  assert.equal(outcomeItemGroup('DA_SunfireCape_Radiant'), 'radiant');
  assert.equal(outcomeItemGroup('DA_CrownguardRadiant'), 'radiant');
  assert.equal(outcomeItemGroup('DA_TacticiansCrown'), 'tactician');
  assert.equal(outcomeItemGroup('DA_InfinityEdge'), 'standard');
});

test('buildCompOutcome: Items, Kombis, Unit-Wirkung je Level, Platzverteilung', () => {
  const raw = {
    games: 4, rows_outcome: 3, rows_stats: 3,
    placement_hist: [1, 1, 0, 0, 1, 1, 0, 0],
    level_stats: { 8: [4, 14, 66, 2, 1] },
    level_stats_s5: { 8: [4, 14, 66, 2, 1] },
    units: {
      Kha: {
        // n=2 Boards; 10 Kopien mit 3 Items, Summe 39, Quadratsumme 193
        t: [2, 3, 5, 2, 1, 10, 39, 193, 4],
        lv: { 8: [2, 3, 5] },
        it: {
          IE: [4, 6, 10, 4, 5],
          GB: [2, 3, 5, 2, 2],
          DA_18_EmblemBlossom: [3, 6, 14, 3, 3],
        },
        sets: { 'GB|IE|IE': [2, 3, 2], 'IE|IE|IE': [1, 1, 1] },
      },
    },
  };
  const o = buildCompOutcome(raw);
  assert.deepEqual(o.placementShare, [0.25, 0.25, 0, 0, 0.25, 0.25, 0, 0]);
  assert.equal(o.lowData, true);
  assert.deepEqual(o.levels.map(l => [l.level, l.games, l.avgPlacement]), [[8, 4, 3.5]]);

  const u = o.units[0];
  assert.equal(u.presence, 0.5);
  close(u.effect.delta, -4);
  close(u.effect.ci, 1.96 * Math.sqrt(0.5 / 2 + 0.5 / 2));
  close(u.itemCopiesAvg, 3.9);
  assert.deepEqual(u.levelGames, { 8: 2 });

  const ie = u.items.find(i => i.item === 'IE');
  assert.equal(ie.grade, 'core');
  close(ie.share, 0.4);
  close(ie.perCopy, 1.25);
  const gb = u.items.find(i => i.item === 'GB');
  close(gb.effect.delta, -3);
  assert.equal(gb.grade, 'strong');
  const em = u.items.find(i => i.item === 'DA_18_EmblemBlossom');
  assert.equal(em.group, 'emblem');
  assert.equal(em.grade, null);
  assert.equal(em.effect, null);
  close(em.avgPlacement, 2);

  // 3 Kopien Blossom liegen unter 30 -> kein Comp-Emblem-Block.
  assert.equal(o.emblems, null);

  assert.deepEqual(u.sets[0].items, ['GB', 'IE', 'IE']);
  close(u.sets[0].share, 0.2);
});

test('buildCompOutcome: leere Antwort bricht nicht', () => {
  const o = buildCompOutcome({ games: 0, rows_outcome: 0, rows_stats: 0, placement_hist: [], level_stats: {}, level_stats_s5: {}, units: {} });
  assert.deepEqual(o.units, []);
  assert.deepEqual(o.levels, []);
});

test('buildCompEmblems: je Spiel, wenn alle Zeilen zaehlen; Augment/Phantom raus, Top 3', () => {
  const counts = {
    rows_outcome: 4, rows_emblems: 4,
    emblem_games: 100,
    emblems: {
      DA_18_EmblemExecutioner: { t: [40, 100, 300, 30, 10], h: { Zyra: 30, Veigar: 12 } },
      DA_18_EmblemBlackthorn: { t: [35, 140, 600, 15, 2], h: { Azir: 35 } },
      DA_18_EmblemFloraFatalisAugment: { t: [90, 90, 90, 90, 90], h: { Azir: 90 } },
      DA_PhantomEmblem18: { t: [80, 80, 80, 80, 80], h: { Azir: 80 } },
      DA_18_EmblemInferno: { t: [29, 29, 29, 29, 29], h: { Azir: 29 } },
    },
  };
  const e = buildCompEmblems(counts, []);
  assert.equal(e.basis, 'games');
  assert.equal(e.games, 100);
  assert.deepEqual(e.rows.map(r => r.item), ['DA_18_EmblemExecutioner', 'DA_18_EmblemBlackthorn']);
  const x = e.rows[0];
  close(x.share, 0.4);
  close(x.avgPlacement, 2.5);
  close(x.top4Rate, 0.75);
  assert.deepEqual(x.holders.map(h => h.characterId), ['Zyra', 'Veigar']);
  close(x.holders[0].share, 0.75);
  close(x.holders[1].share, 0.3);
  assert.equal(x.lowData, true);
  // Noch nicht jede Zeile zaehlt (eine Region von vor 0091) -> Uebergang, hier ohne Units: kein Block.
  assert.equal(buildCompEmblems({ ...counts, rows_emblems: 3 }, []), null);
});

const UNITS = [
  { characterId: 'Zyra', items: [
    { item: 'DA_18_EmblemExecutioner', copies: 200, avgPlacement: 3.5, top4Rate: 0.6 },
    { item: 'DA_InfinityEdge', copies: 500, avgPlacement: 4, top4Rate: 0.5 },
    { item: 'DA_18_EmblemFloraFatalisAugment', copies: 300, avgPlacement: 2, top4Rate: 0.9 },
  ] },
  { characterId: 'Veigar', items: [{ item: 'DA_18_EmblemExecutioner', copies: 20, avgPlacement: 3, top4Rate: 0.5 }] },
];

test('buildCompEmblems: Uebergang aus Items je Unit als Kopien, ohne Anteil', () => {
  // Alte Abfrage/Snapshot ohne Felder, zu wenig Zeilen, Abfrage gescheitert.
  for (const raw of [{}, { rows_outcome: 4, rows_emblems: 2, emblem_games: 400, emblems: {} }, { rows_outcome: 4 }]) {
    const e = buildCompEmblems(raw, UNITS);
    assert.equal(e.basis, 'copies');
    assert.equal(e.rows.length, 1);
    const x = e.rows[0];
    assert.equal(x.count, 220);
    assert.equal(x.share, null);
    close(x.avgPlacement, 760 / 220);
    close(x.top4Rate, 130 / 220);
    assert.deepEqual(x.holders.map(h => h.characterId), ['Zyra', 'Veigar']);
    close(x.holders[0].share, 200 / 220);
  }
  // Gleiches Ergebnis direkt aus den Units (Seite, gespeicherte Antwort von vor 0091).
  assert.equal(compEmblemsFromUnits(UNITS).rows[0].count, 220);
  // Keine Embleme -> kein Block.
  assert.equal(buildCompEmblems({ rows_outcome: 2, rows_emblems: 2, emblem_games: 500, emblems: {} }, []), null);
  assert.equal(compEmblemsFromUnits([]), null);
});

test('outcomeHasData: ab 30 Spielen, auch bei Teil-Abdeckung', () => {
  assert.equal(outcomeHasData({ games: 30 }), true);
  assert.equal(outcomeHasData({ games: 29 }), false);
  assert.equal(outcomeHasData({ games: 0 }), false);
  assert.equal(outcomeHasData({ games: '120' }), true);
  assert.equal(outcomeHasData(null), false);
});
