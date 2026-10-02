import { lolPlayerOgData } from '../../lib/og/data';
import { lolPlayerImage } from '../../lib/og/cards';
import { parseLolPlayerSlug } from '../../lib/og/slugs';

// Node statt Edge: Rang und Marktwert kommen per Service-Rolle aus der
// Datenbank. Riot wird hier nie gefragt (Entwickler-Schluessel, enges Limit).
export const runtime = 'nodejs';
export const alt = 'metastats.gg — League of Legends';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { name, tag } = parseLolPlayerSlug(String((await params).slug || ''));
  const data = await lolPlayerOgData(name, tag).catch(() => null);
  return lolPlayerImage(name, tag, data);
}
