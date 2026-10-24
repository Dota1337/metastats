// Ursprung fuer Abrufe der Seite auf ihre eigenen Dateien (Sicherheitsdurchsicht
// 24.10.2026). Drei Routen luden tft-assets.json bzw. champion-stats-euw.json
// ueber request.url / request.nextUrl.origin — also ueber den Host-Kopf, den
// der Aufrufer mitschickt. Jetzt nur noch ueber bekannte eigene Hosts, sonst
// ueber die Hauptadresse.

const SITE_ORIGIN = 'https://www.metastats.gg';
const OWN_HOSTS = new Set(
  ['www.metastats.gg', 'metastats.gg', process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]
    .filter((h): h is string => !!h)
    .map(h => h.toLowerCase()),
);
const LOCAL_HOST = /^(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

export function trustedSelfOrigin(url: URL): string {
  const host = url.host.toLowerCase();
  if (OWN_HOSTS.has(host)) return url.origin;
  if (process.env.NODE_ENV !== 'production' && LOCAL_HOST.test(host)) return url.origin;
  return SITE_ORIGIN;
}
