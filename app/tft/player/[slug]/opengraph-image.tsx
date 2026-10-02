import { tftPlayerOgData } from '../../../lib/og/data';
import { tftPlayerImage } from '../../../lib/og/cards';
import { decodeSlug, parseTftPlayerSlug } from '../../../lib/og/slugs';

// Node statt Edge: der Rang kommt per Service-Rolle aus dem Namensverzeichnis.
export const runtime = 'nodejs';
export const alt = 'metastats.gg — TFT';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { gameName, tagLine } = parseTftPlayerSlug(decodeSlug((await params).slug));
  const data = await tftPlayerOgData(gameName, tagLine).catch(() => null);
  return tftPlayerImage(gameName, tagLine, data);
}
