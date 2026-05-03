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
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active={active} />
      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-8 text-center">
          <div className="inline-block px-3 py-1 rounded-full bg-[#7B61FF]/15 text-[#7B61FF] text-xs uppercase tracking-widest mb-4">
            TFT
          </div>
          <h1 className="text-white text-2xl font-medium mb-2">{title}</h1>
          <p className="text-[#8a9bb0] text-sm">{hint || 'Wird in einer der nächsten Iterationen ausgeliefert.'}</p>
        </div>
      </div>
      <Footer />
    </main>
  );
}
