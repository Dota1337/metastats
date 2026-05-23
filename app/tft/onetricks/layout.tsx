import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'TFT One-Tricks — High-Elo Specialty Players · metastats.gg',
  description: 'Discover high-elo TFT players who specialize in 1-2 specific compositions. Track their signature comps, average placements and top-4 share by region.',
  alternates: { canonical: 'https://metastats.gg/tft/onetricks' },
  openGraph: {
    title: 'TFT One-Tricks — High-Elo Specialty Players',
    description: 'High-elo TFT players whose top-2 comps make up ≥60% of their recent games.',
    url: 'https://metastats.gg/tft/onetricks',
    siteName: 'metastats.gg',
    type: 'website',
  },
};

export default function OneTricksLayout({ children }: { children: React.ReactNode }) {
  return children;
}
