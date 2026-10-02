// Warteschlange fuer Uploads nach dem Spiel. Ein Paket bleibt gespeichert, bis
// der Server es angenommen hat — scheitert das Senden (kein Netz, Server weg),
// geht das Spiel nicht mehr verloren, sondern wird spaeter erneut geschickt.
//
// Gespeichert wird der unsignierte Text. Die Signatur haengt an einem
// Zeitstempel im Kopf, den der Server nur fuenf Minuten lang annimmt — deshalb
// wird bei jedem Versuch neu signiert. Doppeltes Senden ist harmlos: der Server
// legt gleiche Beobachtungen nur einmal ab.
//
// Die Logik (flush) ist von IndexedDB getrennt und in outbox.test.ts getestet.

export interface OutboxEntry {
  id: string;
  url: string;
  body: string;
  createdAt: number;
  tries: number;
}

export interface OutboxStore {
  all(): Promise<OutboxEntry[]>;
  put(e: OutboxEntry): Promise<void>;
  del(id: string): Promise<void>;
}

export type SendResult = { status: number } | { error: string };

export const MAX_ENTRIES = 20;
export const MAX_TRIES = 12;
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// 2xx: angenommen. 400/413/422: der Server wird dieses Paket nie annehmen.
// Alles andere (401 bei falscher Uhr, 429, 5xx, kein Netz) lohnt einen neuen Versuch.
export function verdict(r: SendResult): 'done' | 'drop' | 'retry' {
  if ('error' in r) return 'retry';
  if (r.status >= 200 && r.status < 300) return 'done';
  if (r.status === 400 || r.status === 413 || r.status === 422) return 'drop';
  return 'retry';
}

export async function enqueue(store: OutboxStore, entry: OutboxEntry): Promise<void> {
  await store.put(entry);
  // Aelteste Pakete fallen raus, wenn sich zu viele stauen.
  const all = (await store.all()).sort((a, b) => a.createdAt - b.createdAt);
  for (const old of all.slice(0, Math.max(0, all.length - MAX_ENTRIES))) await store.del(old.id);
}

let flushing = false;

/** Sendet alle wartenden Pakete der Reihe nach. Gibt die Zahl der angenommenen zurueck. */
export async function flush(
  store: OutboxStore,
  send: (e: OutboxEntry) => Promise<SendResult>,
  now = Date.now(),
): Promise<{ sent: number; dropped: number; left: number }> {
  const out = { sent: 0, dropped: 0, left: 0 };
  if (flushing) return out;
  flushing = true;
  try {
    const all = (await store.all()).sort((a, b) => a.createdAt - b.createdAt);
    for (const e of all) {
      if (now - e.createdAt > MAX_AGE_MS || e.tries >= MAX_TRIES) {
        await store.del(e.id);
        out.dropped++;
        continue;
      }
      const v = verdict(await send(e));
      if (v === 'done') {
        await store.del(e.id);
        out.sent++;
      } else if (v === 'drop') {
        await store.del(e.id);
        out.dropped++;
      } else {
        await store.put({ ...e, tries: e.tries + 1 });
        out.left++;
      }
    }
  } finally {
    flushing = false;
  }
  return out;
}

// ---------- IndexedDB ----------

const DB_NAME = 'ms-outbox';
const STORE = 'entries';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

export const idbStore: OutboxStore = {
  all: () => run('readonly', s => s.getAll() as IDBRequest<OutboxEntry[]>),
  put: e => run('readwrite', s => s.put(e)).then(() => undefined),
  del: id => run('readwrite', s => s.delete(id)).then(() => undefined),
};
