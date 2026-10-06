// Parser fuer Liquipedia-TFT-Turnierseiten und Spieler-Ergebnislisten.
//
// Eine Lib fuer drei Aufrufer:
//   - scripts/crawl-tft-tournaments.mjs  (Einzelabruf je Turnierseite)
//   - Reparatur alter Turniere           (Stapelabruf, 50 Titel je Anfrage)
//   - scripts/enrich-tft-pro-history.mjs (Spieler-Unterseite <Spieler>/Results)
//
// Bewusst ohne Supabase-Import: alles hier ist reine Textverarbeitung, die
// Abruf-Helfer bekommen ihren Abrufer als Parameter (Tests reichen eine
// Attrappe herein).
//
// Platzierungs-Regel (Prize Pool):
//   - Plaetze zaehlen je Pool ab 1. Ohne `place=` ist der Start der laufende Rang.
//   - Ende = ausdrueckliches Ende, sonst Start + max(1, Anzahl Gegner) - 1.
//     Ein Duo oder Team zaehlt als EIN Gegner.
//   - placementMax = Ende, wenn Ende > Start, sonst null. Naechster Rang = Ende + 1.
//   - Dubletten nur auf exaktem (placement, proName) — wie der Primaerschluessel.

import { liquipediaJson } from './liquipedia-tft.mjs';

export const LIQUIPEDIA_ORIGIN = 'https://liquipedia.net';
export const PLACE_RE = /^\s*(\d+)(?:\s*[-–]\s*(\d+))?/;

// ─── Text-Helfer ────────────────────────────────────────────────────────

// Kommentare entfernen. Ein nicht geschlossenes <!-- verschluckt in MediaWiki
// den Rest der Seite — hier genauso.
export function stripComments(s) {
  if (!s) return '';
  let out = String(s).replace(/<!--[\s\S]*?-->/g, '');
  const open = out.indexOf('<!--');
  if (open >= 0) out = out.slice(0, open);
  return out;
}

function codePoint(n) {
  if (n === 160) return ' ';
  if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return '';
  return String.fromCodePoint(n);
}

