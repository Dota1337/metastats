import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compTraitFamilyKey } from '../../app/lib/tft-cluster.ts';
import {
  familyKeyFromCluster, isRiotMatchId, isRiotHandle, aggregateCells, staleRows, groupKey,
} from './companion-positions.mjs';

test('Familien-Schluessel stimmt mit app/lib/tft-cluster.ts ueberein', () => {
  const keys = [
    'TFT17_Stargazer@6_TFT17_Lulu',
    'TFT17_Stargazer@6_TFT17_Lulu*3',
    'TFT17_Stargazer@4_TFT17_Lulu~TwoTanky',
    'TFT17_Stargazer@4_TFT17_Lulu*3~TwoTanky#TFT17_Vex',
    'DA_Bruiser@2_DA_Garen',
    'kaputt-ohne-at',
    '',
  ];
  for (const k of keys) {
    assert.equal(familyKeyFromCluster(k) ?? '', compTraitFamilyKey(k) ?? '', k);
  }
});

test('nur echte Riot-Match-IDs zaehlen', () => {
  assert.ok(isRiotMatchId('EUW1_7857995904'));
  assert.ok(isRiotMatchId('KR_123'));
  assert.ok(!isRiotMatchId('LIVE_1779099300000_anon'));
  assert.ok(!isRiotMatchId('TEST_PROBE_1779054802830'));
  assert.ok(!isRiotMatchId('TEST_E2E_1779033035872'));
  assert.ok(isRiotHandle('TFT Chillout#EUW'));
  assert.ok(!isRiotHandle('abc123puuid'));
});

const obs = (match_id, unit, cell, observed_at = '2026-05-18T10:00:00Z', observer_puuid = 'A#EUW') =>
  ({ match_id, observer_puuid, unit, cell, observed_at });

test('Neuberechnung ist wiederholbar und zaehlt Spiele einzeln', () => {
  const classes = new Map([
    [groupKey('EUW1_1', 'A#EUW'), { familyKey: 'T__C', queue: 1100 }],
    [groupKey('EUW1_2', 'A#EUW'), { familyKey: 'T__C', queue: 1100 }],
  ]);
  const input = [
    obs('EUW1_1', 'U1', 3), obs('EUW1_1', 'U1', 3, '2026-05-18T10:05:00Z'),
    obs('EUW1_2', 'U1', 3, '2026-05-19T10:00:00Z'), obs('EUW1_2', 'U2', 4),
  ];
  const a = aggregateCells(input, classes);
  const b = aggregateCells(input, classes);
  assert.deepEqual(a, b);
  const u1 = a.rows.find(r => r.unit === 'U1');
  assert.equal(u1.observations, 3);
  assert.equal(u1.distinct_matches, 2);
  assert.equal(u1.last_observed_at, '2026-05-19T10:00:00Z');
  assert.equal(a.rows.length, 2);
});

test('ohne Zuordnung, falscher Modus oder kaputte Zelle faellt die Zeile raus', () => {
  const classes = new Map([
    [groupKey('EUW1_1', 'A#EUW'), { familyKey: 'T__C', queue: 1160 }],
    [groupKey('EUW1_2', 'A#EUW'), { familyKey: null, queue: 1100 }],
    [groupKey('EUW1_3', 'A#EUW'), { familyKey: 'T__C', queue: 1100 }],
  ]);
  const r = aggregateCells([
    obs('EUW1_1', 'U1', 1), obs('EUW1_2', 'U1', 1), obs('EUW1_9', 'U1', 1),
    obs('EUW1_3', 'U1', null), obs('EUW1_3', 'U1', 2),
  ], classes);
  assert.equal(r.used, 1);
  assert.equal(r.skipped, 4);
  assert.equal(r.rows.length, 1);
});

test('veraltete Zeilen werden erkannt', () => {
  const fresh = [{ cluster_key: 'T__C', unit: 'U1', cell: 3 }];
  const existing = [
    { cluster_key: 'T__C', unit: 'U1', cell: 3 },
    { cluster_key: 'T@4_C', unit: 'U1', cell: 3 },
  ];
  assert.deepEqual(staleRows(existing, fresh), [{ cluster_key: 'T@4_C', unit: 'U1', cell: 3 }]);
});
