// Server-side Supabase client that reads/writes the auth session cookie via
// Next.js' cookies() helper. Used in RSC + route handlers when we need to
// know "who is this user" or run a query under their RLS context.
//
// The middleware (root-level middleware.ts) handles the refresh-on-every-
// request step; this client just reads what's there.

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function getSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(items) {
          try {
            for (const { name, value, options } of items) {
              cookieStore.set(name, value, options as CookieOptions);
            }
          } catch {
            // Setting cookies fails in RSC; route handlers handle this via
            // the response object. Safe to ignore — middleware refresh
            // remains the authoritative path.
          }
        },
      },
    },
  );
}
