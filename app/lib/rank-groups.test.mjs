import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TFT_RANK_GROUPS, LOL_RANK_GROUPS, tftStatsBucket, legacyTftBucket, lolTiersTopDown, expandLolTier,
} from './rank-groups.ts';

test('X+ reicht vom Rang X bis Challenger', () => {
  assert.deepEqual(TFT_RANK_GROUPS.diamond_plus, ['diamond', 'master', 'grandmaster', 'challenger']);
  assert.deepEqual(TFT_RANK_GROUPS.master_plus, ['master', 'grandmaster', 'challenger']);
  assert.deepEqual(TFT_RANK_GROUPS.grandmaster_plus, ['grandmaster', 'challenger']);
  assert.deepEqual(TFT_RANK_GROUPS.platinum_plus,
    ['platinum', 'emerald', 'diamond', 'master', 'grandmaster', 'challenger']);
  assert.deepEqual(Object.keys(LOL_RANK_GROUPS).sort(),
    ['DIAMOND_PLUS', 'EMERALD_PLUS', 'GRANDMASTER_PLUS', 'MASTER_PLUS', 'PLATINUM_PLUS']);
});

test('alte Einzelrang-Links landen auf der Gruppe', () => {
  for (const [raw, want] of [['platinum', 'platinum_plus'], ['emerald', 'emerald_plus'], ['diamond', 'diamond_plus'],
    ['master', 'master_plus'], ['grandmaster', 'grandmaster_plus'], ['challenger', 'challenger'], ['gold', 'gold'], ['all', 'all']]) {
    assert.equal(tftStatsBucket(raw), want, raw);
  }
});

test('Patch-Seiten behalten Einzel-Diamond', () => {
  assert.equal(legacyTftBucket('diamond'), 'diamond');
  assert.equal(legacyTftBucket('master'), 'master_plus');
});

test('LoL-Gruppen von oben nach unten', () => {
  assert.deepEqual(lolTiersTopDown('EMERALD_PLUS'), ['CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND', 'EMERALD']);
  assert.deepEqual(lolTiersTopDown('GOLD'), ['GOLD']);
  assert.deepEqual(expandLolTier('diamond_plus').sort(), ['CHALLENGER', 'DIAMOND', 'GRANDMASTER', 'MASTER']);
});
