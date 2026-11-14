import type { TranslationKey } from './i18n';

// Fehlercodes aus /auth/callback und /auth/riot/callback (?error=…) → Text.
// Nur bekannte Codes bekommen einen eigenen Text, alles andere den allgemeinen;
// fremder Text aus der Adresse wird nie angezeigt.
const KEYS: Record<string, TranslationKey> = {
  riot_off: 'auth.err.riot_off',
  riot_denied: 'auth.err.riot_denied',
  state: 'auth.err.state',
  exchange: 'auth.err.exchange',
  account: 'auth.err.account',
  conflict: 'auth.err.conflict',
  has_other: 'auth.err.has_other',
  already_signed_in: 'auth.err.already_signed_in',
  oauth: 'auth.err.oauth',
};

export function authErrorKey(code: string): TranslationKey {
  return Object.prototype.hasOwnProperty.call(KEYS, code) ? KEYS[code] : 'auth.err.generic';
}
