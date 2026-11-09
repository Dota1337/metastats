import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { searchExactNames } from '../lib/tft-player-search-server';
import { searchLolExact } from '../lib/lol-player-search-server';
import { lolProfileHref, mergeLolHits } from '../lib/tft-player-search';
import LolSearchResults from './LolSearchResults';
import { getServerPathLang } from '../lib/server-lang';
import { withLangPrefix } from '../lib/lang-path';

// /search?q=Faker — Enter in der LoL-Suche (Nav, Startseite) ohne Tag.
//
// Spiegel von /tft/search. Quellen: LoL-Verzeichnis (aufgerufene LoL-Profile,
// 0122) und TFT-Verzeichnis (Riot-ID und Server sind spieluebergreifend).
// Genau ein Konto mit diesem Namen: direkt zum Profil. Mehrere: Liste mit Tag
// und Server. Keins: die Client-Komponente fragt Riot ueber die Standard-Tags
// (mit dem TFT-Schluessel, User-Entscheid 09.11.2026) und zeigt sonst Konten,
// deren Name mit der Eingabe beginnt.

export const metadata: Metadata = {
  title: 'Spielersuche · metastats.gg',
  robots: { index: false },
};

const MAX_QUERY = 40;

export default async function LolSearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const raw = (await searchParams).q;
  // Sprach-Adresse (/en/search) bleibt beim Sprung aufs Profil erhalten.
  const pathLang = await getServerPathLang();
  const q = (Array.isArray(raw) ? raw[0] : raw || '').slice(0, MAX_QUERY).trim();

  // Mit Tag ist der Spieler eindeutig — direkt aufs Profil.
  const hash = q.indexOf('#');
  if (hash >= 0 && q.slice(hash + 1).trim()) {
    const name = q.slice(0, hash).trim();
    const tag = q.slice(hash + 1).trim();
    if (name) redirect(withLangPrefix(pathLang, `/player/${encodeURIComponent(name)}--${encodeURIComponent(tag)}`));
  }
  const name = (hash >= 0 ? q.slice(0, hash) : q).trim();

  // null = Verzeichnis nicht erreichbar; dann versucht es die Seite selbst
  // noch einmal und zeigt bei erneutem Fehler den Fehlerhinweis. Ohne puuid
  // an die Seite (mergeLolHits): die des TFT-Verzeichnisses passt nicht zu LoL.
  const [lol, tft] = name ? await Promise.all([searchLolExact(name), searchExactNames(name)]) : [[], []];
  const hits = mergeLolHits(lol || [], tft || [], 50);
  if (hits.length === 1) redirect(withLangPrefix(pathLang, lolProfileHref(hits[0])));

  return <LolSearchResults q={name} initialHits={hits} />;
}
