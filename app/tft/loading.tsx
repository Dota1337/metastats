import { TFT_HERO_HEIGHT } from '../lib/tft-hero-metrics';

// Route-level loading skeleton for every /tft/* page. Next renders this as the
// Suspense fallback for the segment, so navigation between TFT pages shows a
// stable dark shell instantly instead of a flash-of-empty-page before the
// client page mounts and runs its own fetch. Pure presentational, no client JS.
export default function TftLoading() {
  return (
    <main className="min-h-screen bg-surface-page" aria-busy="true">
      {/* Nav-height placeholder so the top bar doesn't flash out on navigation */}
      <div className="h-14 border-b border-border-subtle bg-surface-base" />
      {/* Kopfzonen-Platzhalter. Die Hoehe kommt aus derselben Konstante wie
          TftHero -- stuenden hier zwei Zahlen, springt der Inhalt genau beim
          Wechsel vom Skeleton auf die Seite. */}
      <div
        className="border-b border-border-subtle"
        style={{
          minHeight: TFT_HERO_HEIGHT,
          background: 'linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-page) 100%)',
        }}
      />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 animate-pulse">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 bg-surface-base border border-border-subtle rounded" />
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 bg-surface-base border border-border-subtle rounded" />
          ))}
        </div>
      </div>
    </main>
  );
}
