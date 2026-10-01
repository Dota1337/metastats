import { redirect } from 'next/navigation';

// Alte Adresse und Such-Vorlage aus app/layout.tsx: q mitnehmen und den
// Multi-Reiter oeffnen. Die Suche selbst startet erst auf Klick.
export default async function MultiSearchRedirect({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() || '';
  redirect('/compare?mode=multi' + (q ? '&q=' + encodeURIComponent(q.slice(0, 500)) : ''));
}
