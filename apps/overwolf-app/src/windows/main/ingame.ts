// Reiter „Im Spiel“: alle Mitspieler der laufenden Partie — Leben, wann man
// zuletzt gegen sie gekaempft hat, Rang und letzte Platzierungen aus unserer
// Datenbank, erkannte Comp. Nur sichtbar waehrend einer TFT-Partie.
import { read } from '../../lib/store.ts';
import { t } from '../../lib/i18n.ts';
import { trackRows } from '../../lib/tracker.ts';
import { opponentRows } from '../../lib/opponents.ts';
import { traitLabel } from '../../lib/plan.ts';
import { trackLabel, rankLong, placeChips } from '../../lib/track-view.ts';
import { h, unitIcon, tierBadge } from '../../lib/dom.ts';
import { lookups, comps, unitName } from './ctx.ts';

export function ingameTab(): HTMLElement {
  const live = read('ms.live');
  const lk = lookups();
  const { rows } = trackRows({
    pvp: live.pvp, roster: live.roster, stage: live.stage, roundKind: live.roundKind,
    queueId: live.queueId, me: read('ms.me'),
  });
  const recs = new Map(opponentRows(live, comps()).map(r => [r.name, r]));
  const lobby = read('ms.lobby')?.players ?? {};
  // Nur echte Champions, hoechstens 3 (der Server liefert bis 5).
  const carriesOf = (e: { carries: Array<{ unit: string }> }) => e.carries.filter(c => !lk || lk.champions[c.unit]).slice(0, 3);
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
          h('th', {}, t('ingame.comp')),
        )),
        h('tbody', {}, sorted.map(r => {
          const lp = lobby[r.name];
          const rec = recs.get(r.name)?.rec;
          return h('tr', { class: r.dead ? 'dead' : r.status === 'now' ? 'next' : '' },
            h('td', {}, h('span', { class: 'lobby-name', title: r.name }, r.name.split('#')[0])),
            h('td', {}, r.hp != null ? String(r.hp) : '—'),
            h('td', {}, trackLabel(r)),
            h('td', {}, rankLong(lp) ?? '—'),
            h('td', {}, lp?.recent.length ? placeChips(lp.recent) : '—'),
            h('td', {}, rec
              ? h('div', { class: 'name-cell' },
                rec.carries.map(c => unitIcon(c.unit, lk, { stars: c.level, size: 'xs' })),
                h('span', { class: rec.kind === 'sure' ? '' : 'muted' }, rec.kind === 'sure' ? traitLabel(rec.comp) : rec.label),
                rec.kind === 'sure' ? tierBadge(rec.comp.tier) : null)
              : lp && carriesOf(lp).length
                ? h('div', { class: 'name-cell muted' }, carriesOf(lp).map(c => unitIcon(c.unit, lk, { size: 'xs' })), carriesOf(lp).map(c => unitName(c.unit, lk)).join(', '))
                : '—'),
          );
        })),
      ),
    ),
  );
}
