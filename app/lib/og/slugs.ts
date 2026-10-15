// Name + Tag aus den Spieler-Adressen. Eine Quelle fuer Seite, Seitentitel und
// Vorschaubild — sonst zeigt die Link-Vorschau einen anderen Namen als die Seite.
// Erwartet den bereits einmal dekodierten Pfadteil.

function decodeSafe(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Einmal dekodieren, ohne an kaputten %-Folgen zu scheitern. */
export function decodeSlug(raw: unknown): string {
  return decodeSafe(String(raw || ''));
}

/** TFT: `Name--Tag` (neu) oder `Name#Tag`. */
export function parseTftPlayerSlug(slug: string): { gameName: string; tagLine: string } {
  const [gameName = '', tagLine = ''] = slug.includes('--')
    ? slug.split('--').map(decodeSafe)
    : slug.split('#').map(decodeSafe);
  return { gameName, tagLine };
}

/** Alte TFT-Adresse mit EINEM Strich (`Name-Tag`, so bauten Rising und die
 *  Lesezeichen sie; ueber den Spielwechsel auch `Name-Teile-Tag` von LoL) →
 *  kanonischer Pfadteil `Name--Tag` (kodiert), sonst null. Eindeutig, weil
 *  Riot-Namen und -Tags keinen Strich enthalten (15.10.2026: 0 von 1.257.386).
 *  Tags sind 1–5 beliebige Zeichen ("KR 1", Koreanisch), deshalb keine
 *  Zeichenklasse. Nimmt den rohen Pfadteil und dekodiert selbst einmal. */
export function legacyTftPlayerSlug(raw: string): string | null {
  const decoded = decodeSafe(raw);
  if (decoded.includes('--') || decoded.includes('#') || !decoded.includes('-')) return null;
  const parts = decoded.split('-');
  const tag = parts[parts.length - 1];
  const name = parts.slice(0, -1).join(' ').trim();
  const tagLength = [...tag].length;
  if (!name || !tag.trim() || tagLength > 5) return null;
  return `${encodeURIComponent(name)}--${encodeURIComponent(tag)}`;
}

/** LoL: `Name--Tag` (letztes `--`), alte Adressen `Name-Teile-Tag`. Erwartet den
 *  rohen Pfadteil und dekodiert selbst einmal — wie die Seite bisher. */
export function parseLolPlayerSlug(slug: string): { name: string; tag: string } {
  const decoded = decodeSafe(slug);
  const i = decoded.lastIndexOf('--');
  if (i !== -1) return { name: decoded.slice(0, i), tag: decoded.slice(i + 2) };
  const parts = decoded.split('-');
  return { name: parts.slice(0, -1).join(' '), tag: parts[parts.length - 1] };
}
