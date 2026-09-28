#!/usr/bin/env node
/**
 * Zwischenstand laufender TFT-Turniere → tft_tournament_live_standings.
 *
 * Quelle sind die Aussenlinks, die der Turnier-Sammler von der Liquipedia-Seite
 * in tft_tournaments.standings_sources ablegt (scripts/crawl-tft-tournaments.mjs):
 *   - veroeffentlichte Google-Tabellen (Riot EMEA/AMER, riot.com/… leitet dorthin)
 *     → jedes Tabellenblatt mit Name + Punkte-Spalte wird eine Stufe
 *   - normale Google-Tabellen mit gid (China) → CSV-Export; Runden-Raster
 *     („Name,Points,,Name,Points,…") wird je Spieler aufsummiert
 *   - apactft.com (APAC) → HTML-Tabellen mit Name + Punkte-Spalte
 *
 * Laeuft stuendlich auf der Box (metastats-tft-live-standings.timer), schreibt
 * aber nur fuer Turniere im Fenster Start−2 … Ende+1 Tage.
 *
 * Schutz gegen kaputte Tabellen: alte Zeilen einer Stufe werden nur entfernt,
 * wenn die Kopfzeile erkannt wurde, der neue Stand mindestens halb so viele
 * Zeilen hat wie der alte, und das Turnier im Fenster liegt.
 *
 * Usage:
 *   node scripts/fetch-tft-live-standings.mjs              # alle Turniere im Fenster
 *   node scripts/fetch-tft-live-standings.mjs --id <id>    # ein Turnier, Fenster egal (kein Aufraeumen ausserhalb)
 *   node scripts/fetch-tft-live-standings.mjs --dry-run    # nur lesen + ausgeben
 *
 * Exit ≠ 0 nur, wenn Quellen da waren und ALLE gescheitert sind.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function loadEnv() {
  const candidates = ['/etc/metastats-crawler/env', resolve(process.cwd(), '.env.local')];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.includes('=') || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      const k = line.slice(0, i).trim();
      if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, '');
    }
    break;
  }
}
loadEnv();

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes('--dry-run');
const ONLY_ID = arg('--id', '');

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bwawxwgxxfafbruebixa.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1); }

const USER_AGENT = 'metastats-bot/1.0 (https://metastats.gg; info@metastats.gg)';
const DAY_MS = 86_400_000;
// Blaetter ohne Rangliste (Lobby-Einteilung, Ueberblick, Regeln).
const SKIP_TAB = /lobb|overview|creator|schedule|rules|format|info|bracket|seeding/i;

// ─────────────────────────────────────────────────────────────────────────────
// HTTP

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return { text: await res.text(), finalUrl: res.url };
}

async function sb(path, init = {}) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Supabase ${init.method || 'GET'} ${path.split('?')[0]}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 || init.method === 'DELETE' || init.method === 'POST' ? null : res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing

export function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const decode = (s) => String(s)
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ');
const strip = (s) => decode(String(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

const IS_NAME = /^name$/i;
const IS_POINTS = /^(points|pts|total|total points)$/i;
const IS_PLACE = /^(#|top|position|placement|rank|pos|place)$/i;
const IS_REGION = /^region$/i;
const IS_GAME = /^(m|round|game|r|g)\s*\d+$/i;
const num = (s) => {
  const t = String(s ?? '').replace(/[,\s]/g, '');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

function splitTeam(raw) {
  const m = raw.match(/^([A-Z0-9]{2,5})\s+(\S.*)$/);
  return m ? { name: m[2], team: m[1] } : { name: raw, team: null };
}

/**
 * Tabelle (Zeilen × Zellen) → Standings oder null, wenn keine Kopfzeile mit
 * Name + Punkten erkannt wird. Mehrere Name-Spalten in der Kopfzeile = Runden-
 * Raster (China): Punkte je Spieler aufsummiert, Platz aus der Summe.
 */
