'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getSupabaseBrowser } from './supabase-client';

// Lightweight auth context. Subscribes to Supabase auth changes and exposes
// { user, loading, signOut } to any component that needs them. Sign-in/up
// flows go through the dedicated /auth/* pages.

interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const Context = createContext<AuthCtx>({ user: null, loading: true, signOut: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

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

  async function signOut() {
    await getSupabaseBrowser().auth.signOut();
    setUser(null);
  }

  return <Context.Provider value={{ user, loading, signOut }}>{children}</Context.Provider>;
}

export function useAuth() { return useContext(Context); }

function toAuthUser(raw: any): AuthUser | null {
  if (!raw) return null;
  const meta = raw.user_metadata || {};
  return {
    id: raw.id,
    email: raw.email || null,
    name: meta.name || meta.full_name || raw.email?.split('@')[0] || null,
    avatarUrl: meta.avatar_url || meta.picture || null,
  };
}
