import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  decideResume, emptyMatchState, recentStarts, resumedFields, RESUME_MAX_AGE_MS, RESUME_WAIT_MS, type MatchSnapshot, type ResumeContext,
} from './match-state.ts';

const T = 1_760_000_000_000;
const names = ['Me#EUW', 'A#EUW', 'B#EUW', 'C#EUW', 'D#EUW', 'E#EUW', 'F#EUW', 'G#EUW'];
const snap: MatchSnapshot = {
  sessionId: 's1', classId: 28164, startedAt: T - 600_000, updatedAt: T - 30_000, stage: '3-2',
  oppBoards: {}, roster: names.map(name => ({ name, health: 50, rank: null })), pvp: { '3-1': 'A#EUW' },
  queueId: 1100, dismissed: ['shop'], submitted: false, mainHandled: true, wasTft: true,
  placement: null, matchId: null, handle: 'Me#EUW', starts: [],
};
const ctx: ResumeContext = { now: T, seenAt: T, sessionId: 's1', classId: 28164, names: [], stage: null, starts: [T] };

test('Gleiche sessionId: fortsetzen, andere: Fingerabdruck (Wiederverbinden)', () => {
  assert.equal(decideResume(snap, ctx).verdict, 'resume');
  const other = { ...ctx, sessionId: 's2' };
  assert.equal(decideResume(snap, other).verdict, 'wait');                              // Liste fehlt noch
  assert.equal(decideResume(snap, { ...other, names }).verdict, 'resume');              // dieselbe Partie
  assert.equal(decideResume(snap, { ...other, names: ['X', 'Y', 'Z', 'W', 'V', 'U', 'Me#EUW'] }).verdict, 'fresh');
  assert.equal(decideResume({ ...snap, updatedAt: T - RESUME_MAX_AGE_MS - 1 }, other).reason, 'too old');
  assert.equal(decideResume(null, ctx).verdict, 'fresh');
  assert.equal(decideResume(snap, { ...ctx, classId: 5426 }).verdict, 'fresh');
});

test('Ohne sessionId: Fingerabdruck aus Alter, Stufe und Spielernamen', () => {
  const c = { ...ctx, sessionId: null };
  assert.equal(decideResume(snap, c).verdict, 'wait');                                  // Liste fehlt noch
  assert.equal(decideResume(snap, { ...c, names }).verdict, 'resume');
  assert.equal(decideResume(snap, { ...c, names: [...names.slice(0, 4), 'X', 'Y', 'Z', 'W'] }).verdict, 'fresh');
  assert.equal(decideResume(snap, { ...c, names: names.slice(0, 5) }).verdict, 'resume');
  assert.equal(decideResume(snap, { ...c, names, stage: '2-1' }).reason, 'stage back');
  assert.equal(decideResume(snap, { ...c, names, stage: '3-5' }).verdict, 'resume');
  assert.equal(decideResume({ ...snap, updatedAt: T - RESUME_MAX_AGE_MS - 1 }, { ...c, names }).reason, 'too old');
  assert.equal(decideResume(snap, { ...c, now: T + RESUME_WAIT_MS + 1 }).reason, 'no roster');
  // Gross-/Kleinschreibung zaehlt nicht.
  assert.equal(decideResume(snap, { ...c, names: names.map(n => n.toUpperCase()) }).verdict, 'resume');
});

test('Absturz-Schleife: 3 Starts in 2 Minuten → nicht fortsetzen', () => {
  const starts = recentStarts([T - 100_000, T - 50_000], T);
  assert.equal(starts.length, 3);
  assert.equal(decideResume(snap, { ...ctx, starts }).reason, 'crash loop');
  assert.deepEqual(recentStarts([T - 130_000, T - 10_000], T), [T - 10_000, T]);
  assert.deepEqual(recentStarts(null, T), [T]);
});

test('emptyMatchState deckt jedes Partie-Feld von ms.live ab', () => {
  const src = readFileSync(new URL('./store.ts', import.meta.url), 'utf8');
  const block = /export interface Live \{([\s\S]*?)\n\}/.exec(src)![1];
  const fields = [...block.matchAll(/^\s+(\w+):/gm)].map(m => m[1]).filter(f => f !== 'updatedAt').sort();
  assert.deepEqual(Object.keys(emptyMatchState()).sort(), fields);
  // Jeder Aufruf liefert frische Objekte (kein geteilter Zustand).
  assert.notEqual(emptyMatchState().oppBoards, emptyMatchState().oppBoards);
});

test('resumedFields uebernimmt das Gesehene', () => {
  const r = resumedFields(snap);
  assert.equal(r.startedAt, snap.startedAt);
  assert.deepEqual(r.pvp, { '3-1': 'A#EUW' });
  assert.deepEqual(r.dismissed, ['shop']);
  assert.equal(r.wasTft, true);
});