export function parseGrid(rows) {
  const hi = rows.findIndex(r => r.some(c => IS_NAME.test(c.trim())) && r.some(c => IS_POINTS.test(c.trim())));
  if (hi < 0) return null;
  const head = rows[hi].map(c => c.trim());
  const nameCols = head.map((c, i) => (IS_NAME.test(c) ? i : -1)).filter(i => i >= 0);
  const body = rows.slice(hi + 1);

  if (nameCols.length >= 3) {
    // Runden-Raster: Name-Spalte, rechts daneben die Punkte.
    const acc = new Map();
    for (const r of body) for (const ci of nameCols) {
      const raw = (r[ci] || '').trim();
      const pts = num(r[ci + 1]);
      if (!raw || pts == null || /^lobby\s*\d+$/i.test(raw)) continue;
      const a = acc.get(raw) || { points: 0, games: 0 };
      a.points += pts; a.games += 1;
      acc.set(raw, a);
    }
    const out = [...acc.entries()]
      .sort((x, y) => y[1].points - x[1].points)
      .map(([raw, a]) => ({ raw, points: a.points, games: a.games, region: null, placement: null }));
    out.forEach((r, i) => { r.placement = i > 0 && out[i - 1].points === r.points ? out[i - 1].placement : i + 1; });
    return out.length ? out : null;
  }

  const nameCol = nameCols[0];
  const ptsCol = head.findIndex(c => IS_POINTS.test(c));
  const placeCol = head.findIndex(c => IS_PLACE.test(c));
  const regionCol = head.findIndex(c => IS_REGION.test(c));
  const gameCols = head.map((c, i) => (IS_GAME.test(c) ? i : -1)).filter(i => i >= 0);
  const out = [];
  for (const r of body) {
    const raw = (r[nameCol] || '').trim();
    if (!raw) continue;
    const points = num(r[ptsCol]);
    const placement = placeCol >= 0 ? num(r[placeCol]) : null;
    if (points == null && placement == null) continue;
    out.push({
      raw,
      points,
      placement: placement ?? out.length + 1,
      region: regionCol >= 0 ? ((r[regionCol] || '').trim() || null) : null,
      games: gameCols.length ? gameCols.filter(i => num(r[i]) != null && num(r[i]) > 0).length : null,
    });
  }
  return out.length ? out : null;
}

