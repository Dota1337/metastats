import type { Metadata } from 'next';

// Die Seite ist ein Client-Baustein (Sprache), der Titel steht deshalb hier.
export const metadata: Metadata = {
  title: 'Companion App — Terms of Use · metastats.gg',
  description: 'Terms of use of the metastats.gg Companion app for Overwolf.',
};

export default function CompanionTermsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
