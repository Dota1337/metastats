// Refresh Supabase auth session on every request that hits an app route.
// Without this, the session cookie expires silently and the user gets
// signed out after ~1h even while actively browsing.

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(req: NextRequest) {
  let response = NextResponse.next({ request: req });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll(); },
        setAll(items) {
          for (const { name, value } of items) req.cookies.set(name, value);
          response = NextResponse.next({ request: req });
          for (const { name, value, options } of items) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );
  // Just touching getUser refreshes the token if the cookie is stale.
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: [
    // Skip static assets + API images. Everything else flows through.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
