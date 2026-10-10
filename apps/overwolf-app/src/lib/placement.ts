// Lage der Overlays im Spielbild. Reine Rechnung (placement.test.ts); die
// Fenster-Aufrufe stehen im Hintergrundfenster und im Gegner-Overlay.
//
// Das Spielbild ist eine zentrierte 16:9-Flaeche (Balken bei anderen
// Seitenverhaeltnissen). Alle Lagen sind Anteile dieser Flaeche, damit sie
// einen Aufloesungswechsel ueberstehen.
export interface GameRect { ox: number; oy: number; bw: number; bh: number }
export interface Frac { x: number; y: number }
export interface Box { left: number; top: number; width?: number; height?: number }

export function rectFromGame(width: number | null | undefined, height: number | null | undefined): GameRect | null {
  const W = Number(width);
  const H = Number(height);
  if (!(W > 0) || !(H > 0)) return null;
  const bw = Math.min(W, (H * 16) / 9);
  const bh = (bw * 9) / 16;
  return { ox: (W - bw) / 2, oy: (H - bh) / 2, bw, bh };
}

// Shop-Leiste: unten zwischen ca. 24 % und 77,5 % der Breite. [x, y, Breite, Hoehe]
export const SHOP_PLACE = [0.24, 0.80, 0.535, 0.11] as const;

// Gegner-Overlay, Standardlage: schmale Spalte links neben der Spielerliste am
// rechten Rand, oben buendig mit ihr — rechts vom Spielfeld, frei von
// Stage-Leiste, Shop, Trait-Liste und Item-Bank. Die Hoehe setzt das Overlay
// selbst nach seinem Inhalt.
export const MATCHUP_DEFAULT: Frac = { x: 0.76, y: 0.15 };
export const MATCHUP_WIDTH = 0.105;
// Mindestens dieser Streifen der Hoehe bleibt im Spielbild sichtbar.
const MIN_VISIBLE_H = 0.05;

// Gespeicherte Lage auf den sichtbaren Bereich begrenzen; Unsinn (keine Zahl)
// faellt auf die Standardlage zurueck.
export function clampPos(p: Partial<Frac> | null | undefined): Frac {
  const x = Number(p?.x);
  const y = Number(p?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ...MATCHUP_DEFAULT };
  return {
    x: Math.min(Math.max(x, 0), 1 - MATCHUP_WIDTH),
    y: Math.min(Math.max(y, 0), 1 - MIN_VISIBLE_H),
  };
}

export function matchupFrac(saved: Partial<Frac> | null | undefined): Frac {
  return saved ? clampPos(saved) : { ...MATCHUP_DEFAULT };
}

export function toPixels(f: Frac, r: GameRect): { left: number; top: number } {
  return { left: r.ox + r.bw * f.x, top: r.oy + r.bh * f.y };
}

export function toFrac(left: number, top: number, r: GameRect): Frac {
  return { x: (left - r.ox) / r.bw, y: (top - r.oy) / r.bh };
}

// Fensterlage in Pixeln. Das Gegner-Overlay bekommt nur die Lage: Breite und
// Hoehe setzt es selbst nach seinem Inhalt (fitSelf rechnet die Bildschirm-
// Skalierung mit ein, die Spielfenster-Angaben hier tun das nicht).
// Item-Auswahl: Leiste ueber den Karten, unten mittig. Masse wie MetaTFT (im
// Paket 0.2.768 gemessen): 1320 x 375 bei 1080 Pixeln Bildhoehe.
export const ITEMS_SIZE = { w: 1320 / 1080, h: 375 / 1080 } as const;

export function overlayBox(name: 'shop' | 'matchup' | 'items', r: GameRect, saved: Partial<Frac> | null | undefined): Box {
  if (name === 'items') {
    const width = r.bh * ITEMS_SIZE.w;
    const height = r.bh * ITEMS_SIZE.h;
    return { left: r.ox + (r.bw - width) / 2, top: r.oy + r.bh - height, width, height };
  }
  if (name === 'shop') {
    const [x, y, w, h] = SHOP_PLACE;
    return { left: r.ox + r.bw * x, top: r.oy + r.bh * y, width: r.bw * w, height: r.bh * h };
  }
  return toPixels(matchupFrac(saved), r);
}
