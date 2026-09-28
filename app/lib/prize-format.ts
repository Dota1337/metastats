// Preisgeld-Anzeige fuer Turniere (2026-09-28).
// Dollar, wenn umgerechnet; sonst der Betrag in der Landeswaehrung der
// Liquipedia-Seite. Gemischte oder unbekannte Waehrung → "—" (kein Raten).

export function formatUsd(v: number): string {
  return '$' + v.toLocaleString('en-US');
}

export function formatNative(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    // Unbekannter ISO-Code — Betrag plus Code statt Absturz.
    return `${amount.toLocaleString(locale)} ${currency}`;
  }
}

export function formatPrize(
  usd: number | null | undefined,
  native: number | null | undefined,
  currency: string | null | undefined,
  locale: string,
): string {
  if (usd != null && usd > 0) return formatUsd(usd);
  if (native != null && native > 0 && currency && currency !== 'MIXED' && /^[A-Z]{3}$/.test(currency)) {
    return formatNative(native, currency, locale);
  }
  return '—';
}
