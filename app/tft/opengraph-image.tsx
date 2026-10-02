import { ImageResponse } from 'next/og';
import { ACCENT_TFT, OG_CACHE_HEADERS, StaticCard } from '../lib/og/frame';

export const runtime = 'edge';
export const alt = 'metastats.gg — Teamfight Tactics Stats & Marktwerte';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <StaticCard
        accent={ACCENT_TFT}
        title={<>meta<span style={{ color: ACCENT_TFT }}>stats</span>.gg</>}
        subtitle="Teamfight Tactics · Comps · Marktwerte"
        pills={['Comps', 'Units', 'Items', 'Pro-Marktwerte']}
      />
    ),
    { ...size, headers: OG_CACHE_HEADERS }
  );
}
