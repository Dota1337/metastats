/**
 * Artefakte + Embleme je Unit (0097, tft_daily_unit_extras, rechter Block auf
 * /tft/units): Sammler-Zaehlung und Gleichlauf der Muster zwischen Aggregator
 * (extraKindOf), Lesefunktion get_tft_unit_extras und Nachfuell-Skript.
 *
 * Lauf: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { aggregateMatch, emptyAggregate, finalize, extraKindOf } from './tft-build-aggregator.mjs';

test('extraKindOf: Artefakte, Embleme, keine Augment-/Phantom-Embleme, keine Mechanik', () => {
  assert.equal(extraKindOf('DA_Artifact_Dawncore'), 'artifact');
  assert.equal(extraKindOf('DA_Item_Artifact_TalismanOfAscension'), 'artifact');
  assert.equal(extraKindOf('DA_18_EmblemExecutioner'), 'emblem');
  assert.equal(extraKindOf('DA_18_EmblemFloraFatalisAugment'), null, 'Augment-Emblem waere eine Augment-Statistik');
  assert.equal(extraKindOf('DA_PhantomEmblem18'), null);
  assert.equal(extraKindOf('DA_Artifactinate18'), null, 'Set-18-Mechanik, kein Gegenstand');
  assert.equal(extraKindOf('DA_JeweledGauntlet'), null);
  assert.equal(extraKindOf(null), null);
});

// SQL-Muster aus einer Datei: Artefakt `~* '…' then 'artifact'`, Emblem
// `~* '…' and … !~* '…' then 'emblem'` (Lesefunktion) bzw. dasselbe als
// WHERE-Bedingung (Nachfuell-Skript).
function sqlKindFrom(sql, label) {
  const art = /~\*\s*'([^']+)'\s*then\s*'artifact'/.exec(sql)?.[1]
    ?? /api_name\s*~\*\s*'([^']+)'\s*or\s*\(/.exec(sql)?.[1];
  const emb = /~\*\s*'([^']+)'\s*and\s*[\w.]+\s*!~\*\s*'([^']+)'/.exec(sql);
  assert.ok(art && emb, `Muster in ${label} nicht gefunden — Test an die neue Form anpassen`);
  const artRe = new RegExp(art, 'i');
  const embRe = new RegExp(emb[1], 'i');
  const skipRe = new RegExp(emb[2], 'i');
  return name => (artRe.test(name) ? 'artifact' : embRe.test(name) && !skipRe.test(name) ? 'emblem' : null);
}

test('SQL-Muster (neueste Migration mit get_tft_unit_extras + Nachfuell-Skript) = extraKindOf', () => {
  const dir = new URL('../../supabase/migrations/', import.meta.url);
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
    .filter(f => /function public\.get_tft_unit_extras\s*\(/.test(readFileSync(new URL(f, dir), 'utf8')));
  assert.ok(files.length > 0, 'keine Migration definiert get_tft_unit_extras');
  const sources = [
    [files.at(-1), readFileSync(new URL(files.at(-1), dir), 'utf8')],
    ['backfill-unit-extras.sql', readFileSync(new URL('../oneoff/backfill-unit-extras.sql', import.meta.url), 'utf8')],
  ];
  const assets = JSON.parse(readFileSync(new URL('../../public/tft-assets-18.json', import.meta.url), 'utf8'));
  const names = [...Object.keys(assets.items || {}), 'DA_Artifactinate18', 'DA_18_EmblemFloraFatalisAugment'];
  assert.ok(names.length > 100, `nur ${names.length} Item-Namen im Bundle`);
  for (const [label, sql] of sources) {
    const sqlKind = sqlKindFrom(sql, label);
    const diff = names.filter(n => sqlKind(n) !== extraKindOf(n));
    assert.deepEqual(diff, [], `${label} urteilt anders als extraKindOf`);
  }
});

test('Sammler: Artefakt + Emblem je Kopie, Thief\'s-Gloves-Kopie zaehlt nicht, sortiert nach Kopien', () => {
  const agg = emptyAggregate();
  const p = (i, units) => ({
    puuid: `p${i}`, placement: i + 1, level: 8, last_round: 30, augments: [],
    traits: [{ name: 'DA_18_Executioner', num_units: 4, style: 2, tier_current: 2, tier_total: 4 }],
    units,
  });
  const veigar = items => ({ character_id: 'DA_18_Veigar', tier: 2, itemNames: items });
  aggregateMatch({
    metadata: { match_id: 'EUW1_1' },
    info: {
      queue_id: 1100, tft_set_number: 18, participants: [
        // Platz 1: Artefakt + Emblem + normales Item; dasselbe Artefakt doppelt zaehlt einmal.
        p(0, [veigar(['DA_Artifact_Dawncore', 'DA_Artifact_Dawncore', 'DA_18_EmblemExecutioner'])]),
        // Platz 2: nur das Artefakt.
        p(1, [veigar(['DA_Artifact_Dawncore', 'DA_JeweledGauntlet'])]),
        // Platz 3: Thief's Gloves — ganze Kopie raus, auch wenn ein Emblem dabei ist.
        p(2, [veigar(['DA_ThiefsGloves', 'DA_18_EmblemExecutioner'])]),
        // Platz 4: Augment-Emblem zaehlt nicht.
        p(3, [veigar(['DA_18_EmblemFloraFatalisAugment'])]),
      ],
    },
  }, agg, { tierBucket: 'diamond', currentSet: 18 });
  const b = finalize(agg, { minUnitGames: 1 }).byUnit.DA_18_Veigar.diamond;
  assert.equal(b.games, 4);
  assert.deepEqual(b.persistExtras, [
    ['DA_Artifact_Dawncore', 2, 2, 3],
    ['DA_18_EmblemExecutioner', 1, 1, 1],
  ]);
});
