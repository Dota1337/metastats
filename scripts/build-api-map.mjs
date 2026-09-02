#!/usr/bin/env node
/**
 * Erzeugt infra/api-map.json aus dem Quelltext im Repo.
 *
 * Warum generiert und nicht von Hand gepflegt: dieselbe Begruendung wie bei
 * scripts/build-system-map.mjs — eine handgeschriebene Karte driftet in Wochen
 * und ist dann schlimmer als keine, weil man ihr glaubt. Der interne
 * Ops-Graph (app/components/internal/OpsGraph.tsx) hatte bis 02.09.2026 vier
 * Routen und drei Tabellen als Literale im Code stehen. Real sind es 73 Routen.
 *
 * Warum eine EIGENE Datei neben infra/system-map.json: die Kadenz ist eine
 * andere. Units und Timer aendern sich selten, Routen bei fast jedem Umbau.
 * In einer Datei gemischt wuerde Gate 5 kuenftig Pushes blocken, die mit
 * Infrastruktur nichts zu tun haben — und ein Gate, das grundlos nervt, wird
 * abgeschaltet (feedback_disable_gateguard).
 *
 * Was erfasst wird:
 *   • jede route.ts unter app/api/ als Schnittstellen-Knoten
 *   • Tabellen und DB-Funktionen, die eine Route benutzt — direkt ODER ueber
 *     ein Modul aus app/lib (30 der 73 Routen haben keinen direkten Marker)
 *   • die Kette DB-Funktion -> Tabelle aus den Migrationen
 *   • externe Quellen (Riot, DDragon, CommunityDragon, Twitch, ...) und die
 *     Hetzner-Box als eigene Knoten
 *   • das Snapshot-Buendel
 *
 * Was BEWUSST nicht erfasst wird: alles, was sich nicht belegen laesst. Wo ein
 * Tabellenname zur Laufzeit aus einer Variablen kommt (app/api/internal/
 * ops-snapshot/route.ts:163 und :182), entsteht KEINE geratene Kante, sondern
 * ein Eintrag in `unresolved`. Eine gezeichnete Linie ist eine Behauptung ueber
 * das System; eine erfundene Linie ist eine erfundene Zahl
 * (feedback_no_fake_values).
 *
 * Usage: node scripts/build-api-map.mjs [--check]
 *   --check  schreibt nicht, sondern meldet per Exit-Code, ob die committete
 *            Karte noch zum Code passt (fuer pre-push / CI)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const API_DIR = resolve(ROOT, 'app', 'api');
const LIB_DIR = resolve(ROOT, 'app', 'lib');
const MIG_DIR = resolve(ROOT, 'supabase', 'migrations');
const MAP_PATH = resolve(ROOT, 'infra', 'api-map.json');

const CHECK_ONLY = process.argv.includes('--check');

const read = (p) => readFileSync(p, 'utf8');
const posix = (p) => p.split('\\').join('/');

// ------------------------------------------------------------------ Dateien

function walk(dir, match, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, match, out);
    else if (match.test(entry)) out.push(full);
  }
  return out;
}

const routeFiles = walk(API_DIR, /^route\.ts$/);
const libFiles = walk(LIB_DIR, /\.tsx?$/);

// ------------------------------------------------------------------ Externe Quellen
//
// Reihenfolge zaehlt: der erste Treffer gewinnt. `leagueoflegends.com` steht
// deshalb hinter `ddragon.leagueoflegends.com`.
const EXTERNALS = [
  { id: 'ext:riot-api', label: 'Riot API', match: /api\.riotgames\.com|riotFetch|riot-fetch/ },
  { id: 'ext:ddragon', label: 'DDragon', match: /ddragon\.leagueoflegends\.com/ },
  { id: 'ext:cdragon', label: 'CommunityDragon', match: /communitydragon\.org/ },
  { id: 'ext:lolesports', label: 'LoL Esports', match: /esports-api\.lolesports\.com/ },
  { id: 'ext:twitch', label: 'Twitch', match: /(api|id)\.twitch\.tv/ },
  { id: 'ext:metatft', label: 'MetaTFT', match: /metatft\.com/ },
  { id: 'ext:dakgg', label: 'dak.gg', match: /dakgg\.io/ },
  { id: 'ext:lolchess', label: 'lolchess.gg', match: /lolchess\.gg/ },
  { id: 'ext:fandom', label: 'Leaguepedia', match: /lol\.fandom\.com/ },
  { id: 'ext:riot-web', label: 'Riot Web', match: /(teamfighttactics|www)\.leagueoflegends\.com/ },
  { id: 'box:hetzner', label: 'Hetzner-Box', match: /HETZNER_[A-Z_]+|REFRESH_API_TOKEN|refresh\.metastats\.gg/ },
  { id: 'blob:manifest', label: 'snapshot-bundle', match: /lookupSnapshot|SNAPSHOT_MANIFEST_URL/ },
];

// ------------------------------------------------------------------ Marker
//
// Vier Zugriffsarten, alle mit Anfuehrungszeichen im Muster. Ohne die Quote
// treffen `Array.from(` und `Buffer.from(` mit — im Repo messbar fuenf Stellen,
// die sonst als Phantom-Tabellen in der Karte landen wuerden.
const RE_FROM = /\.from\(\s*'([a-z0-9_]+)'/g;
const RE_RPC = /\.rpc\(\s*'([a-z0-9_]+)'/g;
const RE_CALLRPC = /callRpc\s*(?:<[^>]*>)?\s*\(\s*'([a-z0-9_]+)'/g;
const RE_REST_TABLE = /rest\/v1\/([a-z0-9_]+)[?`'"]/g;
const RE_REST_RPC = /rest\/v1\/rpc\/([a-z0-9_]+)/g;
// Tabellenname kommt aus einer Variablen — nicht aufloesbar.
//
// `rest/v1/rpc/${...}` ist bewusst NICHT gemeint: das ist der eine generische
// Funktions-Aufrufer in app/lib/tft-supabase-reader.ts:335, und der loest sich
// an der Aufrufstelle auf (`callRpc('get_tft_...')`). Wuerde er mitzaehlen,
// stuenden 37 Routen mit einem „nicht aufloesbar" in der Karte, obwohl bei
// jeder einzelnen der Funktionsname im Klartext danebensteht.
const RE_REST_DYNAMIC = /rest\/v1\/\$\{/g;

// Mitgelieferte Datenstaende aus public/ — die dritte Sorte Datentopf neben
// Datenbank und externer Quelle. `tft-set.json` etwa entscheidet, welches Set
// die halbe Seite anzeigt; im Graphen fehlte es bisher ganz.
const PUBLIC_JSON = existsSync(resolve(ROOT, 'public'))
  ? readdirSync(resolve(ROOT, 'public')).filter(f => f.endsWith('.json'))
  : [];
// Zwei Muster statt einem: in einem Backtick-Literal stehen regelmaessig
// Anfuehrungszeichen (`champion-stats-${region.replace('1','')}.json`), und ein
// gemeinsames Muster wuerde genau dort abbrechen — die Datei fiele stumm raus.
const RE_JSON_LITERALS = [/'([^'\n]*\.json)'/g, /"([^"\n]*\.json)"/g, /`([^`\n]*\.json)`/g];

/**
 * Aus einem Pfad-Literal einen Dateiknoten machen — oder nichts.
 * Nur was in public/ wirklich liegt, wird ein Knoten. Damit fallen URLs,
 * Snapshot-Schluessel und erfundene Pfade von selbst raus, ohne Ausnahmeliste.
 */
