import type { Metadata } from 'next';
import AccountClient from './AccountClient';

// Kontoseite (/auth/account). /auth ist privat: keine Sprach-Adresse, robots
// gesperrt, nicht in der Sitemap.

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

type SP = Record<string, string | string[] | undefined>;

export default async function AccountPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const err = Array.isArray(sp.error) ? sp.error[0] : sp.error;
  return <AccountClient errorCode={err ?? null} />;
}
