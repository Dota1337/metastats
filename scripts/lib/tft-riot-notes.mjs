// Aenderungszeilen aus Riots Patch-Notes (richText-HTML der Notes-Seite).
//
// Riot schreibt jede Aenderung als verschachtelte Liste:
//   <li><strong>Riftbeast (7)</strong><ul><li>AD/AP: 6% <span>⇒ </span>5%</li></ul></li>
// Daraus wird { entity, label, old, new }. Massstab fuer alle Zahlen-Korrekturen
// (tft-value-corrections.mjs), weil nur diese Seite den Mid-Patch-Teil hat: die
// tactics.tools-Datei public/tft-patch-notes-*.json fuehrt ihn nicht und klebt
// Eintraege zusammen (gemessen 01.11.2026 an 18.5).
//
// Reihenfolge der Rueckgabe ist die zeitliche: erst der Patch, dann die
// Mid-Patch-Updates, aeltestes zuerst. Auf der Seite steht es umgekehrt.

const ARROW = /⇒|&rArr;|&#8658;/;

const DECODE = [[/&nbsp;/g, ' '], [/&amp;/g, '&'], [/&#x27;|&#39;|&rsquo;|’/g, "'"], [/&gt;/g, '>'], [/&lt;/g, '<'], [/&quot;/g, '"']];

function plain(html) {
  let s = String(html).replace(/<[^>]+>/g, ' ');
  for (const [re, to] of DECODE) s = s.replace(re, to);
  return s.replace(/\s+/g, ' ').trim();
}

function splitChange(text) {
  const cut = text.search(ARROW);
  if (cut < 0) return null;
  const left = text.slice(0, cut).trim();
  const right = text.slice(cut).replace(ARROW, '').trim();
  const colon = left.lastIndexOf(':');
  // Ohne Doppelpunkt („Riftbeast (7) Stats 6% ⇒ 5%“) kein sicherer Alt-Wert.
  if (colon < 0) return null;
  const old = left.slice(colon + 1).trim();
  if (!old || !right) return null;
  return { label: left.slice(0, colon).trim(), old, new: right };
}

// Beschreibende Zeile zwischen Name und Zahl („Cooking Pot · Is now excluded from … ·
// HP per Emblem: 60 ⇒ 70“, 18.5). Sie ist kein Name und darf den echten nicht ersetzen.
const SENTENCE = /^(is|are|now|no longer|can|cannot|will|does|do)\b/i;

// Eine Aenderung ist nur brauchbar, wenn beide Seiten eine Zahl tragen.
// „Bonus AS: Now grants ...“ faellt damit raus.
const hasNumber = s => /\d/.test(s);

function changesOfSection(html, meta) {
  const out = [];
  // Name je Listen-Tiefe. Riot setzt die Unterliste mal in das <li> des Namens,
  // mal als Geschwister dahinter — die Tiefe stimmt in beiden Faellen.
  const names = [];
  const re = /<(\/?)(ul|li|h[1-6])\b[^>]*>/g;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    if (m[2] === 'ul') {
      depth = Math.max(0, depth + (m[1] ? -1 : 1));
      names.length = Math.min(names.length, depth + 1);
      continue;
    }
    if (m[2] !== 'li') {
      if (!m[1]) { names.length = 0; depth = 0; }
      continue;
    }
    if (m[1]) continue;
    // Eigener Text bis zum naechsten Listen-Tag.
    const rest = html.slice(re.lastIndex);
    const end = rest.search(/<\/?(?:ul|li)\b/);
    const text = plain(end < 0 ? rest : rest.slice(0, end));
    if (!ARROW.test(text)) { if (!SENTENCE.test(text)) names[depth] = text; continue; }
    const c = splitChange(text);
    if (!c || !hasNumber(c.old) || !hasNumber(c.new)) continue;
    // Dritte Form (18.5 Augmente): der Name steht als eigenes <li> direkt davor,
    // auf derselben Tiefe.
    out.push({ entity: names[depth - 1] ?? names[depth] ?? null, ...c, ...meta });
  }
  return out;
}

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

function dayRank(heading) {
  const m = new RegExp(`(${MONTHS.join('|')})\\s+(\\d{1,2})`).exec(heading.toUpperCase());
  return m ? MONTHS.indexOf(m[1]) * 100 + Number(m[2]) : null;
}

/**
 * Alle Aenderungszeilen einer Notes-Seite in zeitlicher Reihenfolge.
 * `patch` wird nur durchgereicht, damit Meldungen ihre Herkunft nennen.
 */
export function parseRiotChanges(body, patch = null) {
  const main = [];
  const mids = [];
  // Zerlegen an den h2: jeder Abschnitt ist Mid-Patch oder Patch.
  for (const part of String(body).split(/(?=<h2[\s>])/)) {
    if (!part.includes('patch-midpatch-updates')) {
      // Abschnitt mitgeben: „Blue Buff“ unter RADIANT ITEMS meint das Radiant-Item.
      const section = plain(/^<h2[^>]*>([\s\S]*?)<\/h2>/.exec(part)?.[1] ?? '') || null;
      main.push(...changesOfSection(part, { patch, mid: false, section }));
      continue;
    }
    // Mid-Patch: je Datums-Ueberschrift ein Block, mal h3, mal h4.
    let current = null;
    for (const block of part.split(/(?=<h[34][\s>])/)) {
      const h = /^<h[34][^>]*>([\s\S]*?)<\/h[34]>/.exec(block);
      const rank = h ? dayRank(plain(h[1])) : null;
      if (rank != null) { current = { rank, html: '' }; mids.push(current); }
      if (current) current.html += block;
    }
  }
  mids.sort((a, b) => a.rank - b.rank);
  return [...main, ...mids.flatMap(b => changesOfSection(b.html, { patch, mid: true }))];
}

// ---------------------------------------------------------------- Vergleich

/** Englischer Name in den Notes gegen Namen im Bundle: Gross/Klein, Apostroph, Bindestrich, Klammer. */
export function nameKey(s) {
  return String(s ?? '').replace(/\(.*?\)/g, '').toLowerCase().replace(/[’'`\-.\s]/g, '');
}

/** Die Zahlen einer Seite: „190/285/470 AD“ → [190, 285, 470]. */
export function seriesOf(side) {
  const m = /-?\d+(?:[.,]\d+)?(?:\s*\/\s*-?\d+(?:[.,]\d+)?)*/.exec(String(side));
  if (!m) return [];
  return m[0].split('/').map(x => Number(x.trim().replace(',', '.')));
}

export const isPercent = side => /%/.test(String(side));
