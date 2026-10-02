import { compOgData, compNameFromSlug } from '../../../lib/og/data';
import { compImage } from '../../../lib/og/cards';
import { decodeSlug } from '../../../lib/og/slugs';

// Node statt Edge: das Asset-Bundle wird von der Platte gelesen, und der
// Zwischenspeicher-Lookup teilt sich den Manifest-Cache mit den API-Routen.
export const runtime = 'nodejs';
export const alt = 'metastats.gg — TFT Comp';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const slug = decodeSlug((await params).slug);
  const data = await compOgData(slug).catch(() => null);
  return compImage(data, compNameFromSlug(slug) || 'TFT Comp');
}
