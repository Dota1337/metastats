// Adresse der Hetzner-Box fuer lokale Werkzeuge (ssh, Firewall-Abgleich).
// Steht seit 22.11.2026 nirgends mehr im Code, weil das Repo oeffentlich ist:
// Quelle ist HETZNER_HOST, sonst der Host-Teil von HETZNER_REFRESH_URL
// (.env.local). Kein Rueckfall auf eine eingebaute Adresse.
// Fehler beim Zerlegen der URL werden geschluckt: ihr Text enthaelt den Wert.

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {string | null}
 */
export function boxHost(env = process.env) {
  const direct = (env.HETZNER_HOST || '').trim();
  if (direct) return direct;
  const url = (env.HETZNER_REFRESH_URL || '').trim();
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return host || null;
  } catch {
    return null;
  }
}
