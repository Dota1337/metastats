import { ImageResponse } from 'next/og';
import { ACCENT_LOL, OG_CACHE_HEADERS, StaticCard } from './lib/og/frame';

export const runtime = 'edge';
export const alt = 'metastats.gg — League of Legends Statistiken & Marktwerte';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <StaticCard
        accent={ACCENT_LOL}
        title={<>meta<span style={{ color: ACCENT_LOL }}>stats</span>.gg</>}
        subtitle="League of Legends · Stats · AI Market Values"
        pills={['Leaderboard', 'Champions', 'Pro Teams', 'Market Intelligence']}
      />
    ),
    { ...size, headers: OG_CACHE_HEADERS }
  );
}