function htmlTables(html) {
  const out = [];
  for (const m of html.matchAll(/<table[\s\S]*?<\/table>/g)) {
    const rows = [];
    for (const tr of m[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      rows.push([...tr[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(x => strip(x[1])));
    }
    out.push(rows);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Quellen → [{ source, stage, stageOrder, rows }]

// Blattnamen stehen als JS-String im Seitenquelltext ("Days 1 \x26 2").
const unescapeJs = (s) => s
  .replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/\\(.)/g, '$1');

async function readPublishedSheet(base, html) {
  const tabs = [...html.matchAll(/items\.push\(\{name: "((?:[^"\\]|\\.)*)", pageUrl: "[^"]*", gid: "(\d+)"/g)]
    .map((m, i) => ({ name: unescapeJs(m[1]), gid: m[2], order: i }));
  const stages = [];
  for (const t of tabs) {
    if (SKIP_TAB.test(t.name)) continue;
    const { text } = await fetchText(`${base}/pub?gid=${t.gid}&single=true&output=csv`);
    const rows = parseGrid(parseCsv(text));
    if (rows) stages.push({ source: 'gsheet', stage: t.name, stageOrder: t.order, rows });
  }
  return stages;
}

export async function readSource(url) {
  // Google-Tabelle mit fester ID + gid (China): CSV-Export genau dieses Blatts.
  const plain = url.match(/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
  if (plain) {
    const gid = (url.match(/[#?&]gid=(\d+)/) || [])[1] || '0';
    const { text } = await fetchText(`https://docs.google.com/spreadsheets/d/${plain[1]}/export?format=csv&gid=${gid}`);
    const rows = parseGrid(parseCsv(text));
    return rows ? [{ source: 'gsheet', stage: 'Overall', stageOrder: 0, rows }] : [];
  }
  const { text, finalUrl } = await fetchText(url);
  const pub = finalUrl.match(/^(https:\/\/docs\.google\.com\/spreadsheets\/(?:u\/\d+\/)?d\/e\/[A-Za-z0-9_-]+)\/pubhtml/);
  if (pub) return readPublishedSheet(pub[1], text);
  if (/apactft\.com/i.test(finalUrl)) {
    const stages = [];
    htmlTables(text).forEach((t, i) => {
      const rows = parseGrid(t);
      if (rows) stages.push({ source: 'apactft', stage: stages.length ? `Standings ${i + 1}` : 'Standings', stageOrder: i, rows });
    });
    return stages;
  }
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// main

const inList = (vals) => `(${vals.map(v => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')})`;
const enc = encodeURIComponent;

async function main() {
  const filter = ONLY_ID ? `&id=eq.${enc(ONLY_ID)}` : '';
  const tours = await sb(`tft_tournaments?select=id,start_date,end_date,standings_sources&standings_sources=not.is.null${filter}`);
  const now = Date.now();
  const inWindow = (t) => t.start_date && t.end_date
    && now >= Date.parse(t.start_date) - 2 * DAY_MS
    && now <= Date.parse(t.end_date) + 2 * DAY_MS;   // Ende+1 Tag inkl. des ganzen Endtags
  const due = ONLY_ID ? tours : tours.filter(inWindow);
  console.log(`[live] ${due.length} tournament(s) due (${tours.length} with sources)`);

  let sources = 0, failed = 0, written = 0;
  for (const t of due) {
    const prune = inWindow(t);
    for (const url of Array.isArray(t.standings_sources) ? t.standings_sources : []) {
      sources++;
      let stages;
      try { stages = await readSource(url); }
      catch (e) { failed++; console.warn(`  [fail] ${t.id} ${url}: ${e.message}`); continue; }
      if (!stages.length) { failed++; console.warn(`  [no-table] ${t.id} ${url}`); continue; }

      for (const s of stages) {
        const byRaw = new Map();
        for (const r of s.rows) if (!byRaw.has(r.raw)) byRaw.set(r.raw, r);   // PK (…, raw_name)
        const rows = [...byRaw.values()].map(r => {
          const { name, team } = splitTeam(r.raw);
          return {
            tournament_id: t.id, source: s.source, stage: s.stage, stage_order: s.stageOrder,
            placement: r.placement, raw_name: r.raw, name, team_prefix: team,
            region: r.region, points: r.points, games: r.games, fetched_at: new Date().toISOString(),
          };
        });
        const top = rows.slice(0, 3).map(r => `${r.placement}.${r.raw}(${r.points})`).join(' ');
        console.log(`  ${t.id} · ${s.source} · ${s.stage}: ${rows.length} rows  ${top}`);
        if (DRY) continue;

        const key = `tournament_id=eq.${enc(t.id)}&source=eq.${enc(s.source)}&stage=eq.${enc(s.stage)}`;
        const prev = await sb(`tft_tournament_live_standings?select=raw_name&${key}`);
        await sb('tft_tournament_live_standings?on_conflict=tournament_id,source,stage,raw_name', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(rows),
        });
        written += rows.length;
        const stale = prev.filter(p => !byRaw.has(p.raw_name));
        if (stale.length && prune && rows.length >= prev.length * 0.5) {
          await sb(`tft_tournament_live_standings?${key}&raw_name=in.${enc(inList(stale.map(p => p.raw_name)))}`, { method: 'DELETE' });
          console.log(`    pruned ${stale.length} stale row(s)`);
        } else if (stale.length) {
          console.log(`    kept ${stale.length} stale row(s) (${prune ? 'shrank >50%' : 'outside window'})`);
        }
      }
    }
  }
  console.log(`[live] done: ${sources} source(s), ${failed} failed, ${written} row(s) written${DRY ? ' (dry-run)' : ''}`);
  if (sources > 0 && failed === sources) process.exit(2);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
}
