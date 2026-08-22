// Aktuelle TFT-Set-Nummer fuer den App-/Browser-Pfad.
//
// Bewusst als JSON-Import, nicht als fs-Read — dasselbe Muster wie
// app/lib/tft-patch-label.ts:11. Gruende:
//   - funktioniert im Browser-Bundle UND in Server-Components/Routes,
//   - kein Verlass auf Next' File-Tracing fuer public/ in Vercel-Functions
//     (outputFileTracingIncludes ist in next.config nicht gesetzt),
//   - kein Laufzeit-I/O auf einem Pfad, der pro Request laeuft.
//
// Preis: der Wert ist build-zeit-gebacken. Das ist hier kein Nachteil —
// public/tft-set.json aendert sich ausschliesslich per Commit aus dem
// Daily-Crawl, und dieser Commit loest ohnehin einen Vercel-Deploy aus.
//
// Die Quelle ist tft-set.json und NICHT tft-assets.json: nur erstere kennt das
// Bump-Gate aus detect-tft-set.mjs und bleibt bis zum Live-Go auf dem alten
// Set stehen. Ausfuehrliche Begruendung in scripts/lib/current-set.mjs.

// `with { type: 'json' }` ist Pflicht, nicht Kosmetik: ohne das Attribut
// bricht jeder node --test-Lauf, der diese Datei ueber den TS-Hook zieht
// (ERR_IMPORT_ATTRIBUTE_MISSING). Webpack/SWC ist es egal, Node ESM nicht.
import tftSet from '../../public/tft-set.json' with { type: 'json' };

const resolved: unknown = (tftSet as { setNumber?: unknown }).setNumber;

if (typeof resolved !== 'number') {
  // Build-Zeit-Fehler, nicht Laufzeit: faellt beim naechsten `next build` auf,
  // nicht erst im Betrieb mit stillschweigend falschen Cluster-Keys.
  throw new Error(
    '[current-set] public/tft-set.json hat kein numerisches setNumber — '
    + 'ohne aktuelles Set ist jede Klassifikation falsch.',
  );
}

export const CURRENT_SET: number = resolved;

// Marketing-Name des Sets ("Space Gods"), sofern Riot ihn schon veroeffentlicht
// hat. detect-tft-set.mjs traegt bewusst KEINEN geratenen Namen ein und faellt
// auf `Set N` zurueck (scripts/detect-tft-set.mjs:20-33,200). Genau dieser
// Fallback darf nicht als Name durchgereicht werden — sonst steht in der
// TFT-Kopfzone ab dem Set-18-Bump am 26.08. "Set 18 · Set 18".
//
// `null` heisst also: es gibt noch keinen Namen, nicht "Name fehlt kaputt".
const rawName: unknown = (tftSet as { setName?: unknown }).setName;
const trimmedName = typeof rawName === 'string' ? rawName.trim() : '';
const isFallbackName =
  trimmedName === `Set ${CURRENT_SET}` || trimmedName === `Set${CURRENT_SET}`;

export const CURRENT_SET_NAME: string | null =
  trimmedName && !isFallbackName ? trimmedName : null;

/** "Set 17 · Space Gods" — oder nur "Set 17", solange kein Name veroeffentlicht ist. */
export const CURRENT_SET_LABEL: string = CURRENT_SET_NAME
  ? `Set ${CURRENT_SET} · ${CURRENT_SET_NAME}`
  : `Set ${CURRENT_SET}`;
