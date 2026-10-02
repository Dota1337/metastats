import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flush, enqueue, verdict, MAX_ENTRIES, MAX_TRIES, MAX_AGE_MS, type OutboxEntry, type OutboxStore } from './outbox.ts';
import { recordBoard, flattenBoards, type Boards } from './boards.ts';

function memStore(): OutboxStore & { map: Map<string, OutboxEntry> } {
  const map = new Map<string, OutboxEntry>();
  return {
    map,
    all: async () => [...map.values()],
    put: async e => { map.set(e.id, e); },
    del: async id => { map.delete(id); },
  };
}

const entry = (id: string, createdAt = 1000, tries = 0): OutboxEntry => ({ id, url: 'u', body: '{}', createdAt, tries });

test('verdict: 2xx fertig, 400/413 verwerfen, 401/429/5xx/Netz erneut', () => {
  assert.equal(verdict({ status: 200 }), 'done');
  assert.equal(verdict({ status: 400 }), 'drop');
  assert.equal(verdict({ status: 413 }), 'drop');
  assert.equal(verdict({ status: 401 }), 'retry');
  assert.equal(verdict({ status: 429 }), 'retry');
  assert.equal(verdict({ status: 503 }), 'retry');
  assert.equal(verdict({ error: 'Failed to fetch' }), 'retry');
});

test('Sendefehler behaelt das Paket, spaeterer Erfolg entfernt es', async () => {
  const s = memStore();
  await enqueue(s, entry('a'));
  let r = await flush(s, async () => ({ error: 'offline' }), 2000);
  assert.deepEqual(r, { sent: 0, dropped: 0, left: 1 });
  assert.equal(s.map.get('a')?.tries, 1);
  r = await flush(s, async () => ({ status: 200 }), 3000);
  assert.deepEqual(r, { sent: 1, dropped: 0, left: 0 });
  assert.equal(s.map.size, 0);
});

test('400 verwirft, zu alt oder zu oft versucht verwirft ohne Senden', async () => {
  const s = memStore();
  await enqueue(s, entry('bad', 1000));
  await enqueue(s, entry('old', 0));
  await enqueue(s, entry('tired', 1000, MAX_TRIES));
  let calls = 0;
  const r = await flush(s, async () => { calls++; return { status: 400 }; }, MAX_AGE_MS + 1);
  assert.equal(calls, 1);
  assert.deepEqual(r, { sent: 0, dropped: 3, left: 0 });
});

test('Stau: nur die neuesten MAX_ENTRIES bleiben', async () => {
  const s = memStore();
  for (let i = 0; i < MAX_ENTRIES + 3; i++) await enqueue(s, entry('e' + i, i));
  assert.equal(s.map.size, MAX_ENTRIES);
  assert.ok(!s.map.has('e0') && s.map.has('e' + (MAX_ENTRIES + 2)));
});

test('Brett: je Runde nur der letzte Stand, Gegner getrennt', () => {
  const b: Boards = new Map();
  const p = (cell: number, unit: string) => ({ cell, unit, level: 1, items: [] });
  recordBoard(b, 'own', 21, null, [p(1, 'A')]);
  recordBoard(b, 'own', 21, null, [p(2, 'A'), p(3, 'B')]); // umgestellt
  recordBoard(b, 'own', 22, null, [p(2, 'A')]);
  recordBoard(b, 'opp', 22, 'X#1', [p(5, 'C')]);
  recordBoard(b, 'opp', 22, 'Y#1', [p(6, 'D')]);
  const all = flattenBoards(b);
  assert.equal(all.length, 5);
  assert.ok(!all.some(o => o.round === 21 && o.cell === 1));
  assert.deepEqual(all.filter(o => o.kind === 'opp').map(o => o.unit).sort(), ['C', 'D']);
});
