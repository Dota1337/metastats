// Bildschirme: auf welchem laeuft das Spiel, wohin mit dem Hauptfenster.
// Reine Rechnung (monitors.test.ts); die Liste liefert
// overwolf.utils.getMonitorsList (braucht die Berechtigung DesktopStreaming).
//
// Koordinaten koennen negativ sein (Bildschirm links vom Hauptbildschirm,
// gemessen 10.10.: DISPLAY3 bei -1920,0).
export interface Mon { id: string; x: number; y: number; width: number; height: number; primary: boolean; handle: number | null }
export interface Rect { left: number; top: number; width: number; height: number }

export function toMon(d: { id?: unknown; x?: unknown; y?: unknown; width?: unknown; height?: unknown; is_primary?: unknown; handle?: { value?: unknown } | null }): Mon | null {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  const m = { x: n(d.x), y: n(d.y), width: n(d.width), height: n(d.height) };
  if (!d.id || !Number.isFinite(m.x) || !Number.isFinite(m.y) || !(m.width > 0) || !(m.height > 0)) return null;
  const h = n(d.handle?.value);
  return { id: String(d.id), ...m, primary: d.is_primary === true, handle: Number.isFinite(h) ? h : null };
}

// Unbekannt oder leer zaehlt als ein Bildschirm (dann nie umziehen).
export function monitorCount(list: Mon[] | null | undefined): number {
  return Math.max(1, list?.length ?? 0);
}

const contains = (m: Mon, x: number, y: number) => x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height;

// Bildschirm des Spiels: ueber das Handle aus getRunningGameInfo; fehlt es,
// gilt der Hauptbildschirm (dort starten Vollbild-Spiele).
export function gameMonitor(list: Mon[], gameHandle: number | null | undefined): Mon | null {
  if (gameHandle != null) {
    const m = list.find(x => x.handle === gameHandle);
    if (m) return m;
  }
  return list.find(x => x.primary) ?? list[0] ?? null;
}

// Bildschirm, auf dem ein Fenster liegt: per Kennung, sonst ueber seine Mitte.
export function monitorOf(list: Mon[], r: Rect, monitorId?: string | null): Mon | null {
  if (monitorId) {
    const m = list.find(x => x.id === monitorId);
    if (m) return m;
  }
  return list.find(m => contains(m, r.left + r.width / 2, r.top + r.height / 2)) ?? null;
}

// Ziel fuer das Hauptfenster waehrend einer Partie: der vom Nutzer gewaehlte
// Bildschirm, falls dort kein Spiel laeuft; sonst der naechste zum Spiel,
// bei Gleichstand der rechte. null = kein Bildschirm ohne Spiel.
export function pickTarget(list: Mon[], gameHandle: number | null | undefined, preferredId: string | null | undefined): Mon | null {
  const game = gameMonitor(list, gameHandle);
  const others = list.filter(m => m !== game);
  if (!others.length) return null;
  const pref = preferredId ? others.find(m => m.id === preferredId) : undefined;
  if (pref) return pref;
  const gx = game ? game.x + game.width / 2 : 0;
  const gy = game ? game.y + game.height / 2 : 0;
  const dist = (m: Mon) => Math.hypot(m.x + m.width / 2 - gx, m.y + m.height / 2 - gy);
  return [...others].sort((a, b) => dist(a) - dist(b) || b.x - a.x)[0];
}

// Fenster mittig auf einen Bildschirm, hoechstens `share` seiner Breite/Hoehe.
export function centerOn(m: Mon, size: { width: number; height: number }, share = 0.9): Rect {
  const width = Math.round(Math.min(size.width, m.width * share));
  const height = Math.round(Math.min(size.height, m.height * share));
  return { left: m.x + Math.round((m.width - width) / 2), top: m.y + Math.round((m.height - height) / 2), width, height };
}

// Liegt das Fenster ausserhalb aller Bildschirme (Bildschirm abgesteckt,
// Aufloesung gewechselt)? Massstab: die Mitte der Titelleiste.
export function isOffscreen(list: Mon[], r: Rect): boolean {
  if (!list.length) return false;
  const x = r.left + r.width / 2;
  const y = r.top + 16;
  return !list.some(m => contains(m, x, y));
}
