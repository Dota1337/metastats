// Wann muessen die TFT-Spieldaten neu gezogen werden? Reine Entscheidungen, der
// Abruf steht in scripts/tft-data-refresh-check.mjs.
//
// Woher die Regeln kommen (gemessen 01.11.2026):
// - CDragons `content-metadata.json` kippt rund 15 Minuten vor den Daten, und
//   Cloudflare haelt en_us.json bis zu 1 Stunde im Cache. Verlaesslich ist nur das
//   ungecachte Ordner-Listing, und auch das erst, wenn die Datei aelter als der Cache
//   ist. Sonst zoegen wir die alte Datei und hielten sie fuer die neue.
// - Das Listing zeigt UTC (en_us.json: 00:47, Last-Modified 00:47 GMT).

export const LISTING_URL = 'https://raw.communitydragon.org/latest/cdragon/tft/';

const SETTLE_MS = 65 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Aenderungszeit einer Datei aus dem Listing, als ISO-Zeit. Unbekannt: null. */
export function listingStamp(html, file = 'en_us.json') {
  const at = String(html).indexOf(`href="${file}"`);
  if (at < 0) return null;
  const m = /class="date">(\d{4})-([A-Z][a-z]{2})-(\d{2}) (\d{2}):(\d{2})</.exec(String(html).slice(at, at + 400));
  const month = m ? MONTHS.indexOf(m[2]) : -1;
  if (month < 0) return null;
  return new Date(Date.UTC(Number(m[1]), month, Number(m[3]), Number(m[4]), Number(m[5]))).toISOString();
}

const settled = (stamp, nowMs) => nowMs - Date.parse(stamp) >= SETTLE_MS;

/**
 * Stempel fuers neue Bundle. Eine noch frische Datei zaehlt nicht als gezogen: der
 * alte Stempel bleibt, damit die naechste Runde sie sicher holt.
 */
export function nextBundleStamp({ listing, previous, nowMs }) {
  return listing && settled(listing, nowMs) ? listing : previous ?? null;
}

// Samstag 05:30–07:30 UTC laeuft der Wochen-Crawl und zieht die Datenbank-Kurven.
function inWeeklyWindow(now) {
  if (now.getUTCDay() !== 6) return false;
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return minutes >= 330 && minutes < 450;
}

// Einmal am Tag auch ohne erkennbare Aenderung, wegen der tactics.tools-Texte, die
// keinen Zeitstempel haben. Fenster statt Minute, weil GitHub Zeitplaene verspaetet.
function inDailySlot(now) {
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return minutes >= 510 && minutes < 690;
}

/** Soll diese Runde laufen? Rueckgabe: { run, reasons }. */
export function decideRefresh({ now, manual, listing, bundleStamp, notesHash, bundleNotesHash, previousConclusion, cdragonDown = false }) {
  if (manual) return { run: true, reasons: ['von Hand gestartet'] };
  if (inWeeklyWindow(now)) return { run: false, reasons: ['Wochen-Crawl laeuft'] };
  const reasons = [];
  if (previousConclusion === 'failure') reasons.push('letzter Lauf rot');
  // Ausfall-Laeufe enden gruen (tft-cdragon-outage.mjs), „letzter Lauf rot“ greift dann
  // nicht mehr: das offene Ausfall-Issue ist der Grund fuer den naechsten Versuch.
  if (cdragonDown) reasons.push('CommunityDragon zuletzt nicht erreichbar');
  if (listing && listing !== bundleStamp && settled(listing, now.getTime())) reasons.push(`CDragon neu (${listing})`);
  if (notesHash && notesHash !== bundleNotesHash) reasons.push('Riots Notes geaendert');
  if (inDailySlot(now)) reasons.push('Tageslauf');
  return { run: reasons.length > 0, reasons };
}

/**
 * Patchtag vorbei und CDragon traegt noch den Stand von davor? Dann helfen auch die
 * Korrekturen nur teilweise. Riot liefert am Patchtag bis ca. 09:40 UTC.
 */
export function patchDayAlarm({ meta, livePatch, bundleStamp, now }) {
  const start = Object.values(meta?.patchStarts ?? {}).find(s => s?.patch === livePatch);
  if (!start?.from_day || !bundleStamp) return null;
  if (now.getTime() < Date.parse(`${start.from_day}T12:00:00Z`)) return null;
  if (bundleStamp >= `${start.from_day}T00:00:00.000Z`) return null;
  return `Patch ${livePatch} laeuft seit ${start.from_day}, die CDragon-Daten sind vom ${bundleStamp.slice(0, 10)}`;
}
