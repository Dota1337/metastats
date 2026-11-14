// Platzhalter-Adressen der Konten, die per Riot-Anmeldung entstehen. Riot
// liefert keine E-Mail, Supabase braucht eine. Die Adresse ist nicht
// zustellbar (users.metastats.gg hat keinen MX-Eintrag, gemessen 14.11.2026)
// und wird nirgends angezeigt — deshalb diese kleine Datei, die auch der
// Browser laden darf (auth-context, Nav). Gebaut wird die Adresse in riot-rso.ts.

export const RSO_EMAIL_DOMAIN = 'users.metastats.gg';

export function isRiotPlaceholderEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().startsWith('riot-') && email.toLowerCase().endsWith(`@${RSO_EMAIL_DOMAIN}`);
}
