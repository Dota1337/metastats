'use client';
import Nav from '../Nav';
import Footer from '../Footer';

type Active =
  | 'search' | 'leaderboard' | 'units' | 'items' | 'augments'
  | 'comps' | 'traits' | 'marktwert' | 'analyse';

// Placeholder shell for routes whose real implementation is shipped in a later
// stage. Keeps the navigation and game-switcher live so users can move around
// the new section without hitting 404s.
export default function StubPage({ active, title, hint }: { active: Active; title: string; hint?: string }) {
  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active={active} />
      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="bg-surface-base border border-border-subtle rounded-lg p-8 text-center">
          <div className="inline-block px-3 py-1 rounded-full bg-[#7B61FF]/15 text-[#7B61FF] text-xs uppercase tracking-widest mb-4">
            TFT
          </div>
          <h1 className="text-white text-2xl font-medium mb-2">{title}</h1>
          {hint && <p className="text-fg-secondary text-sm">{hint}</p>}
        </div>
      </div>
      <Footer />
    </main>
  );
}
