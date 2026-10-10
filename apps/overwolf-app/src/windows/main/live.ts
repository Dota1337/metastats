// Live-Spalte rechts im Hauptfenster: eigenes Profil (Rang, letzte
// Platzierungen, letzte Bretter). Laedt das Hintergrundfenster beim Start und
// nach jedem Spiel (ms.profile); ohne Profil bleibt die Spalte weg.
import { read } from '../../lib/store.ts';
import { t } from '../../lib/i18n.ts';
import { rankLong, placeChips } from '../../lib/track-view.ts';
import { h, unitIcon } from '../../lib/dom.ts';
import { lookups } from './ctx.ts';

export function liveColumn(onOpen: (name: string) => void): HTMLElement | null {
  const p = read('ms.profile');
  if (!p) return null;
  const d = p.data;
  const lk = lookups();
  const places = d.matches.map(m => m.placement);
  const avg = places.length ? places.reduce((a, b) => a + b, 0) / places.length : null;
  const ranked = d.ranked?.tier ? { tier: d.ranked.tier, division: d.ranked.rank, lp: d.ranked.lp } : null;
  return h('aside', { class: 'live-col' },
    h('button', { class: 'card live-head', onclick: () => onOpen(p.name) },
      d.player.icon != null ? h('img', { class: 'avatar', src: `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${d.player.icon}.jpg`, alt: '' }) : null,
      h('div', { class: 'live-who' },
        h('div', { class: 'player-name' }, d.player.name.split('#')[0]),
        h('div', { class: 'muted' }, rankLong(ranked) ?? t('profile.unranked')),
      ),
    ),
    places.length ? h('div', { class: 'card' },
      h('h3', {}, t('live.recent')),
      placeChips(places),
      avg != null ? h('div', { class: 'stat-line live-avg' }, t('live.avg'), h('b', {}, avg.toFixed(2))) : null,
    ) : null,
    d.matches.slice(0, 4).map(m => h('div', { class: `card live-match ${m.placement <= 4 ? 'top' : 'bot'}` },
      h('span', { class: 'match-place' }, `#${m.placement}`),
      h('div', { class: 'units' }, m.units.slice(0, 6).map(u => unitIcon(u.id, lk, { star3: u.star >= 3, size: 'xs' }))),
    )),
  );
}