// HTML-Entitaeten aufloesen. &amp; zuletzt, damit &amp;#39; nicht doppelt
// dekodiert wird.
export function decodeEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => codePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => codePoint(parseInt(h, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function stripTags(s) {
  return decodeEntities(String(s || '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// ─── Vorlagen ───────────────────────────────────────────────────────────

function normName(s) {
  return String(s || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Erste tiefen-balancierte Vorlage ab `from`. MediaWiki unterscheidet beim
// ersten Buchstaben nicht nach Gross/Klein. Liefert { start, end, body };
// body beginnt direkt hinter dem Namen (meist mit "|").
export function findTemplateRange(wikitext, templateName, from = 0) {
  const lower = templateName.charAt(0).toLowerCase() + templateName.slice(1);
  const upper = templateName.charAt(0).toUpperCase() + templateName.slice(1);
  const markers = upper === lower ? [`{{${lower}`] : [`{{${lower}`, `{{${upper}`];
  let idx = from;
  while (true) {
    let start = -1, marker = '';
    for (const mk of markers) {
      const p = wikitext.indexOf(mk, idx);
      if (p >= 0 && (start < 0 || p < start)) { start = p; marker = mk; }
    }
    if (start < 0) return null;
    const next = wikitext[start + marker.length];
    if (next !== '|' && next !== ' ' && next !== '\n' && next !== '\r' && next !== '\t' && next !== '}') {
      idx = start + 1;
      continue;
    }
    let depth = 0, i = start;
    while (i < wikitext.length) {
      if (wikitext[i] === '{' && wikitext[i + 1] === '{') { depth++; i += 2; continue; }
      if (wikitext[i] === '}' && wikitext[i + 1] === '}') {
        depth--; i += 2;
        if (depth === 0) return { start, end: i, body: wikitext.slice(start + marker.length, i - 2) };
        continue;
      }
      i++;
    }
    return null;
  }
}

export function findTemplate(wikitext, templateName, from = 0) {
  return findTemplateRange(wikitext, templateName, from);
}

export function findAllTemplateRanges(wikitext, templateName) {
  const out = [];
  let from = 0;
  while (true) {
    const t = findTemplateRange(wikitext, templateName, from);
    if (!t) break;
    out.push(t);
    from = t.end;
  }
  return out;
}

// Nur die Rumpfe, in Dokument-Reihenfolge (Kompatibilitaet zum alten Crawler).
export function findAllTemplates(wikitext, templateName) {
  return findAllTemplateRanges(wikitext, templateName).map(t => t.body);
}

// Teilt an "|" auf oberster Ebene. {{ }} und [[ ]] werden PAARWEISE gezaehlt —
// der alte Zaehler nahm "}}}}" als drei Schliessungen und verschmolz dadurch
// benachbarte Slots.
export function splitTopLevel(body) {
  const s = String(body ?? '');
  const out = [];
  let depth = 0, buf = '';
  for (let j = 0; j < s.length; j++) {
    const c = s[j], n = s[j + 1];
    if ((c === '{' && n === '{') || (c === '[' && n === '[')) { depth++; buf += c + n; j++; continue; }
    if ((c === '}' && n === '}') || (c === ']' && n === ']')) { depth = Math.max(0, depth - 1); buf += c + n; j++; continue; }
    if (c === '|' && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += c;
  }
  out.push(buf);
  return out;
}

// Rumpf → { nameTail, positional, keyed }. nameTail ist der Text zwischen
// Vorlagenname und erstem "|" ("columns start" bei {{TeamCard columns start}}).
export function parseArgs(body) {
  const segs = splitTopLevel(body);
  const nameTail = (segs.shift() || '').trim();
  const positional = [], keyed = {};
  for (const raw of segs) {
    const eq = raw.indexOf('=');
    if (eq >= 0) {
      const k = raw.slice(0, eq).trim();
      // Echte Parameter-Namen sind einfache Woerter; alles andere (eine
      // Vorlage mit "=" darin) ist ein Positionswert.
      if (/^[A-Za-z0-9_ -]+$/.test(k)) { keyed[k] = raw.slice(eq + 1).trim(); continue; }
    }
    positional.push(raw.trim());
  }
  return { nameTail, positional, keyed };
}

// Nachsichtig: jedes "k=v" zaehlt (Infobox).
export function parseTemplateFields(body) {
  const fields = {};
  for (const raw of splitTopLevel(body)) {
    const eq = raw.indexOf('=');
    if (eq < 0) continue;
    const k = raw.slice(0, eq).trim();
    if (k) fields[k] = raw.slice(eq + 1).trim();
  }
  return fields;
}

// Ein Positionswert, der genau eine Vorlage ist → { name, body }; sonst null.
export function asTemplate(seg) {
  const s = String(seg || '').trim();
  if (!s.startsWith('{{') || !s.endsWith('}}')) return null;
  let depth = 0;
  for (let i = 0; i < s.length;) {
    if (s[i] === '{' && s[i + 1] === '{') { depth++; i += 2; continue; }
    if (s[i] === '}' && s[i + 1] === '}') {
      depth--; i += 2;
      if (depth === 0 && i < s.length) return null;   // zwei Vorlagen hintereinander
      continue;
    }
    i++;
  }
  if (depth !== 0) return null;
  const inner = s.slice(2, -2);
  const bar = inner.indexOf('|');
  const rawName = bar < 0 ? inner : inner.slice(0, bar);
  if (/[{}[\]]/.test(rawName)) return null;
  return { name: normName(rawName), body: bar < 0 ? '' : inner.slice(bar) };
}

// ─── Aus dem alten Crawler uebernommen (setNames als Parameter) ─────────

export function unwikiTemplateOnly(s, { setNames = {} } = {}) {
  if (!s) return '';
  return s.replace(/\{\{\s*setname\s*\/\s*(\d+)\s*\}\}/gi, (_, n) => setNames[parseInt(n, 10)] || `Set ${n}`);
}

export function unwiki(s, { setNames = {} } = {}) {
  if (!s) return '';
  let out = String(s)
    .replace(/\{\{\s*setname\s*\/\s*(\d+)\s*\}\}/gi, (_, n) => setNames[parseInt(n, 10)] || `Set ${n}`)
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ');
  let prev;
  do { prev = out; out = out.replace(/\{\{[^{}]*\}\}/g, ''); } while (out !== prev);
  return out
    .replace(/^[\s:,\-–—]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanName(s) {
  return unwiki(stripComments(s || ''));
}

export function parseDate(s) {
  if (!s) return null;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

// Ganze Einheiten; eine 1-2-stellige Endgruppe nach Trenner ist Dezimalteil.
// Betraege <= 0 gelten als "kein Preis".
export function parsePrize(s) {
  if (!s) return null;
  let t = String(s).replace(/[^\d.,]/g, '');
  if (!t) return null;
  const dec = /^(.+)[.,](\d{1,2})$/.exec(t);
  if (dec) t = dec[1];
  const num = t.replace(/[^\d]/g, '');
  const n = num ? parseInt(num, 10) : null;
  return n && n > 0 ? n : null;
}

export const POOL_TEMPLATES = ['SoloPrizePool', 'DuoPrizePool', 'TeamPrizePool', 'PrizePool'];

// Seitenwaehrung der localprize-Betraege: ISO-Code, null (alles USD) oder
// 'MIXED' (widerspruechliche Codes → nicht umrechnen).
export function detectPageCurrency(wikitext, infoboxFields) {
  const found = new Set();
  const add = (v) => { const c = String(v || '').trim().toUpperCase(); if (/^[A-Z]{3}$/.test(c)) found.add(c); };
  add(infoboxFields?.localcurrency);
  for (const name of POOL_TEMPLATES) {
    for (const body of findAllTemplates(wikitext, name)) {
      const f = parseTemplateFields(body);
      for (const [k, v] of Object.entries(f)) if (/^localcurrency\d*$/.test(k)) add(v);
    }
  }
  if (found.size === 0) return null;
  if (found.size > 1) return 'MIXED';
  return [...found][0];
}

export function deriveStatus(startDate, endDate, today = new Date().toISOString().slice(0, 10)) {
  if (!startDate) return 'upcoming';
  if (endDate && endDate < today) return 'past';
  if (startDate <= today && (!endDate || endDate >= today)) return 'live';
  return 'upcoming';
}

export function deriveSetNumber(wikitext) {
  const navbox = /tft[ _]set[ _](\d+)[ _]esports[ _]navbox/i.exec(wikitext);
  if (navbox) return parseInt(navbox[1], 10);
  const counts = {};
  const re = /\{\{\s*setname\/(\d+)/gi;
  let m;
  while ((m = re.exec(wikitext))) counts[m[1]] = (counts[m[1]] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top ? parseInt(top[0], 10) : null;
}

export function countParticipants(wikitext) {
  const collect = (text, set) => {
    for (const opp of findAllTemplates(text, 'SoloOpponent')) {
      const { positional, keyed } = parseArgs(opp);
      const n = unwiki(positional.find(Boolean) || keyed['1'] || '');
      if (n) set.add(n.toLowerCase());
    }
  };
  const names = new Set();
  for (const tpl of ['ParticipantTable', 'ParticipantSection']) {
    for (const block of findAllTemplates(wikitext, tpl)) collect(block, names);
  }
  if (names.size === 0) collect(wikitext, names);
  return names.size || null;
}

export function participantsFromInfobox(fields) {
  const n = parseInt(fields?.participants_number || fields?.team_number || fields?.player_number || '0', 10);
  return n > 0 ? n : null;
}

export function numericTierToLetter(t) {
  const n = parseInt(t, 10);
  if (n === 1) return 'S';
  if (n === 2) return 'A';
  if (n === 3) return 'B';
  if (n === 4) return 'C';
  return null;
}

export const STANDINGS_LINK = /^https?:\/\/(docs\.google\.com\/spreadsheets\/|(www\.)?riot\.com\/|([a-z0-9-]+\.)?apactft\.com\/)/i;
export function standingsSources(links) {
  const out = [...new Set((links || []).filter(u => STANDINGS_LINK.test(u)))];
  return out.length ? out : null;
}

export function pageToSlug(page) {
  return page.toLowerCase().replace(/[\/_]/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');
}

export function parseInfobox(wikitext) {
  const info = findTemplateRange(wikitext, 'Infobox league');
  return info ? parseTemplateFields(info.body) : null;
}

// ─── Teams ──────────────────────────────────────────────────────────────

// Nur echte {{TeamCard|...}} mit Teamnamen. {{TeamCard columns start}} und
// {{TeamCardToggleButton}} sind Layout, keine Karten. Das `placement=` einer
// Karte ist oft das Vorjahres-Ergebnis und wird bewusst nicht gelesen.
export function parseTeamCards(wikitext) {
  const text = stripComments(wikitext);
  const cards = [];
  for (const t of findAllTemplateRanges(text, 'TeamCard')) {
    const { nameTail, keyed } = parseArgs(t.body);
    if (nameTail) continue;
    const team = cleanName(keyed.team);
    if (!team) continue;
    const players = Object.keys(keyed)
      .filter(k => /^p\d+$/.test(k))
      .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
      .map(k => ({
        name: cleanName(keyed[k]),
        link: cleanName(keyed[`${k}link`]) || null,
        flag: (keyed[`${k}flag`] || '').trim() || null,
      }))
      .filter(p => p.name);
    cards.push({ team, players });
  }
  return cards;
}

function normTeam(s) {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Teamname → Karte. Exakt (nach Normalisierung) und eindeutig; sonst ein
// eindeutiger Wortgrenzen-Praefix in beide Richtungen ("GLG Esports Club" ↔
// "GLG Esports"). Mehrdeutig → null.
export function resolveTeam(name, cards) {
  const n = normTeam(name);
  if (!n) return null;
  const exact = cards.filter(c => normTeam(c.team) === n);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const pref = cards.filter(c => {
    const t = normTeam(c.team);
    return t && (t.startsWith(`${n} `) || n.startsWith(`${t} `));
  });
  return pref.length === 1 ? pref[0] : null;
}

// ─── Prize Pool ─────────────────────────────────────────────────────────

const OPPONENTS = new Set(['soloopponent', 'duoopponent', 'teamopponent', 'opponent']);

function playersFromKeys(keyed) {
  return Object.keys(keyed)
    .filter(k => /^p\d+$/.test(k))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    .map(k => ({
      name: cleanName(keyed[k]),
      link: cleanName(keyed[`${k}link`]) || null,
      flag: (keyed[`${k}flag`] || '').trim() || null,
    }))
    .filter(p => p.name);
}

// Gegner-Vorlage → { kind, team, players, problem }. problem: null | 'empty'
// (kein Name eingetragen) | 'unresolved' (Teamname ohne passende Karte).
function opponentPlayers(ot, cards) {
  const { positional, keyed } = parseArgs(ot.body);
  const first = positional.find(Boolean) || '';
  const solo = () => {
    const name = cleanName(first || keyed.p1 || keyed['1']);
    if (!name) return { kind: 'solo', team: null, players: [], problem: 'empty' };
    const link = cleanName(keyed.link || keyed.p1link) || null;
    return { kind: 'solo', team: null, players: [{ name, link, flag: (keyed.flag || keyed.p1flag || '').trim() || null }], problem: null };
  };
  const duo = () => {
    const players = playersFromKeys(keyed);
    return { kind: 'duo', team: null, players, problem: players.length ? null : 'empty' };
  };
  const team = () => {
    const teamName = cleanName(first || keyed.team || keyed['1']);
    const inline = playersFromKeys(keyed);
    if (inline.length) return { kind: 'team', team: teamName || null, players: inline, problem: null };
    if (!teamName) return { kind: 'team', team: null, players: [], problem: 'empty' };
    const card = resolveTeam(teamName, cards);
    if (!card) return { kind: 'team', team: teamName, players: [], problem: 'unresolved' };
    return { kind: 'team', team: teamName, players: card.players, problem: null };
  };
  if (ot.name === 'soloopponent') return solo();
  if (ot.name === 'duoopponent') return duo();
  if (ot.name === 'teamopponent') return team();
  const type = String(keyed.type || '').trim().toLowerCase();
  if (type === 'solo') return solo();
  if (type === 'duo') return duo();
  if (type === 'team' || type === 'squad') return team();
  const players = playersFromKeys(keyed);
  if (players.length) return { kind: 'duo', team: null, players, problem: null };
  return { kind: 'unknown', team: first ? cleanName(first) : null, players: [], problem: 'unresolved' };
}

// Pools ohne die, die in einem anderen Pool stecken (z. B. im adjacentContent).
function topLevelPools(text) {
  const all = [];
  for (const name of POOL_TEMPLATES) {
    for (const t of findAllTemplateRanges(text, name)) all.push({ ...t, pool: name });
  }
  all.sort((a, b) => a.start - b.start);
  const top = [];
  for (const p of all) if (!top.some(o => p.start >= o.start && p.end <= o.end)) top.push(p);
  return top;
}

function placeRange(placeArg, rank, n) {
  const m = PLACE_RE.exec(String(placeArg || ''));
  const start = m ? parseInt(m[1], 10) : rank;
  const explicitEnd = m && m[2] ? parseInt(m[2], 10) : null;
  const end = explicitEnd ?? (start + Math.max(1, n) - 1);
  return { start, end, placementMax: end > start ? end : null };
}

/**
 * Platzierungen aus den Prize-Pool-Vorlagen einer Turnierseite.
 *
 * @param {string} wikitext
 * @param {object} [opts]
 * @param {Array}  [opts.teamPlaces]   Ergebnis von parsePlacementTableHtml —
 *                 nur fuer TeamPrizePools ohne eingetragene Teams.
 * @param {'full'|'split'} [opts.teamPrizeMode] nur TeamPrizePool-Teamzeilen.
 * @returns {{rows: Array, needsHtml: boolean, intact: boolean, unresolved: string[], pools: number}}
 */
export function extractPrizePoolPlacements(wikitext, { teamPlaces = null, teamPrizeMode = 'full', setNames = {} } = {}) {
  const text = stripComments(wikitext);
  const cards = parseTeamCards(text);
  const rows = [];
  const seen = new Set();
  const unresolved = [];
  let needsHtml = false, intact = true, htmlUsed = false;

  const push = (r) => {
    if (!r.placement || !r.proName) return;
    const key = `${r.placement}::${r.proName}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(r);
  };
  const share = (amount, n, split) => (amount == null ? null : split && n > 0 ? Math.round(amount / n) : amount);

  const pools = topLevelPools(text);
  for (const pool of pools) {
    const isTeamPool = pool.pool === 'TeamPrizePool';
    const { positional } = parseArgs(pool.body);
    let rank = 1;
    let poolNeedsHtml = false;
    const poolRows = [];
    const slotPrize = new Map();
    for (const seg of positional) {
      const st = asTemplate(seg);
      if (!st || st.name !== 'slot') continue;
      const { positional: sp, keyed: sk } = parseArgs(st.body);
      if ('award' in sk) continue;   // D1: Sonderpreise sind keine Platzierung
      const usd = parsePrize(sk.usdprize);
      const local = usd == null ? parsePrize(sk.localprize) : null;
      const opps = [];
      for (const s of sp) {
        const ot = asTemplate(s);
        if (ot && OPPONENTS.has(ot.name)) opps.push(ot);
      }
      const { start, placementMax, end } = placeRange(sk.place, rank, opps.length);
      rank = end + 1;
      if (!slotPrize.has(start)) slotPrize.set(start, { usd, local });
      if (opps.length === 0) {
        intact = false;
        if (isTeamPool) poolNeedsHtml = true;
        continue;
      }
      for (const ot of opps) {
        const o = opponentPlayers(ot, cards);
        if (o.problem) {
          intact = false;
          if (o.problem === 'empty' && (isTeamPool || o.kind === 'team')) poolNeedsHtml = true;
          if (o.problem === 'unresolved') unresolved.push(o.team || '(ohne Namen)');
          continue;
        }
        const split = isTeamPool && o.kind === 'team' && teamPrizeMode === 'split';
        for (const p of o.players) {
          poolRows.push({
            placement: start, placementMax, proName: p.name, link: p.link,
            team: o.team, country: p.flag,
            prizeUsdRaw: share(usd, o.players.length, split),
            prizeLocalRaw: share(local, o.players.length, split),
            kind: o.kind,
          });
        }
      }
    }

    if (poolNeedsHtml && isTeamPool && Array.isArray(teamPlaces) && teamPlaces.length && !htmlUsed) {
      // Teamnamen stehen nur in der gerenderten Tabelle: Plaetze von dort,
      // Spieler aus den TeamCards, Preis bevorzugt aus dem Slot desselben Platzes.
      htmlUsed = true;
      let htmlOk = true;
      for (const tp of teamPlaces) {
        const card = resolveTeam(tp.team, cards);
        if (!card) { unresolved.push(tp.team || '(ohne Namen)'); htmlOk = false; continue; }
        const sp = slotPrize.get(tp.placement);
        const usd = sp ? sp.usd : tp.prizeUsd ?? null;
        const local = sp && sp.usd == null ? sp.local : null;
        const split = teamPrizeMode === 'split';
        for (const p of card.players) {
          push({
            placement: tp.placement, placementMax: tp.placementMax ?? null, proName: p.name, link: p.link,
            team: tp.team, country: p.flag,
            prizeUsdRaw: share(usd, card.players.length, split),
            prizeLocalRaw: share(local, card.players.length, split),
            kind: 'team',
          });
        }
      }
      // Der Pool selbst war unvollstaendig; mit vollstaendiger Tabelle gilt
      // er als heil, sonst bleibt "nicht heil" stehen.
      if (htmlOk && unresolved.length === 0 && intact === false && pools.length === 1) intact = true;
      continue;
    }
    if (poolNeedsHtml) needsHtml = true;
    for (const r of poolRows) push(r);
  }

  if (pools.length === 0) {
    // Unbekannter Rahmen: alte Lesart (Slots seitenweit, sonst {{prize pool slot}}).
    // Ohne erkannten Pool gilt die Seite nie als heil — es wird nichts geloescht.
    intact = false;
    let rank = 1;
    const withoutAwards = text.replace(/\{\{\s*[Aa]wardPrizePool[\s\S]*?\n\}\}/g, '');
    for (const t of findAllTemplateRanges(withoutAwards, 'Slot')) {
      const { positional: sp, keyed: sk } = parseArgs(t.body);
      if ('award' in sk) continue;
      const usd = parsePrize(sk.usdprize);
      const local = usd == null ? parsePrize(sk.localprize) : null;
      const opps = sp.map(asTemplate).filter(ot => ot && OPPONENTS.has(ot.name));
      const { start, placementMax, end } = placeRange(sk.place, rank, opps.length);
      rank = end + 1;
      for (const ot of opps) {
        const o = opponentPlayers(ot, cards);
        if (o.problem) { if (o.problem === 'unresolved') unresolved.push(o.team || '(ohne Namen)'); continue; }
        for (const p of o.players) {
          push({ placement: start, placementMax, proName: p.name, link: p.link, team: o.team, country: p.flag, prizeUsdRaw: usd, prizeLocalRaw: local, kind: o.kind });
        }
      }
    }
    if (rows.length === 0) {
      for (const body of findAllTemplates(text, 'prize pool slot')) {
        const f = parseTemplateFields(body);
        const m = PLACE_RE.exec(f.place || '');
        const place = m ? parseInt(m[1], 10) : 0;
        const placeMax = m && m[2] ? parseInt(m[2], 10) : null;
        const proName = unwiki(f.p1 || f.player || f['1'] || '', { setNames });
        const usd = parsePrize(f.usdprize);
        const local = usd == null ? parsePrize(f.localprize) : null;
        push({
          placement: place, placementMax: placeMax && placeMax > place ? placeMax : null, proName,
          link: cleanName(f.p1link || f.link) || null, team: unwiki(f.team || '') || null,
          country: f.c1 || f.p1flag || f.flag || null, prizeUsdRaw: usd, prizeLocalRaw: local, kind: 'solo',
        });
      }
    }
  }

  return { rows, needsHtml, intact, unresolved, pools: pools.length };
}

/**
 * Sonderpreise aus den AwardPrizePool-Vorlagen (z. B. "1 Win Bounty", "Finals MVP").
 * Sie sind kein Platz und landen deshalb nicht in extractPrizePoolPlacements,
 * sondern in tft_tournament_awards (0087). Gezeigt wird "700 $ + 100 $ Bonus".
 *
 * `noprize=true` wird bewusst NICHT uebersprungen: Liquipedias Modul liest den
 * Schalter nur in alten Preistabellen fuer die Summenzeile
 * (Lua-Modules commons/PrizePool/Legacy.lua); der Sonderpreis wird trotzdem
 * gezeigt und als Preisgeld gespeichert (commons/PrizePool/Award/Placement.lua).
 * Sonderpreise ohne Betrag werden nicht zurueckgegeben.
 *
 * @returns {{rows: Array, intact: boolean, pools: number}} intact=false, wenn
 *          ein Sonderpreis keinen lesbaren Spieler hat — dann darf nichts
 *          geloescht werden.
 */
export function extractAwards(wikitext, { teamPrizeMode = 'full', setNames = {} } = {}) {
  const text = stripComments(wikitext);
  const cards = parseTeamCards(text);
  const rows = [];
  const seen = new Set();
  let intact = true;
  const share = (amount, n, split) => (amount == null ? null : split && n > 0 ? Math.round(amount / n) : amount);
  const pools = findAllTemplateRanges(text, 'AwardPrizePool');
  for (const pool of pools) {
    const { positional, keyed: pk } = parseArgs(pool.body);
    // {{Opponent|Name}} ohne type= gilt als Art des Pools, ohne Angabe als
    // Einzelspieler — Sonderpreise sind fast immer persoenlich (EWC 2025:
    // {{Opponent|Saopimi|flag=cn|team=Weibo Gaming}} als Finals MVP).
    const poolType = String(pk.type || '').trim().toLowerCase() || 'solo';
    for (const seg of positional) {
      const st = asTemplate(seg);
      if (!st || st.name !== 'slot') continue;
      const { positional: sp, keyed: sk } = parseArgs(st.body);
      const award = unwiki(sk.award || '', { setNames });
      if (!award) continue;
      const usd = parsePrize(sk.usdprize);
      const local = usd == null ? parsePrize(sk.localprize) : null;
      if (usd == null && local == null) continue;
      const opps = sp.map(asTemplate).filter(ot => ot && OPPONENTS.has(ot.name));
      if (opps.length === 0) { intact = false; continue; }
      for (const ot of opps) {
        const typed = ot.name === 'opponent' && !('type' in parseArgs(ot.body).keyed)
          ? { ...ot, body: `${ot.body}|type=${poolType}` } : ot;
        const o = opponentPlayers(typed, cards);
        if (o.problem) { intact = false; continue; }
        if (!o.team) o.team = cleanName(parseArgs(ot.body).keyed.team) || null;
        const split = o.kind === 'team' && teamPrizeMode === 'split';
        for (const p of o.players) {
          const key = `${award}::${p.name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push({
            award, proName: p.name, link: p.link, team: o.team, country: p.flag,
            prizeUsdRaw: share(usd, o.players.length, split),
            prizeLocalRaw: share(local, o.players.length, split),
            kind: o.kind,
          });
        }
      }
    }
  }
  return { rows, intact, pools: pools.length };
}

// ─── Gerenderte Platzierungstabelle (Team-Turniere) ─────────────────────

function cellsOf(rowHtml) {
  const cells = [];
  const re = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = re.exec(rowHtml))) cells.push({ tag: m[1], attrs: m[2], inner: m[3] });
  return cells;
}

function attr(attrs, name) {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs || '');
  return m ? decodeEntities(m[1]) : null;
}

function rowsOf(tableHtml) {
  const out = [];
  const re = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = re.exec(tableHtml))) out.push({ attrs: m[1], inner: m[2] });
  return out;
}

function tablesWithClass(html, cls) {
  const out = [];
  const re = /<table\b([^>]*)>([\s\S]*?)<\/table>/g;
  let m;
  while ((m = re.exec(html || ''))) {
    const c = decodeEntities(attr(m[1], 'class') || '');
    if (c.split(/\s+/).includes(cls)) out.push(m[2]);
  }
  return out;
}

function nameAnchorText(inner) {
  const m = /<span class="name"[^>]*>([\s\S]*?)<\/span>/.exec(inner || '');
  return m ? stripTags(m[1]) : '';
}

// Plaetze, Teamnamen und Preise aus `prizepooltable-placement`. Platz und
// Preis gelten ueber rowspan auch fuer die Folgezeilen.
export function parsePlacementTableHtml(html) {
  const out = [];
  for (const table of tablesWithClass(html, 'prizepooltable-placement')) {
    let place = null, placeMax = null, prize = null;
    for (const row of rowsOf(table)) {
      const cells = cellsOf(row.inner);
      if (cells.some(c => c.tag === 'th')) continue;
      let teamCell = null;
      for (const c of cells) {
        const cls = attr(c.attrs, 'class') || '';
        if (/\bprizepooltable-place\b/.test(cls)) {
          const m = PLACE_RE.exec(stripTags(c.inner));
          place = m ? parseInt(m[1], 10) : null;
          placeMax = m && m[2] ? parseInt(m[2], 10) : null;
          prize = null;
        } else if (/\bprizepooltable-col-team\b/.test(cls) || /block-(team|player)/.test(c.inner)) {
          if (!teamCell) teamCell = c;
        } else if (attr(c.attrs, 'data-align') === 'right' && teamCell && prize === null) {
          prize = parsePrize(stripTags(c.inner));
          if (prize === null) prize = 0;   // Markierung: Zelle gesehen, ohne Betrag
        }
      }
      if (!teamCell || place == null) continue;
      const team = nameAnchorText(teamCell.inner) || null;
      out.push({ placement: place, placementMax: placeMax && placeMax > place ? placeMax : null, team: team && !/^tbd$/i.test(team) ? team : null, prizeUsd: prize || null });
    }
  }
  return out;
}

// ─── Spieler-Ergebnisliste <Spieler>/Results ────────────────────────────

const RESULTS_HEADERS = { date: 'date', place: 'place', tier: 'tier', tournament: 'tournament', team: 'team', prize: 'prize' };

function anchorsOf(inner) {
  const out = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(inner || ''))) {
    out.push({
      href: attr(m[1], 'href'),
      title: attr(m[1], 'title'),
      cls: attr(m[1], 'class') || '',
      text: stripTags(m[2]),
    });
  }
  return out;
}

function stripRedlink(title) {
  return String(title || '').replace(/\s*\(page does not exist\)\s*$/, '').trim();
}

function titleToPage(title) {
  return stripRedlink(title).replace(/ /g, '_');
}

function absoluteHref(href) {
  if (!href) return null;
  if (/^https?:\/\//.test(href)) return href;
  return `${LIQUIPEDIA_ORIGIN}${href.startsWith('/') ? '' : '/'}${href}`;
}

function encodePage(page) {
  return page.split('/').map(seg => encodeURIComponent(seg).replace(/%3A/gi, ':').replace(/%2C/gi, ',')).join('/');
}

/**
 * Liest die Ergebnistabelle einer Spieler-Unterseite.
 * @returns {{ headerFound: boolean, rows: Array }}
 */
export function parseResultsHtml(html, { playerName = '', aliases = [] } = {}) {
  const out = [];
  let headerFound = false;
  const tableRe = /<table\b([^>]*)>([\s\S]*?)<\/table>/g;
  let tm;
  while ((tm = tableRe.exec(html || ''))) {
    const rows = rowsOf(tm[2]);
    // Spaltenplan aus der Kopfzeile; Tournament = letzte Spalte seiner Spanne
    // (die erste ist nur das Symbol).
    let colMap = null, total = 0;
    for (const r of rows) {
      const cells = cellsOf(r.inner);
      if (!cells.length || !cells.every(c => c.tag === 'th')) continue;
      const map = {};
      let col = 0;
      for (const c of cells) {
        const span = parseInt(attr(c.attrs, 'colspan') || '1', 10) || 1;
        const key = RESULTS_HEADERS[stripTags(c.inner).toLowerCase()];
        if (key) map[key] = col + span - 1;
        col += span;
      }
      if (map.date != null && map.place != null && map.tournament != null) { colMap = map; total = col; }
      break;
    }
    if (!colMap) continue;
    headerFound = true;

    const body = [];
    for (const r of rows) {
      if (/display\s*:\s*none/.test(r.attrs)) continue;
      const cells = cellsOf(r.inner);
      if (!cells.length || cells.some(c => c.tag === 'th')) continue;
      body.push(cells);
    }

    // Eigener Name, wie die Liste ihn schreibt: haeufigster Sortierwert der
    // leeren Team-Zellen (Einzel-Ergebnisse ohne Team).
    const selfCounts = new Map();
    for (const cells of body) {
      const tc = cells[colMap.team ?? -1];
      if (!tc || /block-(team|player)/.test(tc.inner)) continue;
      const v = (attr(tc.attrs, 'data-sort-value') || '').trim();
      if (v) selfCounts.set(v, (selfCounts.get(v) || 0) + 1);
    }
    const inferredSelf = [...selfCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    // Weiterleitungen auf die Spielerseite (D12, z. B. Deleted → JosueDeleted)
    // sind derselbe Spieler — sonst stuende er als eigener Duo-Partner da.
    // Seitennamen tragen _ statt Leerzeichen: beide Schreibweisen aufnehmen.
    const selfNames = new Set([playerName, inferredSelf, ...aliases].filter(Boolean)
      .flatMap(s => [String(s).toLowerCase(), String(s).replace(/_/g, ' ').toLowerCase()]));

    for (const cells of body) {
      const pick = (key) => {
        const idx = colMap[key];
        if (idx == null) return null;
        if (cells.length === total) return cells[idx] || null;
        // Weniger Zellen als Spalten: ab der Turnier-Spalte von hinten zaehlen.
        if (idx >= colMap.tournament) return cells[cells.length - (total - idx)] || null;
        return cells[idx] || null;
      };
      const dateCell = pick('date'), placeCell = pick('place'), tierCell = pick('tier');
      const tourCell = pick('tournament'), teamCell = pick('team'), prizeCell = pick('prize');
      if (!tourCell) continue;

      const dateText = stripTags(dateCell?.inner);
      const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
      const date = dm && dm[1] !== '0000' ? dateText : null;

      const ptm = /class="placement-text"[^>]*>([\s\S]*?)<\/span>/.exec(placeCell?.inner || '');
      const placeText = stripTags(ptm ? ptm[1] : placeCell?.inner);
      const sortPlace = attr(placeCell?.attrs, 'data-sort-value') || placeText;
      const pm = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(sortPlace || '') || PLACE_RE.exec(placeText || '');
      const placement = pm ? parseInt(pm[1], 10) : null;
      const placementMax = pm && pm[2] && parseInt(pm[2], 10) > placement ? parseInt(pm[2], 10) : null;

      const tierA = anchorsOf(tierCell?.inner).find(a => a.text);
      const tierText = tierA ? tierA.text : stripTags(tierCell?.inner);
      const tier = !tierText || /^misc$/i.test(tierText) ? null : tierText;

      const tourA = anchorsOf(tourCell.inner).filter(a => a.text).pop();
      if (!tourA) continue;
      const pageTitle = tourA.title ? titleToPage(tourA.title) : null;
      const isRed = /\bnew\b/.test(tourA.cls) || /redlink=1/.test(tourA.href || '');
      const url = pageTitle
        ? (isRed ? `${LIQUIPEDIA_ORIGIN}/tft/${encodePage(pageTitle)}` : absoluteHref(tourA.href))
        : null;

      let mode = 'solo', team = null, partners = [];
      const tInner = teamCell?.inner || '';
      const tSort = (attr(teamCell?.attrs, 'data-sort-value') || '').trim();
      if (/block-players-wrapper/.test(tInner)) {
        mode = 'duo';
        const names = [];
        const re = /<div class="block-player"[\s\S]*?<span class="name"[^>]*>([\s\S]*?)<\/span>/g;
        let m;
        while ((m = re.exec(tInner))) names.push(stripTags(m[1]));
        partners = names.filter(n => n && !selfNames.has(n.toLowerCase()));
      } else if (/block-team/.test(tInner)) {
        const nm = /<span class="name"[^>]*>([\s\S]*?)<\/span>/.exec(tInner);
        const a = nm ? anchorsOf(nm[1])[0] : null;
        const teamName = a ? (stripRedlink(a.title) || a.text) : stripTags(nm?.[1]);
        if (selfNames.has(tSort.toLowerCase())) { mode = 'solo'; team = teamName || null; }
        else { mode = 'team'; team = teamName || tSort || null; }
      }

      const prizeText = stripTags(prizeCell?.inner);
      const prize = /\$/.test(prizeText) ? parsePrize(prizeText) : null;

      out.push({
        date, placeText, placement, placementMax,
        win: placeText === '1st',
        tier, tournament: tourA.text, pageTitle, url,
        mode, team, partners, prizeUsd: prize,
      });
    }
  }
  return { headerFound, rows: out };
}

// ─── Abruf-Helfer (ohne Cache) ──────────────────────────────────────────

export class LiquipediaApiError extends Error {
  constructor(code, info) {
    super(`Liquipedia API-Fehler ${code}: ${info || ''}`.trim());
    this.name = 'LiquipediaApiError';
    this.code = code;
  }
}

// Normalisierung → Weiterleitung (Kette bis 5) → Seite, je angefragtem Titel.
export function parseBatchResponse(json, requested) {
  const q = json?.query || {};
  const norm = new Map((q.normalized || []).map(n => [n.from, n.to]));
  const redir = new Map((q.redirects || []).map(r => [r.from, r.to]));
  const pages = new Map();
  for (const p of Object.values(q.pages || {})) {
    if (!p || p.missing !== undefined || p.invalid !== undefined) continue;
    const rev = p.revisions?.[0];
    const content = rev?.slots?.main?.['*'] ?? rev?.['*'] ?? null;
    pages.set(p.title, { title: p.title, content });
  }
  const byRequested = new Map();
  const missing = [];
  const redirects = [];
  for (const req of requested) {
    let t = norm.get(req) ?? req;
    for (let hop = 0; hop < 5 && redir.has(t); hop++) {
      const to = redir.get(t);
      redirects.push({ from: t, to });
      t = to;
    }
    const page = pages.get(t);
    if (page && page.content != null) byRequested.set(req, page);
    else missing.push(req);
  }
  return { byRequested, missing, redirects };
}

function mergeQuery(into, j) {
  const q = j?.query || {};
  for (const n of q.normalized || []) if (!into.normalized.some(x => x.from === n.from)) into.normalized.push(n);
  for (const r of q.redirects || []) if (!into.redirects.some(x => x.from === r.from)) into.redirects.push(r);
  for (const [id, p] of Object.entries(q.pages || {})) {
    const prev = into.pages[id];
    if (!prev || (!prev.revisions && p.revisions) || (!prev.redirects && p.redirects)) into.pages[id] = { ...prev, ...p };
    else if (prev.redirects && p.redirects) into.pages[id] = { ...prev, redirects: [...prev.redirects, ...p.redirects] };
  }
}

async function queryAll(params, fetchJson, maxRounds = 20) {
  const merged = { normalized: [], redirects: [], pages: {} };
  let cont = {};
  for (let round = 0; round < maxRounds; round++) {
    const j = await fetchJson({ ...params, ...cont }, { noCache: true });
    if (!j) throw new LiquipediaApiError('http404', 'leere Antwort');
    if (j.error) throw new LiquipediaApiError(j.error.code, j.error.info);
    mergeQuery(merged, j);
    if (!j.continue) return { query: merged };
    cont = j.continue;
  }
  throw new LiquipediaApiError('continue', `mehr als ${maxRounds} Fortsetzungen`);
}

// Wikitext vieler Seiten, 50 je Anfrage, Weiterleitungen aufgeloest.
export async function fetchWikitextBatch(titles, { fetchJson = liquipediaJson } = {}) {
  const byRequested = new Map();
  const missing = [];
  const redirects = [];
  for (const group of chunk([...new Set(titles)], 50)) {
    const json = await queryAll({
      action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main',
      redirects: '1', titles: group.join('|'),
    }, fetchJson);
    const r = parseBatchResponse(json, group);
    for (const [k, v] of r.byRequested) byRequested.set(k, v);
    missing.push(...r.missing);
    redirects.push(...r.redirects);
  }
  return { byRequested, missing, redirects };
}

// Gerendertes HTML einer Seite, frisch. Fehlt die Seite (404 oder
// missingtitle) → null. Andere Fehler werfen.
export async function fetchHtmlFresh(title, { fetchJson = liquipediaJson } = {}) {
  const j = await fetchJson({ action: 'parse', page: title, prop: 'text', disablelimitreport: '1', redirects: '1' }, { noCache: true });
  if (!j) return null;
  if (j.error) {
    if (j.error.code === 'missingtitle') return null;
    throw new LiquipediaApiError(j.error.code, j.error.info);
  }
  return {
    html: j.parse?.text?.['*'] ?? '',
    title: j.parse?.title ?? title,
    redirects: Array.isArray(j.parse?.redirects) ? j.parse.redirects : [],
  };
}

// Echter Seitenname je angefragtem Titel (Normalisierung + Weiterleitung),
// null = Seite fehlt. Noetig, weil Unterseiten einer Weiterleitung nicht
// mitwandern: "Alt/Results" existiert nicht, wenn "Alt" nur auf "Neu" zeigt.
export async function resolveTitles(titles, { fetchJson = liquipediaJson } = {}) {
  const out = new Map();
  for (const group of chunk([...new Set(titles)], 50)) {
    const json = await queryAll({ action: 'query', redirects: '1', titles: group.join('|') }, fetchJson);
    const q = json.query;
    const norm = new Map((q.normalized || []).map(n => [n.from, n.to]));
    const redir = new Map((q.redirects || []).map(r => [r.from, r.to]));
    const existing = new Set(Object.values(q.pages || {}).filter(p => p.missing === undefined && p.invalid === undefined).map(p => p.title));
    for (const req of group) {
      let t = norm.get(req) ?? req;
      for (let hop = 0; hop < 5 && redir.has(t); hop++) t = redir.get(t);
      out.set(req, existing.has(t) ? t : null);
    }
  }
  return out;
}

// Weiterleitungen AUF die angefragten Seiten → Map(angefragt → [Aliasnamen]).
export async function fetchRedirectAliases(pages, { fetchJson = liquipediaJson } = {}) {
  const out = new Map();
  for (const group of chunk([...new Set(pages)], 50)) {
    const json = await queryAll({ action: 'query', prop: 'redirects', rdlimit: 'max', titles: group.join('|') }, fetchJson);
    const q = json.query;
    const norm = new Map((q.normalized || []).map(n => [n.from, n.to]));
    const byTitle = new Map();
    for (const p of Object.values(q.pages || {})) {
      if (p.missing !== undefined) continue;
      byTitle.set(p.title, (p.redirects || []).map(r => r.title));
    }
    for (const req of group) {
      const t = norm.get(req) ?? req;
      out.set(req, byTitle.get(t) || []);
    }
  }
  return out;
}
