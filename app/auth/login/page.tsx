'use client';
import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import { useI18n } from '../../lib/i18n';
import { getSupabaseBrowser } from '../../lib/supabase-client';

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const search = useSearchParams();
  const redirectTo = search.get('next') || '/';

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'err'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setStatus('sending'); setError(null);
    const supabase = getSupabaseBrowser();
    const result = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectTo)}` },
        });
    if (result.error) {
      setStatus('err'); setError(result.error.message); return;
    }
    if (mode === 'signup' && !result.data.session) {
      setStatus('sent');
      return;
    }
    router.push(redirectTo);
  }

  async function oauth(provider: 'google' | 'discord' | 'twitch') {
    const supabase = getSupabaseBrowser();
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectTo)}` },
    });
  }

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav />
      <div className="max-w-md mx-auto px-4 py-10">
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-6">
          <div className="flex gap-1 mb-5 border-b border-[#1e2a3a]">
            <button
              onClick={() => setMode('login')}
              className={`px-4 py-2 text-sm ${mode === 'login' ? 'text-white border-b-2 border-[#7B61FF]' : 'text-[#a0b0c5] hover:text-white'}`}
            >{t('auth.login')}</button>
            <button
              onClick={() => setMode('signup')}
              className={`px-4 py-2 text-sm ${mode === 'signup' ? 'text-white border-b-2 border-[#7B61FF]' : 'text-[#a0b0c5] hover:text-white'}`}
            >{t('auth.signup')}</button>
          </div>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="text-[#7a8aa0] text-[11px] uppercase tracking-widest">{t('auth.email')}</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full bg-[#141c2e] border border-[#1e2a3a] rounded px-3 py-2 text-sm text-white mt-1 outline-none focus:border-[#7B61FF]/60"
              />
            </div>
            <div>
              <label className="text-[#7a8aa0] text-[11px] uppercase tracking-widest">{t('auth.password')}</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={6}
                className="w-full bg-[#141c2e] border border-[#1e2a3a] rounded px-3 py-2 text-sm text-white mt-1 outline-none focus:border-[#7B61FF]/60"
              />
            </div>
            {error && <div className="text-[#e44040] text-xs">{error}</div>}
            {status === 'sent' && (
              <div className="text-[#3ecf8e] text-xs">{t('auth.confirmEmail')}</div>
            )}
            <button
              type="submit"
              disabled={status === 'sending'}
              className="w-full bg-[#7B61FF] text-white py-2 rounded text-sm font-medium hover:bg-[#9981FF] disabled:opacity-50"
            >
              {status === 'sending' ? '…' : mode === 'login' ? t('auth.login') : t('auth.signup')}
            </button>
          </form>

          <div className="flex items-center gap-3 my-4 text-[#5a6a80] text-[10px] uppercase tracking-widest">
            <div className="flex-1 h-px bg-[#1e2a3a]" />
            {t('auth.or')}
            <div className="flex-1 h-px bg-[#1e2a3a]" />
          </div>

          <div className="space-y-2">
            <button
              onClick={() => oauth('google')}
              className="w-full bg-[#141c2e] border border-[#1e2a3a] hover:border-[#7B61FF]/40 text-white py-2 rounded text-sm"
            >Google</button>
            <button
              onClick={() => oauth('discord')}
              className="w-full bg-[#141c2e] border border-[#1e2a3a] hover:border-[#7B61FF]/40 text-white py-2 rounded text-sm"
            >Discord</button>
            <button
              onClick={() => oauth('twitch')}
              className="w-full bg-[#141c2e] border border-[#1e2a3a] hover:border-[#7B61FF]/40 text-white py-2 rounded text-sm"
            >Twitch</button>
          </div>
        </div>
      </div>
      <Footer />
    </main>
  );
}
