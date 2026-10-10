// Kleiner DOM-Baukasten statt Framework: die Overlays muessen schnell und klein bleiben.
import type { CompanionComp, CompanionLevelling, CompanionLookups } from '../../../../app/lib/companion-types.ts';
import { t, lang } from './i18n.ts';

type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | EventListener | null | undefined> = {},
  ...children: Array<Child | Child[]>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function clear(el: Element, ...children: Array<Child | Child[]>): void {
  el.replaceChildren();
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

const COST_CLASS = ['', 'c1', 'c2', 'c3', 'c4', 'c5'];

// stars: gesehener Stern einer Unit (Gegner-Overlay), ab 2 Sternen angezeigt.
export function unitIcon(id: string, lookups: CompanionLookups | null, opts: { star3?: boolean; stars?: number; items?: string[]; size?: 'xs' | 'sm' | 'md' } = {}): HTMLElement {
  const c = lookups?.champions[id];
  const name = c?.name || id.replace(/^(?:TFT\d*|DA)_(?:\d+_)?/, '');
  const stars = opts.star3 ? 3 : Math.min(opts.stars ?? 0, 4);
  return h('div', { class: `unit ${opts.size || 'md'} ${COST_CLASS[c?.cost ?? 0] || ''}`, title: name },
    c?.icon ? h('img', { src: c.icon, alt: name, loading: 'lazy' }) : h('span', { class: 'unit-fallback' }, name.slice(0, 3)),
    stars >= 2 ? h('span', { class: `star3 s${stars}` }, '★'.repeat(stars)) : null,
    opts.items?.length
      ? h('div', { class: 'unit-items' }, opts.items.map(it => itemIcon(it, lookups, 'xs')))
      : null,
  );
}

export function itemIcon(id: string, lookups: CompanionLookups | null, size: 'xs' | 'sm' | 'md' = 'sm'): HTMLElement {
  const it = lookups?.items[id];
  const name = it?.name || id.replace(/^(?:TFT\d*|DA)_(?:Item_|Component_)?/, '');
  return it?.icon
    ? h('img', { class: `item ${size}`, src: it.icon, alt: name, title: name, loading: 'lazy' })
    : h('span', { class: `item ${size} item-fallback`, title: name }, name.slice(0, 2));
}

export function tierBadge(tier: string | null): HTMLElement {
  return h('span', { class: `tier tier-${(tier || 'none').toLowerCase()}` }, tier || '—');
}

// Stufen-Reiter wie bei MetaTFT: „Stufe N", darunter klein der Anteil der
// Spiele, die auf dieser Stufe enden, mit einer Nachkommastelle wie auf der
// Homepage (fehlt er, entfaellt die Zeile).
export function levelTabs(levels: number[], active: number | null, shareOf: ((l: number) => number | null | undefined) | null, onPick: (l: number) => void): HTMLElement {
  return h('div', { class: 'lvl-tabs', role: 'tablist' }, levels.map(l => {
    const share = shareOf?.(l);
    return h('button', { class: l === active ? 'lvl-tab active' : 'lvl-tab', role: 'tab', 'aria-selected': l === active ? 'true' : 'false', onclick: () => onPick(l) },
      h('span', {}, `${t('tools.level')} ${l}`),
      share != null ? h('span', { class: 'lvl-tab-share' }, share.toLocaleString(lang(), { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })) : null,
    );
  }));
}

// Levelplan in Worten, dieselben Texte wie auf der Homepage.
export function levellingText(l: CompanionLevelling): string {
  return l.kind === 'standard' ? t('levelling.standard') : t(`levelling.${l.kind}`, { n: l.level });
}

export function fmtAvg(v: number | null): string {
  return v == null ? '—' : v.toFixed(2);
}

export function fmtPct(v: number | null): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
}

export function compUnits(comp: CompanionComp, lookups: CompanionLookups | null, size: 'sm' | 'md' = 'md'): HTMLElement {
  return h('div', { class: 'units' }, comp.units.map(u => unitIcon(u.id, lookups, { star3: !!u.star3, items: u.items, size })));
}
