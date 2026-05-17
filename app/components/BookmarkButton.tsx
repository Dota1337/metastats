'use client';
import { useEffect, useState } from 'react';
import { isBookmarked, toggleBookmark, type BookmarkType } from '../lib/bookmarks';

// Small star toggle to favourite a comp or player. Local-only (localStorage)
// so it works without any auth. Renders nothing during SSR — bookmark state
// only exists in the browser, and we don't want hydration mismatches.

interface Props {
  type: BookmarkType;
  bookmarkKey: string;
  label: string;
  region?: string;
  size?: 'sm' | 'md';
  /** Use when nested inside an <a> — prevents navigation on click */
  stopPropagation?: boolean;
}

export default function BookmarkButton({
  type, bookmarkKey, label, region, size = 'md', stopPropagation = true,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    setMounted(true);
    setActive(isBookmarked(type, bookmarkKey, region));
    const onChange = () => setActive(isBookmarked(type, bookmarkKey, region));
    window.addEventListener('metastats:bookmarks:change', onChange);
    return () => window.removeEventListener('metastats:bookmarks:change', onChange);
  }, [type, bookmarkKey, region]);

  if (!mounted) return null;

  const dim = size === 'sm' ? 'w-5 h-5 text-[12px]' : 'w-6 h-6 text-sm';

  return (
    <button
      type="button"
      onClick={e => {
        if (stopPropagation) {
          e.preventDefault();
          e.stopPropagation();
        }
        const nowActive = toggleBookmark({ type, key: bookmarkKey, label, region });
        setActive(nowActive);
      }}
      title={active ? 'Bookmark entfernen' : 'Bookmarken'}
      aria-label={active ? 'Bookmark entfernen' : 'Bookmarken'}
      aria-pressed={active}
      className={`flex items-center justify-center rounded-full ${dim} transition-colors ${
        active
          ? 'text-[#f0c040] hover:text-[#f5d875]'
          : 'text-[#5a6a80] hover:text-[#a0b0c5]'
      }`}
    >
      {active ? '★' : '☆'}
    </button>
  );
}
