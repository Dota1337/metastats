// Snapshot-Lookup für vorgerenderte API-Responses, ausgeliefert via Vercel-Blob.
//
// Pattern: der nightly Crawler-Hook auf Hetzner schreibt JSON-Files mit den
// Hot-Path-Permutationen aus snapshot-matrix.ts nach Vercel-Blob. Das Manifest
// (Liste aller verfügbaren Snapshots + Build-Time) liegt unter einer stabilen
// public URL — API-Routes laden es einmal pro Prozess (5min TTL) und fetchen
// die einzelnen Snapshots on-demand. Vercel-Edge-Cache cacht beide.
//
// Reads gehen über fetch() statt FS, weil Blob ein externer Storage ist —
// das kostet 30-80ms intra-Region (Vercel-Function → Vercel-Blob), spart aber
// jedes Mal eine schwere Supabase-RPC. Bei 6h Edge-TTL trifft das nur den
// ersten User pro Cache-Cycle.

import { addDays, compFamilySnapshotKey, snapshotKey, normalizeSnapshotRequest, type SnapshotEndpoint } from './snapshot-matrix';

const MANIFEST_URL_BASE = process.env.SNAPSHOT_MANIFEST_URL || '';
const MANIFEST_TTL_MS = 5 * 60 * 1000;
const SNAPSHOT_FETCH_TIMEOUT_MS = 3000;

interface ManifestEntry {
  key: string;       // logischer Pfad analog snapshotKey()
  url: string;       // public URL auf Vercel-Blob
  bytes: number;     // size, zur Diagnose
  builtAt: string;   // ISO timestamp des Publishers
  // Nur comps-detail: der Stand hat Luecken (Ergebnis-Block oder Gegner fehlen,
  // weil eine Teilabfrage ihr Zeitlimit riss). Der Publisher entscheidet damit,
  // welcher Stand einen Schluessel bekommt; der Lesepfad ignoriert es.
  partial?: boolean;
}

interface SnapshotManifest {
  version: string;
  builtAt: string;
  patches: { current: string; previous: string | null };
  // Endtag, mit dem der Publisher gerechnet hat (volle Tage, 15.10.2026).
  // Fehlt bei Manifesten von vor der Umstellung.
  dataThrough?: string | null;
  entries: Record<string, ManifestEntry>;
}

let _manifest: { ts: number; data: SnapshotManifest | null } | null = null;
let _inflight: Promise<SnapshotManifest | null> | null = null;

