import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compTraitFamilyKey } from '../../app/lib/tft-cluster.ts';
import {
  familyKeyFromCluster, isRiotMatchId, isRiotHandle, aggregateCells, staleRows, groupKey, boardCell, isLateBoard,
  regionFromMatchId, pseudonym, isPseudonym, shouldSeal, isFinalClass, classColumns, storedClass, collidingIds,
  PRIVACY_DEADLINE_MS,
} from './companion-positions.mjs';

const KEY = 'k'.repeat(40);

test('Pseudonym: je Spiel, gross/klein egal, eigene Vorsilbe, nie wie Riot-Name oder Konto-ID', () => {
  const p = pseudonym('EUW1_1', 'Name#EUW', KEY);
  assert.match(p, /^p_[0-9a-f]{24}$/);
  assert.ok(isPseudonym(p));
  assert.ok(!isRiotHandle(p));
  assert.equal(pseudonym('EUW1_1', ' name#euw ', KEY), p);
  assert.notEqual(pseudonym('EUW1_2', 'Name#EUW', KEY), p);
  assert.notEqual(pseudonym('EUW1_1', 'Name#EUW', 'x'.repeat(40)), p);
  assert.ok(!isPseudonym('Name#EUW'));
  assert.ok(!isPseudonym('abc123puuid'));
  assert.throws(() => pseudonym('EUW1_1', 'Name#EUW', ''));
  assert.throws(() => pseudonym('EUW1_1', 'Name#EUW', 'zu-kurz'));
  assert.throws(() => pseudonym('EUW1_1', 'Name#EUW', undefined));
});

test('Region aus der Match-ID', () => {
  assert.equal(regionFromMatchId('EUW1_7881677153'), 'euw1');
  assert.equal(regionFromMatchId('KR_1'), 'kr');
  assert.equal(regionFromMatchId('LIVE_1_x'), null);
});

test('Versiegeln: Treffer und „nicht im Spiel“ sofort, alles andere erst nach 48 h', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const fresh = { own: true, oldest: '2026-10-10T11:00:00Z' };
  const old = { own: true, oldest: new Date(now - PRIVACY_DEADLINE_MS).toISOString() };
  const hit = { clusterKey: 'T@4_C', familyKey: 'T__C', queue: 1100 };
  assert.ok(isFinalClass(hit));
  assert.ok(shouldSeal(fresh, hit, now));
  assert.ok(shouldSeal(fresh, { skip: 'not_in_match' }, now));
  for (const c of [{ skip: 'match_404' }, { skip: 'no_account' }, { skip: 'unclassified' }, { transient: true }, undefined]) {
    assert.ok(!shouldSeal(fresh, c, now), JSON.stringify(c));
    assert.ok(shouldSeal(old, c, now), JSON.stringify(c));
  }
  // Nur Gegner-Bretter: keine Zuordnung noetig.
  assert.ok(shouldSeal({ own: false, oldest: fresh.oldest }, undefined, now));
});

test('Zuordnung an der Zeile: schreiben und wieder lesen', () => {
  const cols = classColumns({ clusterKey: 'T@4_C~A', familyKey: 'T__C', queue: 1100 }, '2026-10-10T12:00:00Z');
  assert.deepEqual(cols, { cluster_key: 'T@4_C~A', family_key: 'T__C', queue_id: 1100, classified_at: '2026-10-10T12:00:00Z' });
  assert.deepEqual(storedClass(cols), { clusterKey: 'T@4_C~A', familyKey: 'T__C', queue: 1100, stored: true });
  assert.deepEqual(classColumns(undefined, 'x'), { cluster_key: null, family_key: null, queue_id: null, classified_at: 'x' });
  assert.equal(storedClass({ cluster_key: 'T@4_C', classified_at: null }), null);
});

test('Zweiter Upload: nur die schon vorhandenen Zeilen fallen weg', () => {
  const sealed = [{ id: 1, kind: 'own', cell: 3, unit: 'U1', round: 41 }, { id: 2, kind: 'opp', cell: 5, unit: 'U2', round: 41 }];
  const plain = [
    { id: 10, kind: 'own', cell: 3, unit: 'U1', round: 41 },   // schon da
    { id: 11, kind: 'own', cell: 3, unit: 'U1', round: 42 },   // neue Runde
    { id: 12, kind: 'opp', cell: 5, unit: 'U2', round: 41 },   // schon da
    { id: 13, kind: 'own', cell: 5, unit: 'U2', round: 41 },   // andere Art
  ];
  assert.deepEqual(collidingIds(plain, sealed), [10, 12]);
});

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

const obs = (match_id, unit, cell, observed_at = '2026-05-18T10:00:00Z', observer_puuid = 'A#EUW', round = 45, client_version = '0.4.1-28164') =>
  ({ match_id, observer_puuid, unit, cell, observed_at, round, client_version });

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

test('Zellen der App sind 1-basiert und werden auf 0-27 verschoben', () => {
  assert.equal(boardCell(1), 0);
  assert.equal(boardCell(28), 27);
  assert.equal(boardCell(0), null);
  assert.equal(boardCell(29), null);
  assert.equal(boardCell(null), null);
  const classes = new Map([[groupKey('EUW1_1', 'A#EUW'), { familyKey: 'T__C', queue: 1100 }]]);
  const r = aggregateCells([obs('EUW1_1', 'U1', 1), obs('EUW1_1', 'U1', 0), obs('EUW1_1', 'U2', 28)], classes);
  assert.deepEqual(r.rows.map(x => [x.unit, x.cell]), [['U1', 0], ['U2', 27]]);
  assert.equal(r.skipped, 1);
});

test('nur spaete Bretter ab App 0.3 zaehlen', () => {
  assert.ok(isLateBoard({ round: 41, client_version: '0.3.0-28164' }));
  assert.ok(isLateBoard({ round: 61, client_version: '1.0.0' }));
  assert.ok(!isLateBoard({ round: 37, client_version: '0.4.1-28164' }));
  assert.ok(!isLateBoard({ round: 45, client_version: '0.1.0' }));
  assert.ok(!isLateBoard({ round: 45, client_version: 'unknown' }));
  assert.ok(!isLateBoard({ round: 45, client_version: null }));
});

test('unit_matches zaehlt Spiele je Unit ueber alle Zellen', () => {
  const classes = new Map([
    [groupKey('EUW1_1', 'A#EUW'), { familyKey: 'T__C', queue: 1100 }],
    [groupKey('EUW1_2', 'A#EUW'), { familyKey: 'T__C', queue: 1100 }],
  ]);
  const r = aggregateCells([
    obs('EUW1_1', 'U1', 1), obs('EUW1_1', 'U1', 2, '2026-05-18T10:05:00Z', 'A#EUW', 51),
    obs('EUW1_2', 'U1', 3),
  ], classes);
  assert.equal(r.rows.length, 3);
  for (const row of r.rows) assert.equal(row.unit_matches, 2);
  assert.equal(r.rows.find(x => x.cell === 0).distinct_matches, 1);
});

test('veraltete Zeilen werden erkannt', () => {
  const fresh = [{ cluster_key: 'T__C', unit: 'U1', cell: 3 }];
  const existing = [
    { cluster_key: 'T__C', unit: 'U1', cell: 3 },
    { cluster_key: 'T@4_C', unit: 'U1', cell: 3 },
  ];
  assert.deepEqual(staleRows(existing, fresh), [{ cluster_key: 'T@4_C', unit: 'U1', cell: 3 }]);
});
