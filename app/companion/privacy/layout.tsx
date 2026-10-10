import type { Metadata } from 'next';

// Die Seite ist ein Client-Baustein (Sprache), der Titel steht deshalb hier.
export const metadata: Metadata = {
  title: 'Companion App — Privacy Policy · metastats.gg',
  description: 'What the metastats.gg Companion app for Overwolf reads, stores and sends.',
};

export default function CompanionPrivacyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
