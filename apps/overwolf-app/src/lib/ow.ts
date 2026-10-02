// Duenne Huelle um overwolf.windows, als Promises.

export type WindowName = 'background' | 'main' | 'pinned' | 'shop' | 'matchup';

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

export async function toggle(name: WindowName): Promise<void> {
  if (await isVisible(name)) {
    const w = await obtain(name);
    if (w) overwolf.windows.minimize(w.id, () => {});
  } else {
    await show(name);
  }
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

export function closeSelf(): void {
  overwolf.windows.getCurrentWindow(r => { if (r?.window) overwolf.windows.close(r.window.id, () => {}); });
}

export function minimizeSelf(): void {
  overwolf.windows.getCurrentWindow(r => { if (r?.window) overwolf.windows.minimize(r.window.id, () => {}); });
}

export function openExternal(url: string): void {
  overwolf.utils.openUrlInDefaultBrowser(url);
}
