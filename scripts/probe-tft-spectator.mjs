#!/usr/bin/env node
// Prueft taeglich, ob Riots Live-Partie-Schnittstelle fuer TFT
// (spectator-tft-v5, active-games/by-puuid) wieder echte Antworten liefert.
// Stand 26.09.2026: jede Abfrage antwortet 404, auch fuer Spieler, die
// nachweislich gerade spielen (Riot-Issue #1195). Sobald die erste 200 kommt,
// koennen wir eine Live-Anzeige bauen — dieses Skript soll das melden.
//
// Ablauf: je 25 Challenger aus EUW und KR abfragen (19:00 UTC ist in EUW
// Hauptzeit), Antworten je Statuscode zaehlen.
//   - alles 404            → gruen, still
//   - mindestens eine 200  → gruen, schreibt probe-tft-spectator.json mit einer
//                            anonymisierten Beispielantwort; der Workflow
//                            oeffnet daraus ein Issue
//   - 401/403 oder 0 geprueft → rot (Exit 1): anderer Fehler als "Riot filtert"
//
// Der Schluessel steht nur im Header und wird nie ausgegeben.
//
// Aufruf: node scripts/probe-tft-spectator.mjs [--out probe-tft-spectator.json]

import fs from 'node:fs';

const PER_REGION = 25;
const PAUSE_MS = 100;
const MAX_RETRIES = 3;
const REGIONS = ['euw1', 'kr'];

const outArg = process.argv.indexOf('--out');
const OUT = outArg >= 0 ? process.argv[outArg + 1] : 'probe-tft-spectator.json';

function readKey() {
  if (process.env.RIOT_API_KEY_TFT) return process.env.RIOT_API_KEY_TFT.trim();
  try {
    const env = fs.readFileSync('.env.local', 'utf8');
    const m = env.match(/^RIOT_API_KEY_TFT=(.*)$/m);
    if (m) return m[1].trim().replace(/^"|"$/g, '');
  } catch { /* keine lokale Datei — dann fehlt der Schluessel */ }
  return '';
}

const KEY = readKey();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 429 respektiert Retry-After; andere Codes gehen unveraendert zurueck.
async function riotFetch(url) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: { 'X-Riot-Token': KEY }, signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      if (attempt >= MAX_RETRIES) return { status: 0, body: null, error: err?.name || 'fetch_failed' };
      await sleep(2000);
      continue;
    }
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const wait = Math.min(Number(res.headers.get('retry-after')) || 5, 120);
      console.log(`[probe] 429 — warte ${wait} s`);
      await sleep(wait * 1000);
      continue;
    }
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  }
}

// Ersetzt alles, was eine Person identifiziert, durch Platzhalter — die
// Issues im Repo sind oeffentlich.
const ID_KEYS = /puuid|gamename|tagline|riotid|summonerid|summonername|encryptionkey|^id$/i;
function anonymize(value, ids = new Map()) {
  const placeholder = (s) => {
    if (!ids.has(s)) ids.set(s, `<id-${ids.size + 1}>`);
    return ids.get(s);
  };
  const walk = (v, key) => {
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    }
    if (typeof v === 'string' && key && ID_KEYS.test(key)) return placeholder(v);
    if (typeof v === 'string' && ids.has(v)) return ids.get(v);
    return v;
  };
  return walk(value);
}

// Feldname → Typ, verschachtelt mit Punkten, Arrays mit [].
function fieldTypes(v, prefix = '', acc = new Map()) {
  if (Array.isArray(v)) {
    acc.set(prefix || '(root)', 'array');
    if (v.length) fieldTypes(v[0], `${prefix}[]`, acc);
  } else if (v && typeof v === 'object') {
    if (prefix) acc.set(prefix, 'object');
    for (const [k, x] of Object.entries(v)) fieldTypes(x, prefix ? `${prefix}.${k}` : k, acc);
  } else {
    acc.set(prefix, v === null ? 'null' : typeof v);
  }
  return acc;
}

async function main() {
  if (!KEY) {
    console.log('[probe] RIOT_API_KEY_TFT fehlt');
    process.exit(1);
  }

  const codes = {};
  let checked = 0;
  let authFail = false;
  let sample = null;
  let sampleRegion = null;

  for (const region of REGIONS) {
    const league = await riotFetch(`https://${region}.api.riotgames.com/tft/league/v1/challenger`);
    if (league.status === 401 || league.status === 403) { authFail = true; console.log(`[probe] ${region} Liga: HTTP ${league.status}`); continue; }
    if (league.status !== 200) { console.log(`[probe] ${region} Liga: HTTP ${league.status} — Region uebersprungen`); continue; }
    const puuids = (league.body?.entries || [])
      .sort((a, b) => (b.leaguePoints || 0) - (a.leaguePoints || 0))
      .map((e) => e.puuid).filter(Boolean).slice(0, PER_REGION);

    for (const puuid of puuids) {
      const r = await riotFetch(`https://${region}.api.riotgames.com/lol/spectator/tft/v5/active-games/by-puuid/${puuid}`);
      codes[r.status] = (codes[r.status] || 0) + 1;
      if (r.status !== 0 && r.status !== 429) checked++;
      if (r.status === 401 || r.status === 403) authFail = true;
      if (r.status === 200 && !sample) { sample = r.body; sampleRegion = region; }
      await sleep(PAUSE_MS);
    }
  }

  const hits = codes[200] || 0;
  console.log(`[probe] ${checked} geprueft, Statuscodes: ${JSON.stringify(codes)}`);

  if (sample) {
    const report = {
      date: new Date().toISOString().slice(0, 10),
      region: sampleRegion,
      checked,
      hits,
      codes,
      fields: Object.fromEntries(fieldTypes(sample)),
      sample: anonymize(sample),
    };
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log(`[probe] Schnittstelle liefert wieder Daten (${hits}/${checked}) — Bericht in ${OUT}`);
  }

  if (authFail) { console.log('[probe] 401/403 — Schluessel oder Berechtigung pruefen'); process.exit(1); }
  if (checked === 0) { console.log('[probe] 0 Spieler geprueft — Lauf ist nicht aussagekraeftig'); process.exit(1); }
}

main().catch((err) => {
  console.log(`[probe] Fehler: ${err?.message || err}`);
  process.exit(1);
});
