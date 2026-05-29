'use client';
import { useEffect } from 'react';

// Route-level error boundary for /tft/*. A render/runtime error in any single
// TFT page degrades to this retry card inside the normal dark shell instead of
// bubbling to the app-level error screen. Deliberately self-contained (plain
// text, no i18n/context) so it stays robust even when the failure is upstream
// of the i18n provider.
export default function TftError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface in the console / monitoring without leaking details to the user.
    console.error('TFT page error:', error);
  }, [error]);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <div className="h-14 border-b border-[#1e2a3a] bg-[#0d1526]" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 flex justify-center">
        <div className="bg-[#0d1526] border border-red-500/40 rounded-lg p-8 text-center max-w-md">
          <div className="text-red-400 font-medium mb-3">Etwas ist schiefgelaufen.</div>
          <button
            onClick={reset}
            className="px-4 py-1.5 rounded bg-[#7B61FF] text-white text-sm hover:bg-[#6a52e0] transition-colors"
          >
            Erneut versuchen
          </button>
        </div>
      </div>
    </main>
  );
}
