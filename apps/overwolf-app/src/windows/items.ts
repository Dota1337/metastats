// Item-Leiste: Hinweis ueber jeder Karte einer Item-Auswahl im Spiel
// (match_info.item_select). Durchklickbar, unten mittig wie bei MetaTFT
// (placement.ts ITEMS_SIZE). Die Regeln stehen in lib/item-advice.ts; ohne
// Hinweis bleibt die Karte frei. Liest nur aus dem gemeinsamen Speicher.
import '../styles/app.css';
import { read, subscribe } from '../lib/store.ts';
import { t } from '../lib/i18n.ts';
import { boot } from '../lib/boot.ts';
import { adviseOffer, type ItemHint } from '../lib/item-advice.ts';
import { h, clear, itemIcon, unitIcon } from '../lib/dom.ts';
import type { CompanionLookups } from '../../../../app/lib/companion-types.ts';

const root = document.getElementById('app')!;

function hintView(hint: ItemHint, lk: CompanionLookups | null): HTMLElement {
  if (hint.kind === 'rank') {
    return h('div', { class: hint.best ? 'item-hint best' : 'item-hint' },
      hint.best ? h('b', {}, t('items.best')) : h('span', {}, `#${hint.rank}`),
      h('span', { class: 'muted' }, `Ø ${hint.avg.toFixed(2)}`),
    );
  }
  const name = lk?.items[hint.item]?.name ?? hint.item;
  return h('div', { class: 'item-hint pin' },
    hint.via === 'recipe' || hint.via === 'radiant' ? itemIcon(hint.item, lk, 'sm') : null,
    hint.via === 'recipe' ? h('span', {}, t('items.for', { item: name })) : null,
    hint.unit ? unitIcon(hint.unit, lk, { size: 'xs' }) : h('span', {}, t('items.trait')),
  );
}

function render(): void {
  const item = read('ms.item');
  if (!item?.offer.length || !read('ms.settings').items) { clear(root); return; }
  const lk = read('ms.lookups')?.data ?? null;
  const stats = new Map((read('ms.itemStats')?.data.items ?? []).map(i => [i.id, { games: i.games, avg: i.avg }]));
  const hints = adviseOffer(item.offer, lk, read('ms.pin'), stats);
  if (hints.every(x => !x)) { clear(root); return; }
  clear(root, h('div', { class: 'items-row' }, item.offer.map((_, i) => {
    const hint = hints[i];
    return h('div', { class: 'items-box' }, hint ? hintView(hint, lk) : null);
  })));
}

void boot(render);
subscribe(['ms.item', 'ms.pin', 'ms.lookups', 'ms.itemStats', 'ms.settings'], render);