function publicFileFor(literal) {
  if (literal.includes('://')) return null;
  const base = literal.split('/').pop().replace(/\$\{[^}]*\}|\{[^}]*\}/g, '*');
  if (!base || base === '*.json') return null;
  const re = new RegExp(`^${base.split('*').map(s => s.replace(/[.+?^$()[\]{}|\\]/g, '\\$&')).join('[^/]*')}$`);
  return PUBLIC_JSON.some(f => re.test(f)) ? base : null;
}

/**
 * `champion-stats-euw.json` und `champion-stats-*.json` sind derselbe Topf —
 * die eine Stelle schreibt die Region hin, die andere setzt sie zur Laufzeit
 * ein. Zwei Knoten dafuer waeren zwei Behauptungen ueber eine Sache.
 */
function collapseToWildcard(names) {
  const patterns = [...names].filter(n => n.includes('*'));
  const out = new Set();
  for (const n of names) {
    const hit = n.includes('*') ? null : patterns.find(p => {
      const re = new RegExp(`^${p.split('*').map(s => s.replace(/[.+?^$()[\]{}|\\]/g, '\\$&')).join('[^/]*')}$`);
      return re.test(n);
    });
    out.add(hit || n);
  }
  return out;
}

function markersFor(file) {
  const text = read(file);
  const tables = new Set();
  const rpcs = new Set();
  const externals = new Set();
  const files = new Set();
  let dynamic = 0;

  for (const m of text.matchAll(RE_REST_RPC)) rpcs.add(m[1]);
  for (const m of text.matchAll(RE_RPC)) rpcs.add(m[1]);
  for (const m of text.matchAll(RE_CALLRPC)) rpcs.add(m[1]);
  for (const m of text.matchAll(RE_FROM)) tables.add(m[1]);
  for (const m of text.matchAll(RE_REST_TABLE)) {
    if (m[1] !== 'rpc') tables.add(m[1]);
  }
  for (const _ of text.matchAll(RE_REST_DYNAMIC)) dynamic += 1;
  for (const ext of EXTERNALS) {
    if (ext.match.test(text)) externals.add(ext.id);
  }
  for (const re of RE_JSON_LITERALS) {
    for (const m of text.matchAll(re)) {
      const f = publicFileFor(m[1]);
      if (f) files.add(f);
    }
  }
  return { tables, rpcs, externals, files, dynamic };
}

