'use client';
import { Suspense } from 'react';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import ExplorerView from '../../components/tft/explorer/ExplorerView';

// Data Explorer: beliebige Filter ueber alle Boards des Sets, ausgewertet im
// Analyse-Speicher auf dem Server (scripts/explorer-duckdb-server.mjs).
export default function TftExplorerPage() {
  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="explorer" />
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
        <Suspense fallback={<div className="h-96 rounded-xl border border-border-subtle bg-surface-base animate-pulse" />}>
          <ExplorerView />
        </Suspense>
      </div>
      <Footer />
    </main>
  );
}
