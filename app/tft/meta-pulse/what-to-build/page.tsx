'use client';
import { Suspense } from 'react';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import WhatToBuildView from '../../../components/tft/what-to-build/WhatToBuildView';

// Item-Vergleich je Unit (Plan 01.11.2026). Zahlen aus dem Data Explorer.
export default function WhatToBuildPage() {
  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="comps" />
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
        <Suspense fallback={<div className="h-96 rounded-xl border border-border-subtle bg-surface-base animate-pulse" />}>
          <WhatToBuildView />
        </Suspense>
      </div>
      <Footer />
    </main>
  );
}
