/**
 * Bild-Adressen auf Leaguepedia (lol.fandom.com) — ein Helfer statt drei Kopien.
 *
 * MediaWiki legt jede Datei in einem Unterordner ab, der aus dem md5 des
 * Dateinamens folgt: `images/<h[0]>/<h[0..1]>/<Name>`. Fehlt der Unterordner,
 * antwortet Fandom mit HTTP 404 — aber MIT einem grauen Platzhalter-JPEG im
 * Body. Ein <img onError> im Browser greift deshalb nie; die Seite zeigt ein
 * graues Rechteck statt des Kuerzel-Felds. Darum: Adresse immer hier bauen und
 * vor dem Speichern per Statuscode pruefen (der Status ist ehrlich, das Bild nicht).
 *
 * Fandom-Abfragen brauchen einen Browser-User-Agent UND einen Referer —
 * ohne Referer antwortet static.wikia.nocookie.net mit 403.
 */
import { createHash } from 'node:crypto';

export const FANDOM_IMAGE_BASE = 'https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/';

export const FANDOM_HEADERS = Object.freeze({
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  Referer: 'https://www.metastats.gg/',
});

/** MediaWiki-Normalform: Leerzeichen → Unterstrich, erster Buchstabe gross. */
export function normalizeFileName(name) {
  const s = String(name ?? '').trim().replace(/^File:/i, '').replace(/ /g, '_');
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Wie PHPs rawurlencode — so schreibt MediaWiki die Adressen (' ( ) ! werden kodiert). */
function rawUrlEncode(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/** `a/a2/T1logo_square.png` fuer `T1logo square.png`. Leerer String bei leerem Namen. */
export function fandomImagePath(fileName) {
  const name = normalizeFileName(fileName);
  if (!name) return '';
  const h = createHash('md5').update(name, 'utf8').digest('hex');
  return `${h[0]}/${h.slice(0, 2)}/${rawUrlEncode(name)}`;
}

/** Volle Bild-Adresse inkl. `/revision/latest` (Form der bestehenden, funktionierenden Logos). */
export function fandomImageUrl(fileName) {
  const p = fandomImagePath(fileName);
  return p ? `${FANDOM_IMAGE_BASE}${p}/revision/latest` : null;
}

/**
 * Leaguepedia-Adresse OHNE md5-Unterordner (`…/images/Name.png`)? Liefert den
 * Dateinamen (dekodiert), sonst null. Genau diese Adressen sind kaputt.
 */
export function flatFandomFileName(url) {
  if (typeof url !== 'string' || !url.startsWith(FANDOM_IMAGE_BASE)) return null;
  const rest = url.slice(FANDOM_IMAGE_BASE.length).split('?')[0].replace(/\/revision\/latest.*$/, '');
  if (!rest || rest.includes('/')) return null;
  try { return decodeURIComponent(rest); } catch { return rest; }
}

/**
 * Prueft, ob Fandom unter der Adresse ein echtes Bild hat.
 * Ergebnis: 'ok' (200 + image/*), 'missing' (404 — Platzhalter), 'error' (alles andere,
 * z. B. Netzfehler, 403, 429, 5xx — vorlaeufig, nicht als „Datei fehlt" werten).
 */
export async function checkFandomImage(url, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  try {
    const r = await fetchImpl(url, { method: 'HEAD', headers: FANDOM_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
    if (r.status === 200 && String(r.headers.get('content-type') || '').startsWith('image/')) return 'ok';
    if (r.status === 404) return 'missing';
    return 'error';
  } catch {
    return 'error';
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Repariert Logos ohne Unterordner in-place: Adresse per md5 neu bauen und
 * pruefen; nur bei 'ok' uebernehmen, sonst logo = null (die Seite zeigt dann
 * das Kuerzel-Feld). Nacheinander, mit Pause — Fandom hoeflich abfragen.
 * Gibt { checked, repaired, nulled, nulledNames } zurueck.
 */
export async function repairFlatFandomLogos(teams, { fetchImpl = fetch, pauseMs = 200, log = () => {} } = {}) {
  const stats = { checked: 0, repaired: 0, nulled: 0, nulledNames: [] };
  for (const t of teams) {
    const file = flatFandomFileName(t.logo);
    if (!file) continue;
    stats.checked++;
    const url = fandomImageUrl(file);
    const res = url ? await checkFandomImage(url, { fetchImpl }) : 'missing';
    if (res === 'ok') {
      t.logo = url;
      stats.repaired++;
    } else {
      // Auch bei 'error': die alte Adresse ist ohne Unterordner in jedem Fall
      // kaputt. null heisst „Kuerzel zeigen"; der naechste Lauf versucht es neu.
      log(`  [Logo] ${t.name}: ${file} -> ${res}, Logo entfernt`);
      t.logo = null;
      stats.nulled++;
      stats.nulledNames.push(t.name);
    }
    if (pauseMs) await sleep(pauseMs);
  }
  return stats;
}
