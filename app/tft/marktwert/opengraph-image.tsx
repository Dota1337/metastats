import { ImageResponse } from 'next/og';
import { ACCENT_TFT, OG_CACHE_HEADERS, StaticCard } from '../../lib/og/frame';

export const runtime = 'edge';
export const alt = 'metastats.gg — TFT Marktwerte';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <StaticCard
        accent={ACCENT_TFT}
        title={<>TFT <span style={{ color: ACCENT_TFT, marginLeft: 20 }}>Marktwerte</span></>}
        subtitle="KI-Marktwert · 6 Signale · Diamond II+"
        pills={['Top-Movers', 'Sparklines', 'Pro-Teams', 'Patch-Timeline']}
      />
    ),
    { ...size, headers: OG_CACHE_HEADERS }
  );
}
