// Build-time Feature-Flags.
//
// Bewusst Konstanten und keine Env-Vars: diese Flags müssen auch Client-
// Komponenten erreichen (z.B. Nav), dort greift nur `NEXT_PUBLIC_*` — und das
// wird beim Build inlined. Ein Env-Var gäbe hier also keinen Laufzeit-Vorteil
// gegenüber einer Konstante, kostet aber einen Vercel-Handgriff und macht den
// Zustand im Repo unsichtbar.
//
// Server-only-Flags, die man ohne Deploy umlegen können soll, gehören
// weiterhin in Env-Vars — siehe `INTERNAL_DASHBOARD_ENABLED` in internal-auth.ts.

/**
 * TFT-Chat-Coach (`/tft/coach` + `POST /api/coach/chat`).
 *
 * Deaktiviert am 2026-08-04: ungenutztes Feature, aber ein öffentlicher
 * POST-Endpoint mit kostenpflichtiger Anthropic-Inferenz dahinter. Das
 * In-Memory-Rate-Limit greift nur pro Lambda-Instanz und ist damit nicht dicht.
 *
 * Zum Reaktivieren: auf `true` setzen und deployen. Es hängen drei Stellen
 * daran — Route (404-Guard), Nav-Link, Page (notFound). Die i18n-Keys
 * `nav.coach` / `tft.coach.*` sind absichtlich stehen geblieben.
 *
 * Voraussetzung fürs Wiedereinschalten: `ANTHROPIC_API_KEY` in Vercel gesetzt,
 * sonst antwortet die Route mit 503.
 */
export const TFT_COACH_ENABLED = false;

/**
 * TFT-Pro-Spieler-Verzeichnis (`/tft/pros`).
 *
 * Deaktiviert am 2026-08-27: die Quellen hinter dem Verzeichnis (Liquipedia,
 * EsportsEarnings, TPC-Roster) liefern nicht zuverlaessig genug, um eine
 * oeffentliche Seite damit zu fuellen — angezeigt wurden teils leere oder
 * veraltete Roster.
 *
 * Zum Reaktivieren: auf `true` setzen und deployen. Es haengen drei Stellen
 * daran — Nav-Link (Desktop + Mobil), Page (notFound), Sitemap-Eintrag. Die
 * i18n-Keys `nav.tftPros` / `tft.pros.*` bleiben absichtlich stehen: die
 * Spalten-Keys `tft.pros.col.*` werden auch von der TFT-Rangliste und den
 * Turnierseiten benutzt.
 *
 * Die `/api/tft/pros*`-Endpoints bleiben bewusst aktiv — sie versorgen die
 * Comp-Detailseite, die Spielerseite und die Turnierseiten.
 */
export const TFT_PROS_ENABLED = false;
