'use client';
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ExplorerQuery } from '../../../lib/tft-explorer-query';
import { moveFilter, type DragSrc, type DropTarget, type Fits } from './explorer-move';

// Ziehen & Ablegen der gewaehlten Bausteine (Plan 24.10.2026, W3). Eigene
// Zeiger-Logik statt HTML5-Ziehen, das es auf dem Handy nicht gibt: Maus ab
// 4 px Weg, Finger nach 300 ms Halten (vorher bewegt = Wischen, die Seite
// scrollt weiter). Ziel ist das naechste [data-drop] unter dem Zeiger;
// hervorgehoben nur, wenn moveFilter die Ablage annimmt. Escape bricht ab.
// Die Anfrage aendert sich erst beim Loslassen, mit einem setQuery.

const MOUSE_SLOP = 4;
const TOUCH_HOLD_MS = 300;
const TOUCH_SLOP = 8;

const dropKey = (t: DropTarget) => JSON.stringify(t);

function targetAt(x: number, y: number): { key: string; t: DropTarget } | null {
  const key = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]')?.dataset.drop;
  if (!key) return null;
  try { return { key, t: JSON.parse(key) as DropTarget }; } catch { return null; }
}

// Die Kopie haengt neben dem Mauszeiger bzw. ueber dem Finger (sonst verdeckt er sie).
function placeGhost(el: HTMLDivElement | null, x: number, y: number, touch: boolean) {
  if (el) el.style.transform = `translate(${x + (touch ? -16 : 12)}px, ${y + (touch ? -52 : 12)}px)`;
}

export function useFilterDrag({ query, fits, onDrop, onStart }: {
  query: ExplorerQuery;
  fits: Fits;
  onDrop: (q: ExplorerQuery) => void;
  /** Ziehen beginnt (offene Einstellfenster schliessen). */
  onStart: () => void;
}) {
  const [drag, setDrag] = useState<{ ghost: ReactNode; touch: boolean } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const pos = useRef({ x: 0, y: 0 });
  const busy = useRef<(() => void) | null>(null);
  // Neueste Anfrage fuer die Zeiger-Handler, die ueber mehrere Darstellungen laufen.
  const latest = useRef({ query, fits, onDrop, onStart });
  useLayoutEffect(() => { latest.current = { query, fits, onDrop, onStart }; });

  useEffect(() => () => busy.current?.(), []);
  useLayoutEffect(() => { if (drag) placeGhost(ghostRef.current, pos.current.x, pos.current.y, drag.touch); }, [drag]);

  const begin = (e: ReactPointerEvent, src: DragSrc, ghost: ReactNode) => {
    if (e.button !== 0 || busy.current) return;
    // Item-Bild am Unit-Chip: nicht zusaetzlich den Chip ziehen.
    e.stopPropagation();
    const id = e.pointerId;
    const touch = e.pointerType === 'touch';
    const x0 = e.clientX;
    const y0 = e.clientY;
    pos.current = { x: x0, y: y0 };
    let active = false;
    let overKey: string | null = null;
    let timer: number | null = null;

    const valid = (t: DropTarget) => moveFilter(latest.current.query, src, t, latest.current.fits);
    const hover = () => {
      const hit = targetAt(pos.current.x, pos.current.y);
      const key = hit?.key ?? null;
      if (key === overKey) return;
      overKey = key;
      setOver(hit && valid(hit.t) ? key : null);
    };
    const activate = () => {
      active = true;
      latest.current.onStart();
      document.body.style.cursor = 'grabbing';
      setDrag({ ghost, touch });
      hover();
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      // Maus ausserhalb des Fensters losgelassen: kein pointerup angekommen.
      if (!touch && ev.buttons === 0) { finish(false); return; }
      pos.current = { x: ev.clientX, y: ev.clientY };
      if (!active) {
        const dist = Math.hypot(ev.clientX - x0, ev.clientY - y0);
        if (touch) { if (dist > TOUCH_SLOP) finish(false); return; }
        if (dist < MOUSE_SLOP) return;
        activate();
      }
      placeGhost(ghostRef.current, pos.current.x, pos.current.y, touch);
      hover();
    };
    const up = (ev: PointerEvent) => { if (ev.pointerId === id) finish(true); };
    const cancel = (ev: PointerEvent) => { if (ev.pointerId === id) finish(false); };
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && active) { ev.preventDefault(); finish(false); } };
    // Gezogen wird mit dem Finger, nicht gescrollt; nicht passiv, sonst wirkt preventDefault nicht.
    const touchMove = (ev: TouchEvent) => { if (active && ev.cancelable) ev.preventDefault(); };
    const menu = (ev: Event) => { if (active) ev.preventDefault(); };

    const off = () => {
      if (timer != null) clearTimeout(timer);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', key);
      document.removeEventListener('touchmove', touchMove);
      document.removeEventListener('contextmenu', menu);
      document.body.style.cursor = '';
      busy.current = null;
    };
    const finish = (drop: boolean) => {
      off();
      if (!active) return;
      // Der Klick nach dem Loslassen gehoert zum Ziehen, nicht zum Baustein darunter.
      const swallow = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); };
      document.addEventListener('click', swallow, true);
      setTimeout(() => document.removeEventListener('click', swallow, true), 0);
      const hit = drop ? targetAt(pos.current.x, pos.current.y) : null;
      const next = hit ? valid(hit.t) : null;
      setOver(null);
      setDrag(null);
      if (next) latest.current.onDrop(next);
    };

    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', key);
    document.addEventListener('touchmove', touchMove, { passive: false });
    document.addEventListener('contextmenu', menu);
    if (touch) timer = window.setTimeout(() => { timer = null; activate(); }, TOUCH_HOLD_MS);
    busy.current = off;
  };

  return {
    dragging: drag != null,
    /** Props fuer die Quelle (Chip-Knopf, Item-Bild). */
    source: (src: DragSrc, ghost: ReactNode) => ({ onPointerDown: (e: ReactPointerEvent) => begin(e, src, ghost) }),
    /** Props fuer ein Ziel. */
    target: (t: DropTarget) => ({ 'data-drop': dropKey(t) }),
    isOver: (t: DropTarget) => over === dropKey(t),
    // Ans Seitenende gehaengt: fixed waere unter einem verschobenen Vorfahren sonst versetzt.
    ghost: drag ? createPortal(
      <div ref={ghostRef} aria-hidden
        className="fixed left-0 top-0 z-50 pointer-events-none flex items-center gap-1.5 rounded-md border border-accent-a50 bg-surface-raised px-1.5 py-1 text-xs text-fg-primary shadow-xl">
        {drag.ghost}
      </div>,
      document.body,
    ) : null,
  };
}
