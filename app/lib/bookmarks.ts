// Lightweight localStorage-backed bookmark system for comps and players.
// Pros want to flag "this is my comp" / "this is my smurf" / "this is my
// rival" without an auth wall. Stays local-only — no server roundtrip,
// no GDPR surface, no sign-up friction. Auth-backed cross-device sync
// can layer on top later (Supabase row keyed on the same composite key).

export type BookmarkType = 'comp' | 'player';

export interface Bookmark {
  type: BookmarkType;
  /** Stable key per item — comp slug or player puuid */
  key: string;
  /** Human-readable label for the saved-list view */
  label: string;
  /** Region for player bookmarks — comps stay region-agnostic */
  region?: string;
  /** Unix ms, used to sort newest first in the saved view */
  addedAt: number;
}

const STORAGE_KEY = 'metastats:bookmarks:v1';

function read(): Bookmark[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(list: Bookmark[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    window.dispatchEvent(new Event('metastats:bookmarks:change'));
  } catch {
    // localStorage quota or disabled — silent no-op, the UI still works
    // for the rest of the session, it just doesn't persist.
  }
}

function compositeKey(type: BookmarkType, key: string, region?: string): string {
  return type === 'player' ? `${type}:${region || 'euw1'}:${key}` : `${type}:${key}`;
}

export function listBookmarks(type?: BookmarkType): Bookmark[] {
  const all = read();
  const filtered = type ? all.filter(b => b.type === type) : all;
  return [...filtered].sort((a, b) => b.addedAt - a.addedAt);
}

export function isBookmarked(type: BookmarkType, key: string, region?: string): boolean {
  const target = compositeKey(type, key, region);
  return read().some(b => compositeKey(b.type, b.key, b.region) === target);
}

export function toggleBookmark(input: Omit<Bookmark, 'addedAt'>): boolean {
  const all = read();
  const target = compositeKey(input.type, input.key, input.region);
  const without = all.filter(b => compositeKey(b.type, b.key, b.region) !== target);
  if (without.length !== all.length) {
    write(without);
    return false;
  }
  write([...all, { ...input, addedAt: Date.now() }]);
  return true;
}

export function removeBookmark(type: BookmarkType, key: string, region?: string): void {
  const all = read();
  const target = compositeKey(type, key, region);
  write(all.filter(b => compositeKey(b.type, b.key, b.region) !== target));
}
