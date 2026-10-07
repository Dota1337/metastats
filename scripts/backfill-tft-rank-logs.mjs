#!/usr/bin/env node
/**
 * Erstbefuellung aus dem dak.gg-LP-Verlauf fuer alle Spieler mit vergangenen
 * Sets, denen Hoechst-LP (Master+-Ende), End-LP (Master+-Ende) oder Spielzahl fehlt. Die Seite macht
 * dasselbe beim woechentlichen Neuabruf, aber mit 40-s-Deckel pro Spieler.
 *
 * Aufruf (lokal, liest .env.local):
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/lib/ts-test-hook.mjs \
 *     scripts/backfill-tft-rank-logs.mjs [Namensfilter]
 *
 * Nacheinander, idempotent: gefuellte Sets werden nicht erneut gefragt.
 * Rueckbau Spielzahl: `update tft_player_rank_history set total_games=null where source='dakgg'`.
 * Rueckbau End-LP: Sicherung vor dem Lauf zurueckschreiben (MetaTFT-Zeilen
 * hatten teils schon End-LP; dakgg-Zeilen hatten nie welche).
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  for (const l of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(l);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { fillFromLogs } = await import(pathToFileURL(resolve(process.cwd(), 'app/lib/tft-rank-history.ts')).href);
const U = process.env.NEXT_PUBLIC_SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!U || !K) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen');
const H = { apikey: K, Authorization: `Bearer ${K}` };
const get = async p => {
  const r = await fetch(`${U}/rest/v1/${p}`, { headers: H });
  if (!r.ok) throw new Error(`${p} HTTP ${r.status}`);
  return r.json();
};

const base = 'tft_player_rank_history?select=puuid,region&queue_id=eq.1100&set_number=lt.18&source=neq.override&end_tier=not.in.(UNRANKED,NONE)';
const rows = [];
for (const q of [
  `${base}&total_games=is.null`,
  `${base}&peak_lp=is.null&end_tier=in.(MASTER,GRANDMASTER,CHALLENGER)`,
  `${base}&end_lp=is.null&end_tier=in.(MASTER,GRANDMASTER,CHALLENGER)`,
]) {
  for (let o = 0; ; o += 1000) {
    const page = await get(`${q}&order=puuid&offset=${o}&limit=1000`);
    rows.push(...page);
    if (page.length < 1000) break;
  }
}
const players = new Map();
for (const r of rows) players.set(r.puuid, r.region);

// Konto-Abfragen: sea-Plattformen laufen ueber europe.
const route = r => /^(na1|br1|la1|la2)$/.test(r) ? 'americas' : /^(kr|jp1)$/.test(r) ? 'asia' : 'europe';
const only = process.argv[2];
const tot = { peak: 0, games: 0, end: 0, none: 0, failed: 0 };
let i = 0, noName = 0;
for (const [puuid, region] of players) {
  i++;
  let [n] = await get(`tft_player_names?select=game_name,tag_line&puuid=eq.${encodeURIComponent(puuid)}&limit=1`);
  if (!n && process.env.RIOT_API_KEY_TFT) {
    const r = await fetch(`https://${route(region)}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${puuid}`,
      { headers: { 'X-Riot-Token': process.env.RIOT_API_KEY_TFT } });
    if (r.ok) { const a = await r.json(); n = { game_name: a.gameName, tag_line: a.tagLine }; }
  }
  if (!n?.game_name) { noName++; console.log(i, 'kein Name', puuid.slice(0, 10), region); continue; }
  if (only && !`${n.game_name}#${n.tag_line}`.includes(only)) continue;
  const res = await fillFromLogs(puuid, region, n.game_name, n.tag_line, 600_000);
  for (const k in tot) tot[k] += res[k];
  console.log(i, `${n.game_name}#${n.tag_line}`, region, JSON.stringify(res));
}
console.log('SUMME', players.size, 'Spieler', JSON.stringify(tot), 'ohne Name', noName);
