// Duenne Huelle um overwolf.windows, als Promises.

import type { WindowName } from './windows.ts';
export type { WindowName };

export function obtain(name: WindowName): Promise<overwolf.windows.WindowInfo | null> {
  return new Promise(res => {
    overwolf.windows.obtainDeclaredWindow(name, r => res(r?.success && r.window ? r.window : null));
  });
}

export async function show(name: WindowName): Promise<string | null> {
  const w = await obtain(name);
  if (!w) return null;
  await new Promise<void>(res => overwolf.windows.restore(w.id, () => res()));
  return w.id;
}

export async function close(name: WindowName): Promise<void> {
  const w = await obtain(name);
  if (!w) return;
  await new Promise<void>(res => overwolf.windows.close(w.id, () => res()));
}

export async function isVisible(name: WindowName): Promise<boolean> {
  const w = await obtain(name);
  if (!w) return false;
  return new Promise(res => {
    overwolf.windows.getWindowState(w.id, r => {
      const s = String(r?.window_state_ex || r?.window_state || '');
      res(s === 'normal' || s === 'maximized');
    });
  });
}

export async function minimize(name: WindowName): Promise<void> {
  const w = await obtain(name);
  if (w) await new Promise<void>(res => overwolf.windows.minimize(w.id, () => res()));
}

// Fenster nach vorn. grabFocus = auch die Tastatur uebernehmen — nur nach einem
// Klick des Nutzers, nie ueber dem laufenden Spiel (das wuerde es minimieren).
export async function front(name: WindowName, grabFocus: boolean): Promise<void> {
  const w = await obtain(name);
  if (w) await new Promise<void>(res => overwolf.windows.bringToFront(w.id, grabFocus, () => res()));
}

// Wiederherstellen allein holt ein Desktop-Fenster nicht sicher vor das Spiel.
export async function toggle(name: WindowName, grabFocus = false): Promise<void> {
  if (await isVisible(name)) {
    await minimize(name);
  } else if (await show(name)) {
    await front(name, grabFocus);
  }
}

// Durchklickbar an/aus. Die Overlays sind laut Manifest durchklickbar; zum
// Verschieben muss das Gegner-Overlay die Maus kurz annehmen.
// Liefert, ob Overwolf die Aenderung bestaetigt hat (fuers Log).
export async function setPassThrough(name: WindowName, on: boolean): Promise<boolean> {
  const w = await obtain(name);
  if (!w) return false;
  // Ambientes const enum: mit isolatedModules nur als Typ nutzbar.
  const style = 'InputPassThrough' as overwolf.windows.enums.WindowStyle;
  return new Promise(res => {
    const cb = (r: overwolf.windows.WindowIdResult) => res(!!r?.success);
    if (on) overwolf.windows.setWindowStyle(w.id, style, cb);
    else overwolf.windows.removeWindowStyle(w.id, style, cb);
  });
}

export async function setTopmost(name: WindowName, on: boolean): Promise<void> {
  const w = await obtain(name);
  if (w) await new Promise<void>(res => overwolf.windows.setTopmost(w.id, on, () => res()));
}

// Hoehe des eigenen Fensters an den Inhalt anpassen (Overlays ohne Rahmen).
export function fitSelf(width: number, height: number): void {
  overwolf.windows.getCurrentWindow(r => {
    if (r?.window) overwolf.windows.changeSize({ window_id: r.window.id, width: Math.ceil(width), height: Math.ceil(height), auto_dpi_resize: true }, () => {});
  });
}

export async function moveTo(name: WindowName, left: number, top: number, width?: number, height?: number): Promise<void> {
  const w = await obtain(name);
  if (!w) return;
  if (width && height) await new Promise<void>(res => overwolf.windows.changeSize(w.id, Math.round(width), Math.round(height), () => res()));
  await new Promise<void>(res => overwolf.windows.changePosition(w.id, Math.round(left), Math.round(top), () => res()));
}

// Ziehen am Kopf des eigenen Fensters.
export function makeDraggable(handle: HTMLElement): void {
  handle.addEventListener('mousedown', e => {
    if ((e.target as HTMLElement).closest('button, input, select, a')) return;
    overwolf.windows.getCurrentWindow(r => { if (r?.window) overwolf.windows.dragMove(r.window.id); });
  });
}

// Eigenes Fenster mit der Maus ziehen. Danach: Verschiebung laut Overwolf und
// die neue Fensterlage (beides fuers Log, bis feststeht, welche Angabe stimmt).
export interface DragDone { dx: number | null; dy: number | null; after: overwolf.windows.WindowInfo | null }

export function dragSelf(done: (d: DragDone | null) => void): void {
  overwolf.windows.getCurrentWindow(r => {
    if (!r?.window) { done(null); return; }
    overwolf.windows.dragMove(r.window.id, m => {
      const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
      overwolf.windows.getCurrentWindow(a => done({
        dx: num(m?.HorizontalChange), dy: num(m?.VerticalChange), after: a?.window ?? null,
      }));
    });
  });
}

export function closeSelf(): void {
  overwolf.windows.getCurrentWindow(r => { if (r?.window) overwolf.windows.close(r.window.id, () => {}); });
}

// Maximieren und zurueck (Knopf in der Kopfleiste des Hauptfensters).
export function toggleMaximizeSelf(): void {
  overwolf.windows.getCurrentWindow(r => {
    const w = r?.window;
    if (!w) return;
    const maxed = String(w.stateEx || w.state || '') === 'maximized';
    if (maxed) overwolf.windows.restore(w.id, () => {});
    else overwolf.windows.maximize(w.id, () => {});
  });
}

// Nachricht an das Hintergrundfenster (× an Overlays, Neu laden).
export function tellBackground(id: string, content = ''): void {
  try { overwolf.windows.sendMessage('background', id, content, () => {}); } catch { /* ausserhalb von Overwolf */ }
}

export function minimizeSelf(): void {
  overwolf.windows.getCurrentWindow(r => { if (r?.window) overwolf.windows.minimize(r.window.id, () => {}); });
}

export function openExternal(url: string): void {
  overwolf.utils.openUrlInDefaultBrowser(url);
}
