import type { ReactNode } from 'react';

// Titel und canonical stehen seit 09.11.2026 in page.tsx: der Name kommt dort
// aus denselben Startdaten wie die Ueberschrift (compHeadingText), und nur die
// Seite kennt sie.
export default function CompDetailLayout({ children }: { children: ReactNode }) {
  return children;
}
