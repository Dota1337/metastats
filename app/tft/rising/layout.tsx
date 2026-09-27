import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'TFT Rising Players — Biggest LP Gains · metastats.gg',
  description: 'The 20 Master+ TFT players with the biggest LP gains over the last 1, 3 or 5 days, with their most played comp, placements and playstyle.',
  alternates: { canonical: 'https://metastats.gg/tft/rising' },
  openGraph: {
    title: 'TFT Rising Players — Biggest LP Gains',
    description: 'Master+ TFT players climbing fastest over the last 1, 3 or 5 days.',
    url: 'https://metastats.gg/tft/rising',
    siteName: 'metastats.gg',
    type: 'website',
  },
};

export default function RisingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
