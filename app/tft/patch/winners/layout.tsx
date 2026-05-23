import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'TFT Patch Winners & Losers — Meta Shift Tracker · metastats.gg',
  description: 'Biggest avg-placement swings between TFT patches. See which units, items and traits gained or lost ground in the latest patch from Master+ ranked data.',
  alternates: { canonical: 'https://metastats.gg/tft/patch/winners' },
  openGraph: {
    title: 'TFT Patch Winners & Losers',
    description: 'Track the biggest meta shifts between TFT patches.',
    url: 'https://metastats.gg/tft/patch/winners',
    siteName: 'metastats.gg',
    type: 'website',
  },
};

export default function PatchWinnersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
