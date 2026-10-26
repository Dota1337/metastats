import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MASTER_BASE, rankScore } from './tft-rank-score.mjs';
import { ratingSql } from '../../scripts/lib/tft-rising.mjs';

test('Leiterpunkte: Stufen, Divisionen, Apex auf dem Master-Sockel', () => {
  assert.equal(MASTER_BASE, 2800);
  assert.equal(rankScore('IRON', 'IV', 0), 0);
  assert.equal(rankScore('emerald', 'II', 50), 5 * 400 + 200 + 50);
  assert.equal(rankScore('DIAMOND', null, 10), 2400 + 10);
  assert.equal(rankScore('CHALLENGER', 'I', 900), 3700);
  assert.equal(rankScore(null, 'I', 0), null);
  assert.equal(rankScore('UNRANKED', 'I', 0), null);
});

// ratingSql (Box-SQL fuer /tft/rising) muss fuer Smaragd+ dieselben Werte
// liefern. Ausgewertet wird der CASE-Ausdruck hier mit einem Mini-Interpreter
// ueber die drei Bausteine, damit kein Postgres noetig ist.
function evalRatingSql(tier, rank, lp) {
  const sql = ratingSql('a');
  const base = /WHEN a\.tier IN \('MASTER','GRANDMASTER','CHALLENGER'\) THEN (\d+)\s+WHEN a\.tier = 'DIAMOND' THEN (\d+)\s+WHEN a\.tier = 'EMERALD' THEN (\d+)/.exec(sql);
  const divs = Object.fromEntries([...sql.matchAll(/WHEN '(I{1,3}|IV)' THEN (\d+)/g)].map((m) => [m[1], Number(m[2])]));
  assert.ok(base && Object.keys(divs).length === 4, 'ratingSql hat eine neue Form — Test anpassen');
  const apex = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier);
  const b = apex ? Number(base[1]) : tier === 'DIAMOND' ? Number(base[2]) : Number(base[3]);
  return b + (apex ? 0 : divs[rank] ?? 0) + lp;
}

test('gleich mit ratingSql fuer Smaragd bis Challenger', () => {
  for (const tier of ['EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER']) {
    for (const rank of ['IV', 'III', 'II', 'I']) {
      for (const lp of [0, 37, 99]) {
        assert.equal(rankScore(tier, rank, lp), evalRatingSql(tier, rank, lp), `${tier} ${rank} ${lp}`);
      }
    }
  }
});
