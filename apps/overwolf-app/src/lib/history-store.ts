// Eigene Spiele mit den Brettern je Runde, nur auf diesem Rechner (IndexedDB),
// die letzten 20. Der Spielverlauf zeigt damit bei eigenen Spielen die
// Aufstellung Runde fuer Runde. Getrennt von ms-outbox: die Warteschlange
// loescht nach dem Senden, das hier bleibt.
import type { LocalMatch } from './boards.ts';

const DB_NAME = 'ms-match-boards';
const STORE = 'matches';
export const KEEP = 20;

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

export function localMatches(): Promise<LocalMatch[]> {
  return run('readonly', s => s.getAll() as IDBRequest<LocalMatch[]>)
    .then(l => l.sort((a, b) => b.endedAt - a.endedAt))
    .catch(() => []);
}

export async function saveLocalMatch(m: LocalMatch): Promise<void> {
  await run('readwrite', s => s.put(m));
  const all = await localMatches();
  for (const old of all.slice(KEEP)) await run('readwrite', s => s.delete(old.id));
}
