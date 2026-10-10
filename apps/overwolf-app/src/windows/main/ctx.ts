// Gemeinsamer Zustand der Reiter im Hauptfenster. Jeder Reiter zeichnet sich
// komplett neu ueber rerender(); Daten aus dem Netz landen hier, damit ein
// Reiterwechsel nichts neu laedt.
import type { CompanionComp, CompanionLookups } from '../../../../../app/lib/companion-types.ts';
import { read } from '../../lib/store.ts';
import { t } from '../../lib/i18n.ts';
import { h } from '../../lib/dom.ts';

export type Tab = 'ingame' | 'comps' | 'units' | 'items' | 'early' | 'history' | 'settings';
// „Im Spiel“ steht nur waehrend einer TFT-Partie in der Seitenleiste.
export const TABS: Tab[] = ['ingame', 'comps', 'units', 'items', 'early', 'history', 'settings'];

// Dasselbe Fenster laeuft auch als main_overlay ueber dem Spiel; dort laedt es
// nie selbst (das Hintergrundfenster haelt ms.comps/ms.lookups aktuell).
export const IS_OVERLAY = document.body.dataset.window === 'main_overlay';

export const nav = {
  tab: 'comps' as Tab,
  compKey: null as string | null,   // offene Comp-Detailansicht
  unitId: null as string | null,
  itemId: null as string | null,
  earlyKey: null as string | null,  // gewaehlte Comp im Early-Reiter, null = angeheftete
};

let renderFn: () => void = () => {};
export function setRender(fn: () => void): void { renderFn = fn; }
export function rerender(): void { renderFn(); }

export function go(tab: Tab, p: Partial<Omit<typeof nav, 'tab'>> = {}): void {
  nav.tab = tab;
  Object.assign(nav, p);
  rerender();
  document.querySelector('.content')?.scrollTo(0, 0);
}

export function lookups(): CompanionLookups | null {
  return read('ms.lookups')?.data ?? null;
}

export function comps(): CompanionComp[] {
  return read('ms.comps')?.data.comps ?? [];
}

export function unitName(id: string, lk: CompanionLookups | null): string {
  return lk?.champions[id]?.name || id.replace(/^(?:TFT\d*|DA)_(?:\d+_)?/, '').replace(/\d+$/, '');
}

export function itemName(id: string, lk: CompanionLookups | null): string {
  return lk?.items[id]?.name || id.replace(/^(?:TFT\d*|DA)_(?:Item_|Component_)?/, '');
}

export function backBtn(onclick: () => void): HTMLElement {
  return h('button', { class: 'btn ghost', onclick }, '← ', t('common.back'));
}

// Abruf mit Ladezustand: Ergebnis wird je Schluessel gemerkt, der Reiter
// zeichnet bei Ankunft neu. Fehler bleiben stehen, bis neu versucht wird.
type Slot<T> = { state: 'loading' } | { state: 'ok'; data: T } | { state: 'error'; status: number | null };
const slots = new Map<string, Slot<unknown>>();

export function fetchSlot<T>(key: string, load: () => Promise<T>): Slot<T> {
  const s = slots.get(key) as Slot<T> | undefined;
  if (s) return s;
  slots.set(key, { state: 'loading' });
  load().then(
    data => { slots.set(key, { state: 'ok', data }); rerender(); },
    e => { slots.set(key, { state: 'error', status: (e as { status?: number }).status ?? null }); rerender(); },
  );
  return { state: 'loading' };
}

export function retrySlot(key: string): void {
  slots.delete(key);
  rerender();
}

export function slotFallback(key: string, s: Slot<unknown>): HTMLElement {
  if (s.state === 'loading') return h('div', { class: 'spinner' });
  return h('div', { class: 'empty' },
    s.state === 'error' && s.status === 404 ? t('common.noData') : t('common.offline'), ' ',
    h('button', { class: 'btn', onclick: () => retrySlot(key) }, t('common.retry')),
  );
}

export function sortHead(label: string, key: string, current: string, onSort: (k: string) => void): HTMLElement {
  return h('th', { class: key === current ? 'sortable sorted' : 'sortable', onclick: () => onSort(key) }, label, key === current ? ' ▾' : '');
}
