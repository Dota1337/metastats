// Gemeinsame Bausteine der Spielersuche fuer Nav-Dropdown, /tft/search und
// /search (LoL). Das Namensverzeichnis tft_player_names gilt fuer beide Spiele:
// Riot-ID und Server sind dieselben, nur die puuid ist je Schluessel verschieden.
// Bewusst ohne Server-Importe: Nav.tsx ist eine Client-Komponente, die
// Datenbank- und Riot-Abfragen liegen in tft-player-search-server.ts.

import { REGIONS } from './regions';

export interface TftAccountHit {
  puuid: string;
  gameName: string;
  tagLine: string;
  /** Plattform-Region (euw1, kr, ...); null, wenn Riot sie nicht verraten hat. */
  region: string | null;
  tier: string | null;
  division: string | null;
  lp: number | null;
}

export const APEX_TIERS = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);

/** Profil-Link. Ohne Region sucht die Profilseite den Server selbst. */
export function tftProfileHref(h: Pick<TftAccountHit, 'puuid' | 'gameName' | 'tagLine' | 'region'>): string {
  const slug = `${encodeURIComponent(h.gameName)}--${encodeURIComponent(h.tagLine)}`;
  const qs = new URLSearchParams();
  if (h.region) qs.set('region', h.region);
  qs.set('puuid', h.puuid);
  return `/tft/player/${slug}?${qs.toString()}`;
}

/** LoL-Profil zu einem Treffer aus dem Namensverzeichnis. Ohne puuid (die
 *  passt nicht zum LoL-Schluessel); ohne Server springt die Spielerseite selbst. */
export function lolProfileHref(h: Pick<TftAccountHit, 'gameName' | 'tagLine' | 'region'>): string {
  const slug = `${encodeURIComponent(h.gameName)}--${encodeURIComponent(h.tagLine)}`;
  return h.region ? `/player/${slug}?region=${encodeURIComponent(h.region)}` : `/player/${slug}`;
}

export function tftRegionLabel(region: string | null): string {
  if (!region) return '';
  return REGIONS.find(r => r.value === region)?.label || region.toUpperCase();
}

/** "Challenger 1234 LP" / "Diamond II"; leer ohne frischen Rang. */
export function tftRankLabel(h: Pick<TftAccountHit, 'tier' | 'division' | 'lp'>, tierName: (lowerTier: string) => string): string {
  if (!h.tier) return '';
  const name = tierName(h.tier.toLowerCase());
  if (APEX_TIERS.has(h.tier)) return h.lp != null ? `${name} ${h.lp} LP` : name;
  return h.division ? `${name} ${h.division}` : name;
}
