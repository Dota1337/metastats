// Schalter und feste Adressen der Riot-Anmeldung (Riot Sign-On, RSO).
//
// An ist sie nur, wenn Riot uns Zugangsdaten gegeben hat UND das eigene
// Geheimnis gesetzt ist — vorher gibt es keinen Knopf und /auth/riot/* antwortet
// 404. Notschalter: RIOT_RSO_ENABLED=0 (Vercel, danach neu deployen).
//
// Variablen (nur Server):
//   RIOT_RSO_CLIENT_ID, RIOT_RSO_CLIENT_SECRET  — von Riot nach der Freigabe
//   RIOT_RSO_LINK_SECRET — eigenes Geheimnis fuer das Ablauf-Cookie, die
//     Platzhalter-Adresse und die Konto-Kennung. NIE drehen: die Wiederaufnahme
//     einer halb angelegten Anmeldung haengt daran (logic-flow-critic 14.11.2026).
//
// Rueckleit-Adressen sind fest und muessen 1:1 im Riot-Formular stehen. Sie
// werden nie aus dem Host-Kopf gebaut; ein fremder Host (Vercel-Vorschau)
// bekommt 404, weil Riot dorthin ohnehin nicht zurueckleitet.

const ORIGINS: Record<string, string> = {
  'www.metastats.gg': 'https://www.metastats.gg',
};
const LOCAL_HOST = 'local.metastats.gg';

export type RsoConfig = {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  linkSecret: string;
};

export function rsoConfig(): RsoConfig {
  const clientId = process.env.RIOT_RSO_CLIENT_ID || '';
  const clientSecret = process.env.RIOT_RSO_CLIENT_SECRET || '';
  const linkSecret = process.env.RIOT_RSO_LINK_SECRET || '';
  const enabled = !!clientId && !!clientSecret && linkSecret.length >= 32 && process.env.RIOT_RSO_ENABLED !== '0';
  return { enabled, clientId, clientSecret, linkSecret };
}

export function riotRsoEnabled(): boolean {
  return rsoConfig().enabled;
}

/** Herkunft fuer Rueckleitung und Weiterleitungen, oder null fuer fremde Hosts.
 *  local.metastats.gg nur ausserhalb von Vercel (lokaler Test mit https). */
export function rsoOrigin(host: string | null | undefined): string | null {
  const h = (host || '').toLowerCase();
  if (ORIGINS[h]) return ORIGINS[h];
  if (h === LOCAL_HOST && !process.env.VERCEL_ENV) return `https://${LOCAL_HOST}`;
  return null;
}
