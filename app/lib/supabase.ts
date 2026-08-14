// Dieses Modul haelt den Service-Role-Key. `server-only` laesst den Build
// fehlschlagen, sobald es aus einer Client-Komponente importiert wird.
// Browser-Code nutzt stattdessen `lib/supabase-client`.
import 'server-only';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Public client (read-only, respects RLS)
export const supabase = createClient(supabaseUrl, supabaseKey);

// Server-side admin client (bypasses RLS, use only in API routes)
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const supabaseAdmin = serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey)
  : supabase;