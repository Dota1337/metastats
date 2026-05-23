// Client-side Supabase singleton with cookie-based session handling.
// Use in 'use client' components for auth state subscription, signIn/signUp
// calls, and any read that needs the user's RLS context. Pairs with
// supabase-server.ts (read in RSC + route handlers) and the middleware
// that refreshes the session cookie on every request.

import { createBrowserClient } from '@supabase/ssr';

let _client: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseBrowser() {
  if (!_client) {
    _client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return _client;
}
