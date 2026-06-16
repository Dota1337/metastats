'use client';

import { useState, FormEvent } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

export default function InternalLoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/internal/3d-ops';
  const [secret, setSecret] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/internal/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, next }),
      });
      if (!res.ok) {
        setErr('Falsches Passwort.');
        setBusy(false);
        return;
      }
      const data = await res.json();
      router.push(data.next || next);
    } catch {
      setErr('Login fehlgeschlagen.');
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0f1c] text-gray-200">
      <form onSubmit={onSubmit} className="w-full max-w-sm bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-6 space-y-4">
        <h1 className="text-lg font-semibold">Internal Ops</h1>
        <input
          type="password"
          value={secret}
          onChange={e => setSecret(e.target.value)}
          placeholder="Secret"
          className="w-full px-3 py-2 bg-[#0a0f1c] border border-[#1e2a3a] rounded text-sm focus:outline-none focus:border-[#7B61FF]"
          autoFocus
        />
        {err && <div className="text-xs text-red-400">{err}</div>}
        <button
          type="submit"
          disabled={busy || !secret}
          className="w-full py-2 bg-[#7B61FF] hover:bg-[#6a52e0] disabled:bg-[#3a3a4a] disabled:cursor-not-allowed rounded text-sm font-medium transition-colors"
        >
          {busy ? 'Verifiziere…' : 'Login'}
        </button>
      </form>
    </div>
  );
}
