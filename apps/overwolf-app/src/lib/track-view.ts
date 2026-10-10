// Gemeinsame Anzeige-Bausteine fuer Gegner-Tracker und Mitspieler (Gegner-
// Overlay und Reiter „Im Spiel“).
import type { CompanionLobbyEntry } from '../../../../app/lib/companion-types.ts';
import type { TrackRow } from './tracker.ts';
import { t } from './i18n.ts';
import { h } from './dom.ts';

export function trackLabel(r: TrackRow): HTMLElement {
  if (r.status === 'now') return h('span', { class: 'track now' }, t('track.now'));
  if (r.status === 'never') return h('span', { class: 'track never' }, t('track.never'));
  const text = t('track.ago', { n: r.roundsAgo ?? 0 });
  return r.status === 'unlikely'
    ? h('span', { class: 'track unlikely', title: t('track.unlikely') }, text)
    : h('span', { class: 'track ago' }, text);
}

const TIER_SHORT: Record<string, string> = {
  CHALLENGER: 'C', GRANDMASTER: 'GM', MASTER: 'M', DIAMOND: 'D', EMERALD: 'E',
  PLATINUM: 'P', GOLD: 'G', SILVER: 'S', BRONZE: 'B', IRON: 'I',
};
const ROMAN: Record<string, string> = { I: '1', II: '2', III: '3', IV: '4' };
const APEX = new Set(['CHALLENGER', 'GRANDMASTER', 'MASTER']);

export const isApex = (tier: string): boolean => APEX.has(tier.toUpperCase());

// Rangname in der App-Sprache (DE/EN wie im Spiel, sonst uebersetzt).
export function tierName(tier: string): string {
  const k = tier.toUpperCase();
  return TIER_SHORT[k] ? t(`tier.${k.toLowerCase()}` as Parameters<typeof t>[0]) : k[0] + k.slice(1).toLowerCase();
}

// Kurz fuers Overlay: „D2“, „M 120 LP“. Lang fuer das Hauptfenster: „Diamond II“.
export function rankShort(e: Pick<CompanionLobbyEntry, 'tier' | 'division' | 'lp'> | null | undefined): string | null {
  if (!e?.tier) return null;
  const tier = e.tier.toUpperCase();
  const s = TIER_SHORT[tier] ?? tier.slice(0, 1);
  return APEX.has(tier) ? `${s} ${e.lp ?? 0} LP` : `${s}${ROMAN[e.division ?? ''] ?? ''}`;
}

export function rankLong(e: Pick<CompanionLobbyEntry, 'tier' | 'division' | 'lp'> | null | undefined): string | null {
  if (!e?.tier) return null;
  const name = tierName(e.tier);
  return isApex(e.tier) ? `${name} · ${e.lp ?? 0} LP` : `${name} ${e.division ?? ''}`.trim();
}

// Platzierungen als kleine farbige Kaestchen (1 gold, 2-4 gruen, 5-8 rot).
export function placeChips(places: number[], max = 10): HTMLElement {
  return h('span', { class: 'place-chips' }, places.slice(0, max).map(p =>
    h('span', { class: `place-chip ${p === 1 ? 'win' : p <= 4 ? 'top' : 'bot'}` }, String(p))));
}
