'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { getSupabaseBrowser } from './supabase-client';
import { isRiotPlaceholderEmail } from './riot-rso-email';

// Lightweight auth context. Subscribes to Supabase auth changes and exposes
// { user, loading, signOut } to any component that needs them. Sign-in/up
// flows go through the dedicated /auth/* pages.
//
// riot: Stand der Riot-Verknuepfung (/api/account/riot) fuer Konto-Menue und
// Kontoseite. Nur fuer angemeldete Nutzer abgefragt.

interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export interface RiotAccountInfo {
  enabled: boolean;
  riotOnly: boolean;
  link: { gameName: string; tagLine: string; tftPath: string | null; lolPath: string | null } | null;
}

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
  riot: RiotAccountInfo | null;
  refreshRiot: () => Promise<void>;
}

const Context = createContext<AuthCtx>({
  user: null, loading: true, signOut: async () => {}, riot: null, refreshRiot: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  // Stand je Nutzer: nach Abmelden oder Kontowechsel gilt der alte Stand nicht
  // mehr, ohne dass er im Effekt geleert werden muss.
  const [riotState, setRiotState] = useState<{ uid: string; info: RiotAccountInfo | null } | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let mounted = true;
    supabase.auth.getUser().then(({ data }: any) => {
      if (!mounted) return;
      setUser(toAuthUser(data.user));
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event: any, session: any) => {
      setUser(toAuthUser(session?.user || null));
      setLoading(false);
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  const userId = user?.id ?? null;
  const riot = riotState && riotState.uid === userId ? riotState.info : null;

  const refreshRiot = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch('/api/account/riot', { cache: 'no-store' });
      const info = res.ok ? await res.json() as RiotAccountInfo : null;
      setRiotState({ uid: userId, info });
    } catch {
      setRiotState({ uid: userId, info: null });
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const ctrl = new AbortController();
    fetch('/api/account/riot', { cache: 'no-store', signal: ctrl.signal })
      .then(res => (res.ok ? res.json() : null))
      .then((info: RiotAccountInfo | null) => { if (!ctrl.signal.aborted) setRiotState({ uid: userId, info }); })
      .catch(() => { if (!ctrl.signal.aborted) setRiotState({ uid: userId, info: null }); });
    return () => ctrl.abort();
  }, [userId]);

  async function signOut() {
    await getSupabaseBrowser().auth.signOut();
    setUser(null);
  }

  return <Context.Provider value={{ user, loading, signOut, riot, refreshRiot }}>{children}</Context.Provider>;
}

export function useAuth() { return useContext(Context); }

function toAuthUser(raw: any): AuthUser | null {
  if (!raw) return null;
  const meta = raw.user_metadata || {};
  // Konten aus der Riot-Anmeldung haben eine nicht zustellbare Platzhalter-
  // Adresse — nie anzeigen, auch nicht als Namens-Ersatz.
  const email = isRiotPlaceholderEmail(raw.email) ? null : (raw.email || null);
  return {
    id: raw.id,
    email,
    name: meta.name || meta.full_name || email?.split('@')[0] || null,
    avatarUrl: meta.avatar_url || meta.picture || null,
  };
}
