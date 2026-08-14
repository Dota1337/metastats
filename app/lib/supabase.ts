// Dieses Modul haelt den Service-Role-Key. `server-only` laesst den Build
// fehlschlagen, sobald es aus einer Client-Komponente importiert wird.
// Browser-Code nutzt stattdessen `lib/supabase-client`.
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Public client (read-only, respects RLS)
export const supabase = createClient(supabaseUrl, supabaseKey);

// Server-side admin client (bypasses RLS, use only in API routes).
//
// Frueher fiel dieser Export bei fehlendem Key still auf den Anon-Client
// zurueck. Sobald den Tabellen die anon-Leserechte entzogen sind, liefert
// dieser Fallback leere Ergebnisse statt eines Fehlers — eine Panne, die man
// erst an leeren Seiten merkt. Jetzt: in Production ein harter Fehler,
// sonst ein lauter Fallback.
//
// Die Aufloesung passiert faul beim ersten Zugriff, nicht auf Modulebene:
// der Next-Build importiert dieses Modul, und ein Wurf zur Importzeit wuerde
// den Build kippen, statt nur den betroffenen Request.
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let adminClient: SupabaseClient | null = null;
let fallbackWarned = false;

function resolveAdmin(): SupabaseClient {
  if (adminClient) return adminClient;

  if (serviceRoleKey) {
    adminClient = createClient(supabaseUrl, serviceRoleKey);
    return adminClient;
  }

  if (process.env.VERCEL_ENV === 'production') {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY fehlt in Production — der Serverpfad darf nicht auf den Anon-Client zurueckfallen.',
    );
  }

  if (!fallbackWarned) {
    fallbackWarned = true;
    console.error(
      '[supabase] SUPABASE_SERVICE_ROLE_KEY fehlt — Fallback auf den Anon-Client. Nur ausserhalb Production erlaubt; Ergebnisse koennen leer sein.',
    );
  }
  adminClient = supabase;
  return adminClient;
}

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = resolveAdmin();
    const value = Reflect.get(client as object, prop, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});