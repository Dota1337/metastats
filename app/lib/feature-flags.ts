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
 *
 * Nachtrag 2026-09-01: die Datensammlung dahinter ist stillgelegt. User-Wort:
 * "Wir benoetigen logischerweise keine Daten dafuer, wenn wir es nicht aktiv
 * als Reiter haben." Konkret sind der Sonntags-Workflow
 * (.github/workflows/tft-pro-crawl-weekly.yml, nur noch workflow_dispatch) und
 * die vier Box-Units metastats-tft-pro-* abgeschaltet. Die Endpoints und die
 * vorhandenen Zeilen bleiben, sie werden aber nicht mehr nachgefuehrt: neue
 * Pros tauchen nicht mehr auf, zurueckgetretene bleiben stehen.
 *
 * Deshalb ist im selben Zug der Filter "nur Pro" aus der Filterleiste
 * entfernt worden (app/components/tft/StatsFilterBar.tsx) — er haette sonst
 * weiter Zahlen zu einem einfrierenden Kader angezeigt, ohne dass man das
 * sieht. Serverseitig bleibt `bucket=pro_pool` gueltig, alte Lesezeichen
 * brechen also nicht.
 */
export const TFT_PROS_ENABLED = false;

/**
 * TFT ist die Hauptseite, LoL die Zweitseite (seit 2026-10-15).
 *
 * User-Wort: "Setze TFT als Hauptseite und League of Legends als Zweitseite,
 * bis wir den Key für LoL erhalten." Der LoL-Riot-Key ist ein 24-h-
 * Entwicklerschluessel; ein dauerhafter ist beantragt.
 *
 * An: `/` leitet per 307 auf die TFT-Comps-Uebersicht (next.config.ts), die
 * LoL-Startseite steht unter `/lol`, im Spiel-Streifen steht TFT links.
 * Alle Leser holen die Ziele aus app/lib/games.ts (TFT_HOME, lolHome()).
 *
 * Zum Zuruecknehmen, sobald der dauerhafte LoL-Key da ist: auf `false` setzen
 * und deployen. Dann leitet `/lol` per 307 auf `/`. Von Hand zurueck:
 * infra/contracts.json Vertrag seo/detail-404 — Probe `/` und `/en` aus
 * expectRedirect entfernen, expectLangLinks `/fr/lol` wieder auf `/fr`.
 * Nur 307, nie 308: eine gemerkte 308 liesse sich nicht mehr zuruecknehmen.
 */
export const TFT_IS_HOME = true;

/**
 * Feld-Zahlen im Comp-Builder (seit 2026-10-26): beim Ziehen oder Antippen einer
 * Unit stehen auf jedem leeren Feld Haeufigkeit und Top-4-Quote dieser Unit auf
 * diesem Feld, die Felder sind nach Haeufigkeit golden eingefaerbt. User-Wunsch
 * nach dem Vorbild des MetaTFT-Team-Builders; Daten aus
 * public/tft-metatft-cells-{set}.json (scripts/refresh-metatft-cells.mjs).
 *
 * Aus: der Builder laedt die Datei nicht und zeigt nichts. Danach optional
 * Workflow-Schritt, Skript, Datei und Vertrag metatft-cells/datei-frische entfernen.
 */
export const TFT_BUILDER_CELL_STATS_ENABLED = true;

/**
 * Spieler-Bewertung im Spielervergleich /tft/compare (Plan 2026-10-26, Vorlage
 * „TFT Player Scoring Framework — API edition"): 5 Hauptwerte aus 13
 * Unterwerten, 0–100, 50 = typisch unter den bewerteten Spielern. Rechnet auf
 * der Box (/player-scoring), Bezugswerte naechtlich
 * (metastats-player-scoring.timer), Lobbys aller 8 ab LOBBY_CAPTURE=1.
 *
 * Aus: Route /api/tft/player-scoring antwortet 404, der Block faellt weg.
 * Danach optional Timer abschalten, LOBBY_CAPTURE=0, Vertraege entfernen.
 */
export const TFT_PLAYER_SCORING_ENABLED = true;
