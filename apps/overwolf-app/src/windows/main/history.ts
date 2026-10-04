// Reiter Match History: Riot-ID-Suche, je Spiel aufklappbar die Lobby mit
// allen 8 Spielern. Bei eigenen Spielen zusaetzlich die Aufstellung Runde fuer
// Runde, die die App waehrend des Spiels auf diesem Rechner gespeichert hat.
import type { CompanionMatch, CompanionPlayerResponse } from '../../../../../app/lib/companion-types.ts';
import { read } from '../../lib/store.ts';
import { t, lang } from '../../lib/i18n.ts';
import { loadPlayer } from '../../lib/api.ts';
import { findLocalMatch, type LocalMatch } from '../../lib/boards.ts';
import { localMatches } from '../../lib/history-store.ts';
import { boardView } from '../../lib/board-view.ts';
import { h, unitIcon } from '../../lib/dom.ts';
import { lookups, rerender } from './ctx.ts';

const ui = {
  name: '',
  data: null as CompanionPlayerResponse | null,
  error: null as string | null,
  loading: false,
  loadingMore: false,
  open: new Set<string>(),
  round: new Map<string, number>(), // Spiel -> gewaehlte Runde
  local: [] as LocalMatch[],
};

async function search(name: string): Promise<void> {
  const n = name.trim();
  if (!n.includes('#')) return;
  Object.assign(ui, { name: n, loading: true, error: null, data: null });
  ui.open.clear();
  rerender();
  try {
    const [data, local] = await Promise.all([loadPlayer(n), localMatches()]);
    ui.data = data;
    ui.local = local;
  } catch (e) {
    ui.error = (e as { status?: number }).status === 404 ? t('profile.notFound') : t('common.offline');
  } finally {
    ui.loading = false;
    rerender();
  }
}

async function more(): Promise<void> {
  const d = ui.data;
  if (!d?.nextStart || ui.loadingMore) return;
  ui.loadingMore = true;
  rerender();
  try {
    const next = await loadPlayer(ui.name, d.nextStart);
    const seen = new Set(d.matches.map(m => m.id));
    ui.data = { ...d, matches: [...d.matches, ...next.matches.filter(m => !seen.has(m.id))], nextStart: next.nextStart ?? null };
  } catch {
    // Knopf bleibt stehen, der naechste Klick versucht es neu.
  } finally {
    ui.loadingMore = false;
    rerender();
  }
}

function isMe(): boolean {
  const me = read('ms.me');
  return !!me && me.toLowerCase() === ui.name.toLowerCase();
}

function stageLabel(round: number): string {
  return `${Math.floor(round / 10)}-${round % 10}`;
}

function myBoard(m: CompanionMatch): HTMLElement | null {
  if (!isMe()) return null;
  const local = findLocalMatch(ui.local, m);
  if (!local || local.rounds.length === 0) return null;
  const lk = lookups();
  const chosen = ui.round.get(m.id) ?? local.rounds[local.rounds.length - 1].round;
  const r = local.rounds.find(x => x.round === chosen) ?? local.rounds[local.rounds.length - 1];
  return h('div', { class: 'card' },
    h('h3', {}, t('history.myBoard')),
    h('div', { class: 'chips' }, local.rounds.map(x =>
      h('button', { class: x.round === r.round ? 'chip active' : 'chip', onclick: (e: Event) => { e.stopPropagation(); ui.round.set(m.id, x.round); rerender(); } }, stageLabel(x.round)),
    )),
    boardView(r.pieces.map(p => ({ cell: p.cell, unit: p.unit, star: p.level, items: p.items })), lk),
  );
}

function matchRow(m: CompanionMatch): HTMLElement {
  const lk = lookups();
  const open = ui.open.has(m.id);
  const me = ui.data?.player.puuid;
  const toggle = () => { if (open) ui.open.delete(m.id); else ui.open.add(m.id); rerender(); };
  return h('div', {},
    h('div', { class: `match place-${m.placement <= 4 ? 'top' : 'bot'}`, onclick: toggle },
      h('div', { class: 'match-place' }, `#${m.placement}`),
      h('div', { class: 'match-meta muted' },
        new Date(m.at).toLocaleString(lang(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
        m.level != null ? ` · ${t('tools.level')} ${m.level}` : ''),
      h('div', { class: 'units' }, m.units.map(u => unitIcon(u.id, lk, { star3: u.star >= 3, items: u.items, size: 'md' }))),
    ),
    open ? h('div', { class: 'match-body' },
      myBoard(m),
      m.lobby?.length ? h('div', { class: 'card' },
        h('h3', {}, t('history.lobby')),
        m.lobby.map(p => h('div', { class: p.puuid === me ? 'lobby-row me' : 'lobby-row' },
          h('div', { class: 'match-place' }, `#${p.placement}`),
          h('div', { class: 'lobby-name' }, p.name ?? '—', p.level != null ? h('span', { class: 'muted' }, ` · ${t('tools.level')} ${p.level}`) : null),
          h('div', { class: 'units' }, p.units.map(u => unitIcon(u.id, lk, { star3: u.star >= 3, items: u.items, size: 'sm' }))),
        )),
      ) : null,
    ) : null,
  );
}

export function historyTab(): HTMLElement {
  const me = read('ms.me');
  const input = h('input', { class: 'search', type: 'search', placeholder: t('profile.placeholder'), value: ui.name || me || '' });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') void search(input.value); });
  const p = ui.data;
  return h('section', { class: 'panel' },
    h('div', { class: 'toolbar' },
      input,
      h('button', { class: 'btn primary', onclick: () => void search(input.value) }, t('profile.search')),
      me && me !== ui.name ? h('button', { class: 'btn ghost', onclick: () => void search(me) }, t('profile.me')) : null,
    ),
    ui.loading ? h('div', { class: 'spinner' }) : null,
    ui.error ? h('div', { class: 'empty' }, ui.error) : null,
    p && !ui.loading ? h('div', { class: 'profile' },
      h('div', { class: 'card profile-head' },
        p.player.icon != null ? h('img', { class: 'avatar', src: `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${p.player.icon}.jpg`, alt: '' }) : null,
        h('div', {},
          h('div', { class: 'player-name' }, p.player.name),
          h('div', { class: 'muted' },
            p.ranked?.tier
              ? `${p.ranked.tier[0]}${p.ranked.tier.slice(1).toLowerCase()} ${p.ranked.rank ?? ''} · ${p.ranked.lp ?? 0} LP · ${p.ranked.wins}–${p.ranked.losses}`
              : t('profile.unranked'),
          ),
        ),
      ),
      h('div', { class: 'matches' }, p.matches.map(matchRow)),
      p.nextStart
        ? h('button', { class: 'btn more', disabled: ui.loadingMore, onclick: () => void more() }, ui.loadingMore ? '…' : t('history.more'))
        : null,
    ) : null,
  );
}
