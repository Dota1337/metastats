import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleShares, ROLE_SHARE_MIN_GAMES } from './lol-role-assignment.ts';
import { parseRoleAssignment, teamObjectivesFor } from './match-processor.ts';

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
