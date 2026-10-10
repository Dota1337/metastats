// Reiter „Im Spiel“: alle Mitspieler der laufenden Partie — Leben, wann man
// zuletzt gegen sie gekaempft hat, Rang und letzte Platzierungen aus unserer
// Datenbank. Was sie spielen, zeigt die App seit 0.8.3 nicht mehr (Riot-Regeln).
// Nur sichtbar waehrend einer TFT-Partie.
import { read } from '../../lib/store.ts';
import { t } from '../../lib/i18n.ts';
import { trackRows } from '../../lib/tracker.ts';
import { trackLabel, rankLong, placeChips } from '../../lib/track-view.ts';
import { h } from '../../lib/dom.ts';

export function ingameTab(): HTMLElement {
  const live = read('ms.live');
  const { rows } = trackRows({
    pvp: live.pvp, roster: live.roster, stage: live.stage, roundKind: live.roundKind,
    queueId: live.queueId, me: read('ms.me'),
  });
  const lobby = read('ms.lobby')?.players ?? {};
  const sorted = [...rows].sort((a, b) => (a.dead === b.dead ? (b.hp ?? -1) - (a.hp ?? -1) : a.dead ? 1 : -1));

  return h('section', { class: 'panel' },
    h('div', { class: 'card' },
      h('div', { class: 'ingame-head' },
        h('h3', {}, t('tab.ingame')),
        live.stage ? h('span', { class: 'muted' }, live.stage) : null,
      ),
      h('table', { class: 'table ingame' },
        h('thead', {}, h('tr', {},
          h('th', {}, t('ingame.player')),
          h('th', {}, t('ingame.hp')),
          h('th', {}, t('ingame.fought')),
          h('th', {}, t('ingame.rank')),
          h('th', {}, t('live.recent')),
        )),
        h('tbody', {}, sorted.map(r => {
          const lp = lobby[r.name];
          return h('tr', { class: r.dead ? 'dead' : r.status === 'now' ? 'next' : '' },
            h('td', {}, h('span', { class: 'lobby-name', title: r.name }, r.name.split('#')[0])),
            h('td', {}, r.hp != null ? String(r.hp) : '—'),
            h('td', {}, trackLabel(r)),
            h('td', {}, rankLong(lp) ?? '—'),
            h('td', {}, lp?.recent.length ? placeChips(lp.recent) : '—'),
          );
        })),
      ),
    ),
  );
}
