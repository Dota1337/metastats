import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleShares, ROLE_SHARE_MIN_GAMES } from './lol-role-assignment.ts';
import { parseRoleAssignment, teamObjectivesFor, extractTeamObjectives } from './match-processor.ts';

const games = (kind, n, queueId = 420) => Array.from({ length: n }, () => ({ queueId, roleAssignment: kind }));

test('parseRoleAssignment liest Teil 2, unbekannt wird null', () => {
  assert.equal(parseRoleAssignment('UTILITY.AUTOFILL.MIDDLE.BOTTOM.FILL'), 'AUTOFILL');
  assert.equal(parseRoleAssignment('MIDDLE.PRIMARY.MIDDLE.TOP'), 'PRIMARY');
  assert.equal(parseRoleAssignment('TOP.SECONDARY.MIDDLE.TOP'), 'SECONDARY');
  assert.equal(parseRoleAssignment('JUNGLE.FILL_PRIMARY.FILL'), 'FILL');
  assert.equal(parseRoleAssignment('JUNGLE.FILL_SECONDARY.TOP.FILL'), 'FILL');
  assert.equal(parseRoleAssignment('NONE.NONE'), null);
  assert.equal(parseRoleAssignment(''), null);
  assert.equal(parseRoleAssignment(undefined), null);
  assert.equal(parseRoleAssignment(42), null);
});

test('teamObjectivesFor: eigenes und gegnerisches Team', () => {
  const teams = [
    { teamId: 100, objectives: { dragon: { first: true, kills: 3 } } },
    { teamId: 200, objectives: { dragon: { first: false, kills: 1 } } },
  ];
  assert.deepEqual(teamObjectivesFor(teams, 100), { dragons: 3, enemyDragons: 1, firstDragon: true });
  assert.deepEqual(teamObjectivesFor(teams, 200), { dragons: 1, enemyDragons: 3, firstDragon: false });
  assert.equal(teamObjectivesFor(null, 100), null);
  assert.equal(teamObjectivesFor([], 100), null);
  assert.equal(teamObjectivesFor([teams[0]], 100), null);         // Gegner fehlt
  assert.equal(teamObjectivesFor(teams, 0), null);
  assert.equal(teamObjectivesFor([{ teamId: 100, objectives: {} }, teams[1]], 100), null);
});

test('extractTeamObjectives: alle bekannten Ziele, voidGator/champion nicht, fehlender Schluessel bleibt weg', () => {
  // Form wie Riots Antwort ab 16.22 (EUW1_8039501777): auch champion und voidGator.
  const o = (first, kills) => ({ first, kills });
  const raw = { info: { teams: [
    { teamId: 100, objectives: { baron: o(true, 1), champion: o(true, 31), dragon: o(false, 2), horde: o(true, 4),
      inhibitor: o(true, 2), riftHerald: o(false, 0), tower: o(true, 9), voidGator: o(false, 1) } },
    { teamId: 200, objectives: { baron: o(false, 0), dragon: o(true, 3), tower: o(false, 4) } },
  ] } };
  assert.deepEqual(extractTeamObjectives(raw), [
    { teamId: 100, tower: 9, dragon: 2, baron: 1, riftHerald: 0, horde: 4, inhibitor: 2,
      firstTower: true, firstDragon: false, firstBaron: true },
    // Altes Spiel ohne horde/inhibitor/riftHerald: Felder fehlen, keine 0.
    { teamId: 200, tower: 4, dragon: 3, baron: 0, firstTower: false, firstDragon: true, firstBaron: false },
  ]);
  assert.deepEqual(extractTeamObjectives({ info: { teams: [{ teamId: 100 }] } }), [{ teamId: 100 }]);
  assert.deepEqual(extractTeamObjectives({ info: { teams: [{ objectives: {} }, null] } }), []);
  assert.deepEqual(extractTeamObjectives({ info: {} }), []);
  assert.deepEqual(extractTeamObjectives(null), []);
});

test('roleShares: Schwelle, nur Queue 420, FILL zaehlt nicht', () => {
  assert.equal(roleShares(games('PRIMARY', ROLE_SHARE_MIN_GAMES - 1)), null);
  assert.equal(roleShares([...games('PRIMARY', 9), ...games('AUTOFILL', 5, 440)]), null);
  assert.equal(roleShares([...games('PRIMARY', 9), ...games('FILL', 5)]), null);
  assert.equal(roleShares([...games('PRIMARY', 9), ...games(null, 5)]), null);
  assert.deepEqual(roleShares(games('PRIMARY', 10)), { n: 10, primary: 100, secondary: 0, autofill: 0 });
});

test('roleShares: Summe immer 100', () => {
  const r = roleShares([...games('PRIMARY', 1), ...games('SECONDARY', 1), ...games('AUTOFILL', 1), ...games('PRIMARY', 9)]);
  assert.equal(r.n, 12);
  assert.equal(r.primary + r.secondary + r.autofill, 100);
  assert.deepEqual(r, { n: 12, primary: 84, secondary: 8, autofill: 8 });
  const s = roleShares([...games('PRIMARY', 23), ...games('SECONDARY', 4), ...games('AUTOFILL', 3)]);
  assert.equal(s.primary + s.secondary + s.autofill, 100);
  // Alte Antworten ohne Feld: kein Absturz, keine Anteile.
  assert.equal(roleShares([{ queueId: 420 }, { queueId: 420 }]), null);
});
