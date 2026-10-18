// Plan-Ahead-Code des Comp-Builders (tft-plan-ahead-code.ts). Anlass
// 2026-10-18: Elderwood-Pflanzen haben keinen Planner-Code — vorne im Brett
// duerfen sie keine echte Unit aus den 10 Plaetzen draengen.
//
// Lauf: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlanAheadCode } from './tft-plan-ahead-code.ts';

const bundle = JSON.parse(fs.readFileSync(new URL('../../public/tft-assets-18.json', import.meta.url), 'utf8'));
const coded = Object.keys(bundle.plannerCodes).filter(id => bundle.champions[id]).slice(0, 10);

test('Pflanzen und Doppelte belegen keinen Platz; erst danach wird auf 10 gekuerzt', () => {
  assert.equal(coded.length, 10);
  const ids = ['DA_Elderwood18_StonebarkTree', coded[0], coded[0], 'DA_Elderwood18_Lifeblossom', ...coded.slice(1)];
  const out = buildPlanAheadCode(ids, 18, bundle);
  const plain = buildPlanAheadCode(coded, 18, bundle);
  assert.equal(out.recognised, 10);
  assert.equal(out.total, ids.length);
  // Gleiche Units ergeben denselben Code, egal was dazwischen stand.
  assert.equal(out.code, plain.code);
});

test('Nur Units ohne Code: kein Code', () => {
  assert.equal(buildPlanAheadCode(['DA_Elderwood18_StonebarkTree'], 18, bundle), null);
  assert.equal(buildPlanAheadCode(coded, 18, { ...bundle, plannerCodes: undefined }), null);
});
