import LoginForm from './LoginForm';
import { riotRsoEnabled } from '../../lib/riot-rso-config';
import { safeNext } from '../../lib/safe-next';

// Server-Huelle: der Riot-Schalter ist eine Server-Variable und erreicht den
// Client-Baustein nur als Wert (architect 14.11.2026). Ohne Zugangsdaten
// erscheint kein Riot-Knopf.

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export default async function LoginPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  return <LoginForm riotEnabled={riotRsoEnabled()} next={safeNext(one(sp.next))} errorCode={one(sp.error)} />;
}
