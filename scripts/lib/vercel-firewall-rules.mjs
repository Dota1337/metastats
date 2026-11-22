// Soll-Regeln der Vercel-Firewall mit eingesetzter Box-Adresse.
// Getrennt von scripts/vercel-firewall.mjs, weil das Skript beim Laden schon
// die Vercel-API ruft — so bleibt das Einsetzen ohne Netz testbar.
import { isIP } from 'node:net';

export const BOX_IP_PLACEHOLDER = '${BOX_IP}';

/**
 * Setzt die Box-Adresse in alle Regeln ein. Ohne gueltige IP oder mit uebrig
 * gebliebenem Platzhalter wird abgebrochen — sonst spielte --apply den
 * Platzhalter wortwoertlich ein und die Box verloere ihre Ausnahme.
 * Fehlertexte nennen den Wert nicht.
 * @param {{ rules: unknown[] }} conf
 * @param {string | null | undefined} ip
 */
export function resolveRules(conf, ip) {
  if (!ip || !isIP(ip)) {
    throw new Error('Box-Adresse fehlt oder ist keine IP (HETZNER_HOST oder HETZNER_REFRESH_URL in .env.local)');
  }
  const json = JSON.stringify(conf.rules).split(BOX_IP_PLACEHOLDER).join(ip);
  if (json.includes('${')) throw new Error('firewall.json enthaelt einen unbekannten Platzhalter');
  return JSON.parse(json);
}
