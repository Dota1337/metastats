import type { Metadata } from 'next';
import { SITE_URL } from '../../lib/site';

export const metadata: Metadata = {
  title: 'TFT Rising Players — Biggest LP Gains · metastats.gg',
  description: 'The 20 Master+ TFT players with the biggest LP gains over the last 1, 3 or 5 days, with their most played comp, placements and playstyle.',
  alternates: { canonical: `${SITE_URL}/tft/rising` },
  openGraph: {
    title: 'TFT Rising Players — Biggest LP Gains',
    description: 'Master+ TFT players climbing fastest over the last 1, 3 or 5 days.',
    url: `${SITE_URL}/tft/rising`,
    siteName: 'metastats.gg',
    type: 'website',
  },
};

export default function RisingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