// ------------------------------------------------------------------ Import-Verfolgung
//
// 30 der 73 Routen sprechen die Datenbank nicht selbst an, sondern ueber ein
// Modul aus app/lib. Ohne diesen Schritt haetten sie im Graphen keine einzige
// Kante — und ein Knoten ohne Kante behauptet, die Route lese nichts.
const RE_IMPORT = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+'([^']+)'/g;

function resolveImport(spec, fromFile) {
  let base;
  if (spec.startsWith('@/')) base = resolve(ROOT, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null; // Paket aus node_modules
  for (const cand of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), base]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

const markerCache = new Map();

/** Marker einer Datei inklusive aller lokal importierten Module (zyklensicher). */
function markersDeep(entry) {
  const seen = new Set();
  const acc = {
    tables: new Set(), rpcs: new Set(), externals: new Set(), files: new Set(),
    dynamic: 0, via: new Set(),
  };
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!markerCache.has(file)) markerCache.set(file, markersFor(file));
    const m = markerCache.get(file);
    m.tables.forEach(t => acc.tables.add(t));
    m.rpcs.forEach(r => acc.rpcs.add(r));
    m.externals.forEach(e => acc.externals.add(e));
    m.files.forEach(f => acc.files.add(f));
    // Nur die Route selbst zaehlt: die Mehrdeutigkeit eines Hilfsmoduls gehoert
    // dem Modul, nicht jeder Route, die es importiert.
    if (file === entry) acc.dynamic += m.dynamic;
    if (file !== entry && (m.tables.size || m.rpcs.size || m.externals.size || m.files.size)) {
      acc.via.add(posix(relative(ROOT, file)));
    }
    for (const im of read(file).matchAll(RE_IMPORT)) {
      const target = resolveImport(im[1], file);
      // Nur eigener Code, und keine andere Route: eine Route importiert keine
      // zweite Route, aber Hilfsmodule liegen auch unter app/api/*/lib.ts.
      if (target && !seen.has(target) && !/[/\\]route\.ts$/.test(target)) stack.push(target);
    }
  }
  return acc;
}