async function loadManifest(): Promise<SnapshotManifest | null> {
  if (!MANIFEST_URL_BASE) return null;
  if (_manifest && Date.now() - _manifest.ts < MANIFEST_TTL_MS) return _manifest.data;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), SNAPSHOT_FETCH_TIMEOUT_MS);
      // Cache-Bust per minute: edge serves stale up to a minute, the function
      // process re-validates 5min. Together: a freshly published manifest
      // propagates to all functions within ~1min.
      const sep = MANIFEST_URL_BASE.includes('?') ? '&' : '?';
      const res = await fetch(`${MANIFEST_URL_BASE}${sep}_min=${Math.floor(Date.now() / 60000)}`, {
        signal: ctrl.signal,
        cache: 'no-store',
      });
      clearTimeout(t);
      if (!res.ok) {
        _manifest = { ts: Date.now(), data: null };
        return null;
      }
      const data = (await res.json()) as SnapshotManifest;
      _manifest = { ts: Date.now(), data };
      return data;
    } catch {
      // Stale-serve: an inflight manifest fetch must never blank a stats page.
      // If we ever had a successful manifest, keep using it; otherwise null →
      // route falls through to live RPC.
      _manifest = _manifest ?? { ts: Date.now(), data: null };
      return _manifest.data;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

/** Bauzeit + Endtag des Manifests fuer den Endtag der Besucher (resolveDataEnd). */
export async function loadManifestWindow(): Promise<{ builtAt: string | null; dataThrough: string | null } | null> {
  const m = await loadManifest();
  if (!m) return null;
  return { builtAt: m.builtAt ?? null, dataThrough: m.dataThrough ?? null };
}

export interface LookupOptions {
  patch: string | null;
  region: string;
  days: number;
  bucket: string;
  minGames: number;
  // Set-Nummer, auf die der Request gepinnt ist (null = setuebergreifend).
  // Der Snapshot-Key kennt keine Set-Achse — die Semantik eines Blobs kann sich
  // also aendern, ohne dass sich sein Key aendert. Genau das ist am 2026-08-27
  // passiert: unter dem frischen Patch-Key 18.1 lagen reine Set-17-Payloads.
  // Deshalb pruefen wir das Set gegen den Payload statt uns auf den Key zu
  // verlassen.
  setNumber: number | null;
  // Nur fuer endpoint='comps-detail': cluster_key der angefragten Comp.
  slug?: string;
  // Nur fuer endpoint='comps-detail': statt des Slug-Schluessels den Vorrat
  // dieser Familie lesen (compFamilySnapshotKey). Die Mitgliedschaft prueft
  // app/lib/comp-detail-snapshot.ts — direkt hier nie benutzen.
  family?: string;
  // Erweiterte Felder, die das Snapshot NICHT bedient — Velocity,
  // Source=editorial. Caller setzt sie auf true wenn das Snapshot übersprungen
  // werden soll.
  skip?: boolean;
  // Letzter Tag des Fensters der Anfrage (ResolvedFilters.endDay). Gesetzt →
  // Fenster-Waechter in fetchEntry. Ohne (OG-Bild, Sitemap, Rueckfall bei
  // Datenbank-Fehlern) wird jeder Stand genommen.
  endDay?: string | null;
}

export interface LookupHit {
  payload: unknown;
  tag: string;       // für x-snapshot Header
  blobUrl: string;
  blobBytes: number;
  builtAt: string;   // Stand des Publishers (Manifest-Eintrag)
}

// Der Publisher fetcht die eigenen API-Routes, um die Snapshots zu bauen. Ohne
// diesen Bypass liest er das Blob der Vorrunde und schreibt es unveraendert
// zurueck: gemessen 2026-08-17 lieferte die publisher-identische URL
// `X-Snapshot: comps-detail-v2` in 0,114 s mit games=108, waehrend derselbe
// Request mit uebersprungenem Snapshot live games=97 in 6,03 s lieferte — die
// Payloads waren seit ~11.08. eingefroren. Der Header wird bereits gesendet
// (`publish-snapshot-bundle.mjs:186`), nur niemand hat ihn gelesen.
//
// Bewusst KEIN oeffentlicher Query-Parameter: der wuerde jedem erlauben, den
// Cushion zu umgehen und die 20-s-RPCs direkt zu treffen.
export function isSnapshotPublisher(request: Request): boolean {
  return request.headers.get('x-snapshot-publisher') === '1';
}

// Manifest, Patch und Achse einer Anfrage — gemeinsamer Teil aller Leser.
async function resolveRequest(opts: LookupOptions) {
  if (opts.skip) return null;
  const manifest = await loadManifest();
  if (!manifest) return null;
  // Fallback fuer den Cold-Supabase-Fall (2026-06-21): wenn
  // getAvailablePatches() timeouts hat → patches-Cache leer → opts.patch=null.
  // Manifest selbst kennt manifest.patches.current — wir nutzen den als
  // Fallback statt zu null-faulten + Live-RPC aufzurufen. Spart 8s Timeout
  // bei jeder Cold-Function-Lambda.
  const effectivePatch = opts.patch ?? manifest.patches.current;
  if (!effectivePatch) return null;
  const req = normalizeSnapshotRequest({ ...opts, patch: effectivePatch });
  if (!req) return null;
  // Resolve patch alias against manifest — if the caller sends a literal patch
  // string, use it as-is. Otherwise check whether it matches manifest.current.
  const resolvedPatch = req.patch === manifest.patches.current
    ? req.patch
    : req.patch === manifest.patches.previous
      ? req.patch
      : req.patch;
  return { manifest, req, resolvedPatch };
}

export async function lookupSnapshot(
  endpoint: SnapshotEndpoint,
  opts: LookupOptions,
): Promise<LookupHit | null> {
  const ctx = await resolveRequest(opts);
  if (!ctx) return null;
  const { manifest, req, resolvedPatch } = ctx;
  const key = endpoint === 'comps-detail' && opts.family
    ? compFamilySnapshotKey({ ...req, patch: resolvedPatch, family: opts.family })
    : snapshotKey(endpoint, { ...req, patch: resolvedPatch });
  const entry = manifest.entries[key];
  if (!entry) return null;
  return fetchEntry(endpoint, entry, resolvedPatch, opts);
}

// Hoechstens so viele Slug-Eintraege je Familie und Achse probieren; der
// Publisher legt je Familie einen an (sein Ziel), selten zwei.
const MEMBER_CANDIDATES = 3;

/**
 * comps-detail: Slug-Eintrag eines Mitglieds der Familie `<trait>__<carry>` auf
 * derselben Achse — Rueckfall, wenn der Familien-Eintrag fehlt. `accept`
 * prueft die Mitgliedschaft am Stand (comp-detail-snapshot.ts). Nur ueber
 * lookupCompDetailSnapshot benutzen.
 */
export async function lookupCompDetailMemberSlugs(
  opts: LookupOptions,
  family: { trait: string; carry: string },
  accept: (payload: unknown) => boolean,
): Promise<LookupHit | null> {
  const ctx = await resolveRequest(opts);
  if (!ctx) return null;
  const { manifest, req, resolvedPatch } = ctx;
  const marker = 'SLUGMARKER';
  const [head, tail] = snapshotKey('comps-detail', { ...req, patch: resolvedPatch, slug: marker }).split(marker);
  // Mitglieds-Slug `<trait>@<n>_<carry>[*3|~aug|#zweiter]`, im Schluessel mit _
  // statt @ * ~ #. Trait und Carry sind [A-Za-z0-9_] (parseFamilyKey), also
  // ohne Regex-Sonderzeichen.
  if (!/^\w+$/.test(family.trait) || !/^\w+$/.test(family.carry)) return null;
  const slugRe = new RegExp(`^${family.trait}_\\d+_${family.carry}(?:_|$)`);
  const candidates = Object.keys(manifest.entries)
    .filter(k => k.startsWith(head) && k.endsWith(tail) && slugRe.test(k.slice(head.length, k.length - tail.length)))
    .sort()
    .slice(0, MEMBER_CANDIDATES);
  for (const key of candidates) {
    const hit = await fetchEntry('comps-detail', manifest.entries[key], resolvedPatch, opts);
    if (hit && accept(hit.payload)) return hit;
  }
  return null;
}

async function fetchEntry(
  endpoint: SnapshotEndpoint,
  entry: ManifestEntry,
  resolvedPatch: string,
  opts: LookupOptions,
): Promise<LookupHit | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), SNAPSHOT_FETCH_TIMEOUT_MS);
    const res = await fetch(entry.url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const payload = await res.json();
    // Defensive field-check: if the snapshot was generated before Phase A1
    // (winShare / top4Share on units+comps) or A3 (top1Rate on items), skip
    // it and fall through to live RPC. Republished snapshots will pass the
    // check on next 09:30 UTC cycle (or manual `publish-snapshot-bundle.mjs`).
    if (!hasRequiredFields(endpoint, payload)) return null;
    // Patch-Konsistenz (2026-08-17, gemessen): der Key kodiert den Patch, der
    // Payload trägt ihn ein zweites Mal in `filters.patch`. Beide koennen
    // auseinanderlaufen — `comps/17.9/all__3d__all__mg210.json` lieferte einen
    // Body mit `patch: "17.8"`, weil der Publisher seinen eigenen eingefrorenen
    // Blob zurueckgelesen und unter dem neuen Patch-Key wieder hochgeladen hat.
    // Das ist eine Falschaussage an den Nutzer, nicht nur ein Frische-Problem.
    //
    // Bewusst NUR bei echtem Mismatch verwerfen, nicht bei `null`: ein
    // patch-loser Payload entsteht im Cold-Supabase-Fall (getAvailablePatches
    // laeuft in den Timeout) — genau dann ist ein unbestimmter Patch besser als
    // gar keine Antwort. Gegenprobe ueber alle 685 Manifest-Eintraege: 0
    // Mismatches, 0 null — der Guard verwirft heute nichts Legitimes.
    const payloadPatch = (payload as { filters?: { patch?: string | null } } | null)?.filters?.patch;
    if (payloadPatch != null && String(payloadPatch) !== resolvedPatch) return null;
    // Set-Konsistenz (2026-08-27, gemessen): ein Blob, der vor dem Set-Pin
    // publiziert wurde, traegt gar kein `filters.set` — und lieferte unter dem
    // Patch-Key 18.1 Set-17-Inhalte aus. Fehlendes Feld gilt daher als
    // Mismatch: lieber einmal auf den Live-RPC durchfallen, bis der Publisher
    // durchgelaufen ist, als dem Nutzer das falsche Set zu zeigen.
    // Listing-Payloads tragen das Set als `filters.set`, der Detail-Payload
    // reicht die kompletten ResolvedFilters durch und nennt es `setNumber`.
    const payloadFilters = (payload as
      { filters?: { set?: number | null; setNumber?: number | null; endDay?: string | null } } | null)?.filters;
    const payloadSet = payloadFilters?.set ?? payloadFilters?.setNumber ?? null;
    if (payloadSet !== (opts.setNumber ?? null)) return null;
    // Fenster-Waechter (volle Tage, 15.10.2026): ein Stand mit anderem Endtag
    // zeigt andere Tage als die Live-Abfragen derselben Seite. Ohne Feld (Stand
    // von vor der Umstellung, Fenster = Bautag - 1) → annehmen. Endtag + 1 →
    // annehmen: der Publisher ueberschreibt die Dateien waehrend seines Laufs,
    // das Manifest mit dem neuen Endtag kommt erst am Ende.
    if (opts.endDay) {
      const pe = payloadFilters?.endDay;
      if (pe != null && pe !== opts.endDay && pe !== addDays(opts.endDay, 1)) return null;
    }
    return { payload, tag: `${endpoint}-v2`, blobUrl: entry.url, blobBytes: entry.bytes, builtAt: entry.builtAt };
  } catch {
    return null;
  }
}

