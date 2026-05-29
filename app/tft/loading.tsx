// Route-level loading skeleton for every /tft/* page. Next renders this as the
// Suspense fallback for the segment, so navigation between TFT pages shows a
// stable dark shell instantly instead of a flash-of-empty-page before the
// client page mounts and runs its own fetch. Pure presentational, no client JS.
export default function TftLoading() {
  return (
    <main className="min-h-screen bg-[#0e1525]" aria-busy="true">
      {/* Nav-height placeholder so the top bar doesn't flash out on navigation */}
      <div className="h-14 border-b border-[#1e2a3a] bg-[#0d1526]" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 animate-pulse">
        <div className="h-9 w-48 bg-[#141c2e] rounded mb-5" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 bg-[#0d1526] border border-[#1e2a3a] rounded" />
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 bg-[#0d1526] border border-[#1e2a3a] rounded" />
          ))}
        </div>
      </div>
    </main>
  );
}