// ------------------------------------------------------------------ Migrationen
//
// Welche Tabellen eine DB-Funktion anfasst. Grob, aber belegbar: im
// Funktionskoerper nach `from <name>` und `join <name>` suchen. Alias-Namen und
// CTEs filtern wir ueber die Liste der bekannten Tabellen wieder heraus.
function migrationFacts() {
  const files = existsSync(MIG_DIR) ? readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort() : [];
  const declaredTables = new Set();
  const fnBodies = new Map();
  for (const f of files) {
    const sql = read(resolve(MIG_DIR, f));
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gi)) {
      declaredTables.add(m[1].toLowerCase());
    }
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)([\s\S]*?)\$\$\s*;/gi)) {
      // Spaetere Migration gewinnt — sie ist die aktuelle Fassung.
      fnBodies.set(m[1].toLowerCase(), m[2]);
    }
  }
  return { declaredTables, fnBodies };
}

function tablesInBody(body, declaredTables) {
  const out = new Set();
  for (const m of body.matchAll(/\b(?:from|join)\s+(?:public\.)?([a-z0-9_]+)/gi)) {
    const name = m[1].toLowerCase();
    if (declaredTables.has(name)) out.add(name);
  }
  return out;
}

// ------------------------------------------------------------------ Aufbau

function routePathOf(file) {
  const rel = posix(relative(API_DIR, file)).replace(/\/route\.ts$/, '');
  return `/api/${rel}`;
}

/**
 * Gruppe eines Routen-Knotens: die ersten beiden Pfadstuecke. Gruppen mit nur
 * einem Mitglied fallen auf das erste Stueck zurueck, sonst entstuenden Dutzende
 * Sammelknoten mit je einem Kind — das waere Gruppierung ohne Nutzen.
 */
function groupsFor(paths) {
  const two = new Map();
  for (const p of paths) {
    const seg = p.replace('/api/', '').split('/');
    const key = seg.slice(0, 2).join('/');
    if (!two.has(key)) two.set(key, []);
    two.get(key).push(p);
  }
  const result = new Map();
  for (const [key, members] of two) {
    const final = members.length > 1 ? key : key.split('/')[0];
    for (const p of members) result.set(p, final);
  }
  return result;
}

