// Was das Ops-Dashboard (/internal/3d-ops) ueber jeden Dienst der Box wissen
// muss: welche Art er ist, wie lange sein letzter Lauf hoechstens zurueckliegen
// darf, und ein Satz in Alltagssprache, wofuer es ihn gibt.
//
// Eine Liste fuer Route und Graph. Vorher lagen Fristen in der Ops-Route und
// Texte im Graphen, beide von Hand — am 24.10.2026 fehlten 16 Live-Dienste in
// den Fristen und 19 im Text (ohne Frist gilt ein Dienst ewig als gesund).
// ops-services.test.mjs prueft deshalb gegen infra/system-map.json: jede
// Service-Unit hat einen Eintrag, jeder Eintrag ist eine Unit, und keine Frist
// ist kuerzer als die groesste Luecke im Zeitplan ihres Timers.
//
// Zeiten stehen bewusst nicht im Text: der Zeitplan kommt aus der Karte und
// wird im Detail-Fenster in deutscher Zeit angezeigt.

export type OpsServiceKind =
  /** Laeuft dauerhaft — gesund nur, solange er aktiv ist. */
  | 'persistent'
  /** Einzellauf nach Zeitplan oder Kette — Frist in maxAgeMs. */
  | 'oneshot'
  /** Laeuft nur auf Anstoss (Schluesselwechsel, Waechter) — keine Frist. */
  | 'event'
  /** Bewusst abgeschaltet (Timer aus/maskiert) — grau statt "verzoegert". */
  | 'retired'
  /** Vorbereitet, auf der Box noch nicht eingerichtet. */
  | 'prepared';

export interface OpsService {
  kind: OpsServiceKind;
  maxAgeMs?: number;
  text: string;
}

const MIN = 60 * 1000;
const H = 60 * MIN;

// Dienste, die am Tageslauf haengen: der Lauf dauert unterschiedlich lang
// (23.10.2026: 05:45 bis 20:24 UTC), also schwankt auch der Abstand zwischen
// zwei Laufenden. 26 h wuerde an langen Tagen faelschlich "verzoegert" zeigen.
const CRAWL_CHAIN = 30 * H;

