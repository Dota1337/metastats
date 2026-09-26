import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { searchExactNames } from '../../lib/tft-player-search-server';
import { tftProfileHref } from '../../lib/tft-player-search';
import TftSearchResults from './TftSearchResults';

// /tft/search?q=Winter — Enter in der Nav-Suche ohne Tag.
//
// Genau ein Konto mit diesem Namen: direkt zum Profil. Mehrere: Liste mit
// Tag, Region und Rang. Keins im Verzeichnis: die Client-Komponente fragt
// Riot ueber die Standard-Tags (/api/tft/search-riot).

export const metadata: Metadata = {
  title: 'TFT Spielersuche · metastats.gg',
  robots: { index: false },
};

const MAX_QUERY = 40;

export default async function TftSearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw || '').slice(0, MAX_QUERY).trim();

  // Mit Tag ist der Spieler eindeutig — wie bisher direkt aufs Profil.
  const hash = q.indexOf('#');
  if (hash >= 0 && q.slice(hash + 1).trim()) {
    const name = q.slice(0, hash).trim();
    const tag = q.slice(hash + 1).trim();
    if (name) redirect(`/tft/player/${encodeURIComponent(name)}--${encodeURIComponent(tag)}`);
  }
  const name = (hash >= 0 ? q.slice(0, hash) : q).trim();

  const hits = name ? await searchExactNames(name) : [];
  if (hits && hits.length === 1) redirect(tftProfileHref(hits[0]));

  return <TftSearchResults q={name} initialHits={hits || []} />;
}