function build() {
  const { declaredTables, fnBodies } = migrationFacts();

  const nodes = new Map();
  const edges = [];
  const unresolved = [];
  const addNode = (id, node) => { if (!nodes.has(id)) nodes.set(id, { id, ...node }); };
  const addEdge = (from, to, kind, via) => {
    const key = `${from}|${to}|${kind}`;
    if (edges.some(e => `${e.from}|${e.to}|${e.kind}` === key)) return;
    edges.push(via ? { from, to, kind, via } : { from, to, kind });
  };

  const routePaths = routeFiles.map(routePathOf);
  const groupOf = groupsFor(routePaths);

  const usedTables = new Set();
  const usedRpcs = new Set();
  const usedFiles = new Set();

  // Erst alle Routen auswerten, dann erst Knoten bauen: die Zusammenfassung von
  // `champion-stats-euw.json` auf `champion-stats-*.json` braucht den Blick auf
  // alle Fundstellen, nicht nur auf die gerade betrachtete Route.
  const perRoute = routeFiles.map(file => ({ file, m: markersDeep(file) }));
  const allFileNames = new Set();
  for (const { m } of perRoute) m.files.forEach(f => allFileNames.add(f));
  const collapsed = collapseToWildcard(allFileNames);
  const canonicalFile = new Map();
  for (const name of allFileNames) {
    const pat = collapsed.has(name) ? name : [...collapsed].find(p => p.includes('*')
      && new RegExp(`^${p.split('*').map(s => s.replace(/[.+?^$()[\]{}|\\]/g, '\\$&')).join('[^/]*')}$`).test(name));
    canonicalFile.set(name, pat || name);
  }

  for (const { file, m } of perRoute) {
    const path = routePathOf(file);
    const id = `api:${path}`;
    addNode(id, {
      kind: 'route',
      label: path,
      group: groupOf.get(path),
      file: posix(relative(ROOT, file)),
      via: [...m.via].sort(),
    });

    for (const t of [...m.tables].sort()) {
      usedTables.add(t);
      addEdge(id, `db:${t}`, 'reads');
    }
    for (const r of [...m.rpcs].sort()) {
      usedRpcs.add(r);
      addEdge(id, `fn:${r}`, 'calls');
    }
    for (const e of [...m.externals].sort()) addEdge(id, e, 'fetches');
    for (const raw of [...m.files].sort()) {
      const f = canonicalFile.get(raw) || raw;
      usedFiles.add(f);
      addEdge(id, `file:${f}`, 'reads');
    }
    if (m.dynamic > 0) {
      unresolved.push({
        node: id,
        reason: 'Tabellen-/Funktionsname kommt zur Laufzeit aus einer Variablen',
        count: m.dynamic,
      });
    }
  }

  // Funktions- und Tabellenknoten samt Kette fn -> db.
  for (const r of [...usedRpcs].sort()) {
    const body = fnBodies.get(r);
    addNode(`fn:${r}`, {
      kind: 'rpc',
      label: r,
      declared: Boolean(body),
    });
    if (!body) {
      unresolved.push({ node: `fn:${r}`, reason: 'Funktion in keiner Migration gefunden', count: 1 });
      continue;
    }
    for (const t of [...tablesInBody(body, declaredTables)].sort()) {
      usedTables.add(t);
      addEdge(`fn:${r}`, `db:${t}`, 'reads');
    }
  }

  for (const t of [...usedTables].sort()) {
    addNode(`db:${t}`, {
      kind: 'table',
      label: t,
      // `declared:false` heisst: wird benutzt, steht aber in keiner Migration.
      // Vier solche Tabellen gibt es (LoL-Altbestand, ausserhalb angelegt).
      declared: declaredTables.has(t),
    });
  }

  for (const f of [...usedFiles].sort()) {
    addNode(`file:${f}`, { kind: 'file', label: f });
  }

  for (const ext of EXTERNALS) {
    if (edges.some(e => e.to === ext.id)) {
      addNode(ext.id, { kind: ext.id.startsWith('blob:') ? 'blob' : ext.id.startsWith('box:') ? 'box' : 'external', label: ext.label });
    }
  }

  // Gruppenknoten fuer die Grundansicht des Graphen.
  const groupCounts = new Map();
  for (const p of routePaths) {
    const g = groupOf.get(p);
    groupCounts.set(g, (groupCounts.get(g) || 0) + 1);
  }
  const groups = [...groupCounts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));

  const sortedNodes = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  const sortedEdges = edges.sort((a, b) =>
    a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind));

  return {
    $comment: [
      'GENERIERT von scripts/build-api-map.mjs — nicht von Hand editieren.',
      'Neu bauen: npm run build:api-map — pruefen: npm run check:api-map',
      'Kanten stammen aus statischer Analyse des Quelltexts. Was sich nicht',
      'belegen laesst, steht in `unresolved` statt als geratene Kante im Graphen.',
    ],
    counts: {
      routes: routePaths.length,
      groups: groups.length,
      tables: [...usedTables].length,
      rpcs: [...usedRpcs].length,
      files: [...usedFiles].length,
      edges: sortedEdges.length,
      unresolved: unresolved.length,
    },
    groups,
    nodes: sortedNodes,
    edges: sortedEdges,
    unresolved: unresolved.sort((a, b) => a.node.localeCompare(b.node)),
  };
}

// ------------------------------------------------------------------ Ausgabe

const map = build();
const text = `${JSON.stringify(map, null, 2)}\n`;

if (CHECK_ONLY) {
  if (!existsSync(MAP_PATH)) {
    console.error('✗ infra/api-map.json fehlt — `npm run build:api-map` laufen lassen und mitcommitten.');
    process.exit(1);
  }
  if (read(MAP_PATH) !== text) {
    console.error('✗ infra/api-map.json ist veraltet — `npm run build:api-map` laufen lassen und mitcommitten.');
    process.exit(1);
  }
  console.log(`✓ api-map aktuell (${map.counts.routes} Routen, ${map.counts.edges} Kanten)`);
  process.exit(0);
}

writeFileSync(MAP_PATH, text, 'utf8');
console.log(`✓ infra/api-map.json: ${map.counts.routes} Routen, ${map.counts.groups} Gruppen, ` +
  `${map.counts.tables} Tabellen, ${map.counts.rpcs} Funktionen, ${map.counts.files} Dateien, ` +
  `${map.counts.edges} Kanten, ` +
  `${map.counts.unresolved} unaufgeloest`);