export const OPS_SERVICES: Record<string, OpsService> = {
  'metastats-refresh-api.service': { kind: 'persistent', text:
    'Dauerdienst der Box. Beantwortet die Knoepfe "Aktualisieren" auf den Spielerseiten: holt neue Partien, schreibt sie in den Partien-Speicher der Box und rechnet den Marktwert neu. Reicht Anfragen des Data Explorers an dessen Abfrage-Dienst weiter. Erreichbar verschluesselt mit eigenem Zertifikat, dem nur die eigenen Aufrufer vertrauen.' },
  'metastats-explorer-api.service': { kind: 'persistent', text:
    'Dauerdienst des Data Explorers. Beantwortet dessen Abfragen aus einem eigenen Analyse-Speicher, nur von der Box selbst erreichbar.' },

  'metastats-daily-crawl.service': { kind: 'oneshot', maxAgeMs: CRAWL_CHAIN, text:
    'Der Tageslauf. Holt die Partien aller Raenge in allen 15 aktiven Regionen und schreibt daraus die Tageswerte fuer Comps, Units, Items und Traits. Dauert rund 15 Stunden. Am Ende stoesst er die Vorab-Seiten, den Data-Explorer-Speicher, die Nachhol-Pruefung und den Marktwert-Lauf an.' },
  'metastats-daily-crawl-resume.service': { kind: 'event', text:
    'Nachhol-Lauf. Holt nur die Regionen nach, die im Tageslauf fehlen, und setzt am gespeicherten Stand fort. Wird von den Waechtern gestartet, nicht nach Zeitplan.' },
  'metastats-daily-crawl-catchup.service': { kind: 'oneshot', maxAgeMs: CRAWL_CHAIN, text:
    'Laeuft direkt nach dem Tageslauf. Prueft, ob noch Regionen offen sind oder ob der naechste Termin schon verstrichen ist, und startet dann sofort den Nachhol- bzw. Tageslauf, damit kein Tag fehlt.' },
  'metastats-daily-crawl-watchdog.service': { kind: 'oneshot', maxAgeMs: 20 * H, text:
    'Waechter fuer den Tageslauf. Schaut dreimal ab dem spaeten Nachmittag, ob Regionen fehlen, und startet dann den Nachhol-Lauf — aber nur, wenn gerade nichts anderes laeuft.' },
  'metastats-snapshot-publisher.service': { kind: 'oneshot', maxAgeMs: CRAWL_CHAIN, text:
    'Baut nach dem Tageslauf die Vorab-Antworten der Statistik-Seiten (Comps, Units, Items, Traits, Comp-Details) und legt sie als Dateien ab. Die Seiten lesen zuerst dort und sind dadurch schnell und auch bei einem Datenbank-Ausfall noch da. Dauert rund 2 Stunden.' },
  'metastats-explorer-build.service': { kind: 'oneshot', maxAgeMs: 26 * H, text:
    'Fuehrt den Analyse-Speicher des Data Explorers nach: naechtlich, sonntags ein zweites Mal und zusaetzlich am Ende jedes Tageslaufs.' },

  'metastats-marketvalue-snapshot.service': { kind: 'oneshot', maxAgeMs: CRAWL_CHAIN, text:
    'Der taegliche TFT-Marktwert-Lauf nach dem Tageslauf. Rechnet fuer alle Spieler ab Diamond 2 in allen aktiven Regionen den Marktwert und schreibt ihn in die Datenbank der Box. Laeuft viele Stunden; ein abgebrochener Lauf setzt dort fort, wo er stand.' },
  'metastats-marketvalue-sync.service': { kind: 'oneshot', maxAgeMs: 8 * H, text:
    'Spiegelt die neuen Marktwerte alle 6 Stunden von der Datenbank der Box nach Supabase, von wo die Seite sie liest.' },
  'metastats-marketvalue-watchdog.service': { kind: 'oneshot', maxAgeMs: 22 * H, text:
    'Waechter fuer den Marktwert. Prueft am Abend je Region, ob ein aktueller Marktwert-Tag da ist, und startet sonst den Marktwert-Lauf fuer die fehlenden Regionen.' },
  'metastats-marketvalue-peaks.service': { kind: 'oneshot', maxAgeMs: 8 * H, text:
    'Haelt alle 6 Stunden die Hoechstwerte fest: je Spieler den besten Marktwert eines TFT-Sets bzw. LoL-Splits, samt der ganzen Rechnung dahinter.' },
  'metastats-crawler.service': { kind: 'retired', text:
    'Alter Marktwert-Durchlauf. Seit Juni 2026 abgeschaltet (Zeitplan gesperrt), abgeloest durch den taeglichen Marktwert-Lauf. Bleibt nur fuer Hand-Tests.' },

  'metastats-tft-ladder.service': { kind: 'oneshot', maxAgeMs: 26 * H, text:
    'Holt einmal am Tag die TFT-Rangliste von Smaragd bis Challenger fuer die Aufsteiger-Seite und ergaenzt dabei die Partien im Speicher der Box.' },
  'metastats-player-scoring.service': { kind: 'prepared', text:
    'Spieler-Bewertung im Spielervergleich. Traegt nachts die Raenge der Mitspieler in die gespeicherten Lobbys ein und berechnet daraus die Vergleichswerte, an denen jeder Spieler gemessen wird (50 = typisch unter den bewerteten Spielern).' },
  'metastats-mirror-rising.service': { kind: 'oneshot', maxAgeMs: 26 * H, text:
    'Legt die Aufsteiger-Seite in ihren 48 Ansichten als fertige Dateien ab, direkt nach der Rangliste und zur Sicherheit zwei Stunden spaeter noch einmal.' },
  'metastats-mirror-leaderboard.service': { kind: 'oneshot', maxAgeMs: 30 * MIN, text:
    'Legt alle 10 Minuten die erste Seite der Rangliste als fertige Datei ab, damit sie ohne Datenbank-Abfrage laedt.' },
  'metastats-mirror-regions.service': { kind: 'oneshot', maxAgeMs: 4 * H, text:
    'Legt alle 3 Stunden die Regionen-Seite in ihren 12 Ansichten als fertige Dateien ab.' },
  'metastats-mirror-ligen.service': { kind: 'oneshot', maxAgeMs: H, text:
    'Legt alle 30 Minuten den LoL-Spielplan und die Ligen-Uebersicht als fertige Datei ab.' },
  'metastats-mirror-mv-pages.service': { kind: 'oneshot', maxAgeMs: 8 * H, text:
    'Legt nach jedem Marktwert-Abgleich die Top 100 des TFT-Marktwerts samt Verlaeufen je Region als fertige Dateien ab, zur Sicherheit zusaetzlich alle 6 Stunden. Damit bringt die Seite ihre Liste gleich mit.' },
  'metastats-mirror-slow-pages.service': { kind: 'oneshot', maxAgeMs: 4 * H, text:
    'Legt alle 3 Stunden den LoL-Marktwert, die TFT-Turniere und die Kennzahlen der LoL-Startseite als fertige Dateien ab.' },
  'metastats-mirror-lol-leaderboard.service': { kind: 'oneshot', maxAgeMs: H, text:
    'Legt alle 30 Minuten und nach jedem Riot-Key-Wechsel die erste Seite der LoL-Rangliste (EUW Challenger) als fertige Datei fuer die Seite ab.' },
  'metastats-meta-pulse-diffs.service': { kind: 'oneshot', maxAgeMs: 3 * H, text:
    'Rechnet stuendlich die Patch-Vergleiche und Patch-Gewinner fuer die Meta-Pulse-Seite vor. Live waeren sie fuer die Datenbank zu langsam.' },
  'metastats-tft-live-standings.service': { kind: 'oneshot', maxAgeMs: 3 * H, text:
    'Holt stuendlich die Zwischenstaende laufender TFT-Turniere aus den offiziellen Tabellen, nur fuer Turniere, die gerade laufen.' },

  'metastats-companion-backfill.service': { kind: 'oneshot', maxAgeMs: 30 * MIN, text:
    'Alle 10 Minuten. Ergaenzt die Aufstellungen aus der Companion-App um Platzierung und echte Partie-Nummer, sobald Riot die Partie freigibt. Loescht Eintraege, die nach 48 Stunden noch offen sind.' },
  'metastats-position-aggregator.service': { kind: 'oneshot', maxAgeMs: 30 * MIN, text:
    'Alle 15 Minuten. Fasst die Aufstellungen aus der Companion-App zu den Positions-Karten der Comp-Seiten zusammen und ersetzt danach den Spielernamen durch ein Pseudonym.' },

  'metastats-lol-builds.service': { kind: 'oneshot', maxAgeMs: 8 * H, text:
    'Alle 6 Stunden. Verdichtet die gesammelten LoL-Partien zu den Champion-Builds je Rang und schreibt sie nach Supabase.' },
  'metastats-lol-builds-publish.service': { kind: 'oneshot', maxAgeMs: 8 * H, text:
    'Laeuft nach den LoL-Builds und legt deren Standardansicht als fertige Dateien ab.' },
  'metastats-lol-matchfill.service': { kind: 'event', text:
    'Sammelt LoL-Partien je Spieler in eine dauerhafte Ablage. Startet nach jedem Wechsel des LoL-Schluessels, der taeglich ablaeuft.' },
  'metastats-lol-marketvalue.service': { kind: 'event', text:
    'LoL-Marktwert der Top-Spieler. Startet nach einem Wechsel des LoL-Schluessels, rechnet aber hoechstens etwa einmal pro Woche wirklich neu.' },

  'metastats-contracts.service': { kind: 'oneshot', maxAgeMs: 26 * H, text:
    'Naechtlicher Waechter. Prueft fuer jede Pipeline, ob sie geliefert hat, was sie verspricht (frische Tage, genug Zeilen, richtige Saison), Bei einer Abweichung schlaegt der Dienst fehl.' },
  'metastats-health.service': { kind: 'oneshot', maxAgeMs: 10 * MIN, text:
    'Alle 5 Minuten. Prueft, ob die Seite und die Datenbank antworten. Faellt die Datenbank zweimal in Folge aus, stoesst er dort einen Neustart an (hoechstens viermal am Tag) und meldet es.' },
  'metastats-build-check.service': { kind: 'oneshot', maxAgeMs: 20 * MIN, text:
    'Alle 10 Minuten. Prueft, ob der letzte Bau der Seite geklappt hat. Ist er gescheitert und frisch, startet er ihn einmal neu (hoechstens dreimal am Tag).' },
  'metastats-deps-catchup.service': { kind: 'oneshot', maxAgeMs: 26 * H, text:
    'Taeglich vor dem Tageslauf. Spielt neue Programm-Pakete auf der Box nach, wenn sich die Paketliste geaendert hat — aber nur, wenn gerade nichts laeuft.' },
  'metastats-phase1-probe.service': { kind: 'oneshot', maxAgeMs: 26 * H, text:
    'Taegliche Messung, wie vollstaendig und puenktlich die Tageswerte ankommen. Schreibt nur ein Protokoll, aendert nichts.' },

  'metastats-tft-pro-validator.service': { kind: 'retired', text:
    'TFT-Pro-Pruefung. Seit dem 01.09.2026 stillgelegt (Zeitplan aus); die Daten bleiben erhalten.' },
  'metastats-tft-pro-fullsync.service': { kind: 'retired', text:
    'Woechentlicher TFT-Pro-Abgleich. Seit dem 01.09.2026 stillgelegt (Zeitplan aus); die Daten bleiben erhalten.' },
  'metastats-tft-pro-tpc-roster.service': { kind: 'retired', text:
    'Abgleich der offiziellen Pro-Circuit-Kader. Seit dem 01.09.2026 stillgelegt (Zeitplan aus); die Daten bleiben erhalten.' },
  'metastats-tft-pro-classify.service': { kind: 'retired', text:
    'Einordnung der TFT-Pros nach Region und Liga. Seit dem 01.09.2026 stillgelegt; lief nur im Anschluss an den Kader-Abgleich.' },
};

// Snapshot-Manifest: der Publisher laeuft taeglich, ab 26 h ist ein Lauf
// ausgefallen (gelb). Rot erst ab dem Wert, den der Vertrag
// snapshot/manifest-frische erlaubt (maxAgeDays 3) — der Test haelt beide gleich.
export const MANIFEST_STALE_MS = 26 * H;
export const MANIFEST_FAILED_MS = 72 * H;
