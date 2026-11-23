// Route-Spiegel (publish-route-mirrors.mjs): einen Timer-Lauf auslassen, wenn
// die Dateien der Gruppe gerade erst geschrieben wurden.
//
// Anlass (gemessen 23.11.2026): mv-pages laeuft nach jedem Marktwert-Sync
// (OnSuccess=) UND 2,5 h spaeter per Ersatz-Timer — der zweite Lauf rechnet die
// unveraenderten Supabase-Daten noch einmal (2 RPCs, 2.894 s und 10,4 Mio.
// gelesene Bloecke in 5,2 Tagen fuer beide Laeufe zusammen). Der Timer soll nur
// einspringen, wenn der Abgleich gescheitert ist — dann sind die Dateien alt.
//
// Erkennung ueber TRIGGER_UNIT (systemd >= 251 setzt sie bei Timer-Start; auf
// der Box gemessen: systemd 255). Fehlt sie, laeuft alles wie bisher.

export function parseSkipMinutes(args) {
  const a = args.find((x) => x.startsWith('--timer-skip-if-fresh='));
  if (!a) return null;
  const n = Number(a.slice('--timer-skip-if-fresh='.length));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function isTimerStart(env = process.env) {
  return /\.timer$/.test(String(env.TRIGGER_UNIT || ''));
}

/**
 * ages: [{ name, ageMs }] je Spiegel der Gruppe, ageMs = null wenn unbekannt.
 * Auslassen nur, wenn ALLE bekannt und juenger als minutes sind.
 */
export function timerSkipDecision({ minutes, env = process.env, ages }) {
  if (!minutes) return { skip: false, reason: 'Option nicht gesetzt' };
  if (env.ROUTE_MIRROR_TIMER_SKIP === '0') return { skip: false, reason: 'Schalter ROUTE_MIRROR_TIMER_SKIP=0' };
  if (!isTimerStart(env)) return { skip: false, reason: 'kein Timer-Start' };
  if (!Array.isArray(ages) || ages.length === 0) return { skip: false, reason: 'keine Spiegel' };
  const limit = minutes * 60_000;
  for (const a of ages) {
    if (a.ageMs == null || !Number.isFinite(a.ageMs) || a.ageMs < 0) return { skip: false, reason: `${a.name}: Alter unbekannt` };
    if (a.ageMs >= limit) return { skip: false, reason: `${a.name}: ${Math.round(a.ageMs / 60_000)} min alt` };
  }
  const oldest = Math.max(...ages.map((a) => a.ageMs));
  return { skip: true, reason: `alle ${ages.length} Spiegel juenger als ${minutes} min (aeltester ${Math.round(oldest / 60_000)} min)` };
}