// Per-endpoint required-field marker. Bump these whenever a new top-level
// field is added that the UI now depends on. `null`-check (not `undefined`)
// because the API explicitly returns null for sample-gated entries.
function hasRequiredFields(endpoint: SnapshotEndpoint, payload: any): boolean {
  if (endpoint === 'units') {
    const sample = payload?.units?.[0];
    if (!sample) return true; // empty list = nothing to verify
    return 'winShare' in sample && 'top4Share' in sample && 'topItems' in sample;
  }
  if (endpoint === 'comps') {
    const sample = payload?.comps?.[0];
    if (!sample) return true;
    return 'winShare' in sample && 'top4Share' in sample;
  }
  if (endpoint === 'items') {
    const sample = payload?.items?.[0];
    if (!sample) return true;
    return 'top1Rate' in sample;
  }
  if (endpoint === 'comps-detail') {
    // Detail-Payload Struktur: { filters, hasData, comp: {...} }. Snapshot ohne
    // hasData oder mit comp:null wird abgelehnt — Live-Fallback haelt.
    if (!payload?.hasData || !payload?.comp) return false;
    // comp.clusterKey ist Pflicht-Feld der Detail-Page.
    return typeof payload.comp.clusterKey === 'string';
  }
  return true;
}

export function manifestStatus(): { loaded: boolean; ageMs: number | null; entries: number } {
  if (!_manifest?.data) return { loaded: false, ageMs: null, entries: 0 };
  return {
    loaded: true,
    ageMs: Date.now() - _manifest.ts,
    entries: Object.keys(_manifest.data.entries).length,
  };
}
