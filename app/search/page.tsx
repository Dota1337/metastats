import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { searchExactNames } from '../lib/tft-player-search-server';
import { lolProfileHref } from '../lib/tft-player-search';
import LolSearchResults from './LolSearchResults';

// /search?q=Faker — Enter in der LoL-Suche (Nav, Startseite) ohne Tag.
//
// Spiegel von /tft/search: das Namensverzeichnis gilt fuer beide Spiele.
// Genau ein Konto mit diesem Namen: direkt zum Profil. Mehrere: Liste mit Tag
// und Server. Keins: die Client-Komponente zeigt Konten, deren Name mit der
// Eingabe beginnt. Bewusst ohne Riot-Probe ueber Standard-Tags — der LoL-
// Schluessel ist knapp, und die Spielerseite findet den Server selbst.

export const metadata: Metadata = {
  title: 'Spielersuche · metastats.gg',
  robots: { index: false },
};

const MAX_QUERY = 40;

export default async function LolSearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw || '').slice(0, MAX_QUERY).trim();

  // Mit Tag ist der Spieler eindeutig — direkt aufs Profil.
  const hash = q.indexOf('#');
  if (hash >= 0 && q.slice(hash + 1).trim()) {
    const name = q.slice(0, hash).trim();
    const tag = q.slice(hash + 1).trim();
    if (name) redirect(`/player/${encodeURIComponent(name)}--${encodeURIComponent(tag)}`);
  }
  const name = (hash >= 0 ? q.slice(0, hash) : q).trim();

  // null = Verzeichnis nicht erreichbar; dann versucht es die Seite selbst
  // noch einmal und zeigt bei erneutem Fehler den Fehlerhinweis.
  const hits = name ? await searchExactNames(name) : [];
  if (hits && hits.length === 1) redirect(lolProfileHref(hits[0]));

  return <LolSearchResults q={name} initialHits={hits || []} />;
}
