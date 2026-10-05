// Patch-Name je Sammeltag — die EINE Regel fuer alle, die TFT-Statistik
// schreiben oder umbenennen (Sammler, Treiber, Umbenennung, Explorer, Vertrag).
//
// Quellen in public/tft-set.json:
//   patchStarts  [{ set, patch: "18.4", from_day, seen_at, pinned? }]
//                Riots Terminplan (scripts/detect-tft-patch-schedule.mjs).
//                `pinned` ist der einzige Hand-Eingriff: den ueberschreibt
//                kein Bot.
//   patchCuts    [{ set, patch: "18.3b", base: "18.3", from_day, … }]
//                B-Patches aus Riots Patch-Notes (scripts/detect-tft-bpatches.mjs).
//   latestPatch  nur noch Rueckfall, wenn der Terminplan den Tag nicht abdeckt.
//
// Tag-Regel (User 2026-10-04): Der Go-Live-Tag laut Terminplan gehoert zum
// neuen Patch, der Vortag zum alten. "Tag" ist der Sammeltag des Crawlers, also
// das Fenster [D 05:00 UTC, D+1 05:00 UTC) aus tft-crawl-window.mjs.
//
// Warum nicht mehr ddragon: Der LoL-Patch erscheint dort bis zu zwei Tage nach
// dem TFT-Go-Live. So landeten der 23. und 24.09.2026 als 18.2b statt 18.3 /
// 18.3b in der Datenbank. Riots Match-Daten helfen nicht, `game_version` traegt
// seit Set 18 keine Nummer mehr ("TFT Unreal Version ?.?.?.?").
//
// Bewusst rein: liest keine Datei, wirft nie. Wer bestehende Zeilen umbenennt,
// verlangt `trusted` — ein Name aus dem Rueckfall darf das nie.
// Gegenstelle fuer alte LoL-foermige Labels: app/lib/tft-patch-label.ts
// (Kreuztest in tft-patch-day.test.mjs).

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const BASE_RE = /^(\d+)\.(\d+)$/;

// LoL-Patch, an dem jede Set "Minor 0" hat: LoL anchor.N+k = TFT set.k.
// Set 17 "Space Gods": TFT 17.1 = LoL 16.8 (Go-Live 2026-04-15).
// Set 18 "Enchanted Wilds": TFT 18.1 = LoL 16.17 (Go-Live 2026-08-26).
// Neue Set: Eintrag ERGAENZEN, alte nicht loeschen — Verlaufsseiten brauchen
// sie. check-drift.mjs bricht ab, wenn das laufende Set fehlt.
export const SET_LAUNCH_LOL = {
  17: '16.7',
  18: '16.16',
};

export function baseOf(patch) {
  const m = String(patch ?? '').match(/^(\d+)\.(\d+)/);
  return m ? `${Number(m[1])}.${Number(m[2])}` : null;
}

export function isDay(d) {
  if (typeof d !== 'string' || !DAY_RE.test(d)) return false;
  const t = Date.parse(d + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d;
}

export function addDays(day, n) {
  return new Date(Date.parse(day + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
}

const minorOf = (base) => Number(base.split('.')[1]);
const setOfBase = (base) => Number(base.split('.')[0]);
const byDay = (a, b) => (a.from_day < b.from_day ? -1 : a.from_day > b.from_day ? 1 : 0);

// Gueltige Termine aller Sets, nach Datum sortiert, plus alles Verworfene.
function readStarts(meta) {
  const starts = [];
  const problems = [];
  const raw = meta?.patchStarts;
  if (raw != null && !Array.isArray(raw)) problems.push('patchStarts ist keine Liste');
  for (const s of Array.isArray(raw) ? raw : []) {
    const patch = String(s?.patch ?? '');
    if (!BASE_RE.test(patch) || !isDay(s?.from_day) || Number(s?.set) !== setOfBase(patch)) {
      problems.push(`Terminplan-Eintrag verworfen: ${JSON.stringify(s)}`);
      continue;
    }
    starts.push({ ...s, set: Number(s.set), patch: baseOf(patch) });
  }
  starts.sort(byDay);
  // Je Set muessen Datum und Nummer gemeinsam steigen: keine Basis doppelt,
  // keine zwei Patches am selben Tag.
  const lastBySet = new Map();
  for (const s of starts) {
    const prev = lastBySet.get(s.set);
    if (prev && (minorOf(s.patch) <= minorOf(prev.patch) || s.from_day === prev.from_day)) {
      problems.push(`Terminplan widerspruechlich: ${prev.patch} am ${prev.from_day}, ${s.patch} am ${s.from_day}`);
    }
    lastBySet.set(s.set, s);
  }
  return { starts, problems };
}

function readCuts(meta, set) {
  const cuts = [];
  const problems = [];
  for (const c of Array.isArray(meta?.patchCuts) ? meta.patchCuts : []) {
    if (Number(c?.set) !== set) continue;
    const base = baseOf(c?.base);
    if (!base || !isDay(c?.from_day) || !new RegExp(`^${base.replace('.', '\\.')}[a-z]$`).test(String(c?.patch))) {
      problems.push(`B-Patch-Eintrag verworfen: ${JSON.stringify(c)}`);
      continue;
    }
    cuts.push({ ...c, base });
  }
  cuts.sort(byDay);
  return { cuts, problems };
}

/** Gueltige Termine einer Set, nach Datum sortiert. */
export function startsFor(meta, set = meta?.setNumber) {
  return readStarts(meta).starts.filter((s) => s.set === Number(set));
}

/**
 * Alles, was an Terminplan und B-Patches einer Set nicht zusammenpasst.
 * Leer = sauber. Ein einziger Eintrag hier macht JEDEN Tag `untrusted` —
 * wer umbenennt, soll bei kaputten Eingaben gar nicht erst anfangen.
 */
export function scheduleProblems(meta, set = meta?.setNumber) {
  const setNum = Number(set);
  const { starts, problems } = readStarts(meta);
  const { cuts, problems: cutProblems } = readCuts(meta, setNum);
  problems.push(...cutProblems);
  const own = starts.filter((s) => s.set === setNum);
  if (!own.length) return problems;
  for (const c of cuts) {
    const i = own.findIndex((s) => s.patch === c.base);
    if (i < 0) {
      problems.push(`B-Patch ${c.patch}: Basis ${c.base} fehlt im Terminplan`);
      continue;
    }
    if (c.from_day <= own[i].from_day) {
      problems.push(`B-Patch ${c.patch} ab ${c.from_day} liegt nicht nach dem Go-Live von ${c.base} (${own[i].from_day})`);
    }
    const next = own[i + 1];
    if (next && c.from_day >= next.from_day) {
      problems.push(`B-Patch ${c.patch} ab ${c.from_day} liegt nach dem Go-Live von ${next.patch} (${next.from_day})`);
    }
  }
  return problems;
}

/**
 * Patch-Name fuer einen Sammeltag.
 *
 * @returns {{ patch: string|null, base: string|null,
 *             source: 'schedule'|'schedule+cut'|'fallback',
 *             trusted: boolean, beyondSchedule: boolean, warnings: string[] }}
 *   trusted         Name stammt aus dem Terminplan, der Tag liegt vor dem
 *                   letzten bekannten Termin, die Set ist nicht abgeloest, und
 *                   keine Eingabe war kaputt. Nur dann darf umbenannt werden.
 *   beyondSchedule  Nach dem Tag kennt der Terminplan keinen Termin mehr —
 *                   ein neuer Patch koennte unbemerkt live sein.
 */
export function patchForDay(day, meta, set = meta?.setNumber) {
  const warnings = [];
  const none = () => ({ patch: null, base: null, source: 'fallback', trusted: false, beyondSchedule: false, warnings });

  if (!isDay(day)) {
    warnings.push(`ungueltiger Tag ${JSON.stringify(day)}`);
    return none();
  }
  const setNum = Number(set);
  if (!Number.isInteger(setNum) || setNum <= 0) {
    warnings.push(`ungueltige Set ${JSON.stringify(set)}`);
    return none();
  }

  const problems = scheduleProblems(meta, setNum);
  warnings.push(...problems);
  const { starts: all } = readStarts(meta);
  const own = all.filter((s) => s.set === setNum);
  let start = null;
  for (const s of own) if (s.from_day <= day) start = s;

  let base;
  let source;
  if (start) {
    base = start.patch;
    source = 'schedule';
  } else {
    const lp = baseOf(meta?.latestPatch);
    if (!lp || setOfBase(lp) !== setNum) {
      warnings.push(`weder Terminplan noch latestPatch fuer Set ${setNum}`);
      return none();
    }
    base = lp;
    source = 'fallback';
    warnings.push(own.length
      ? `Tag ${day} liegt vor dem ersten Termin der Set ${setNum} (${own[0].from_day}) — Rueckfall auf latestPatch ${lp}`
      : `kein Terminplan fuer Set ${setNum} — Rueckfall auf latestPatch ${lp}`);
  }

  // B-Patch: der juengste Schnitt derselben Basis, der am Tag schon gilt.
  let cut = null;
  for (const c of readCuts(meta, setNum).cuts) {
    if (c.base === base && c.from_day <= day) cut = c;
  }
  const patch = cut ? cut.patch : base;
  if (cut && source === 'schedule') source = 'schedule+cut';

  const beyondSchedule = !all.some((s) => s.from_day > day);
  if (beyondSchedule) warnings.push(`nach ${day} kennt der Terminplan keinen Termin — ein neuer Patch bliebe unbemerkt`);
  const successor = all.find((s) => s.set > setNum && s.from_day <= day);
  if (successor) warnings.push(`Set ${setNum} ist seit ${successor.from_day} abgeloest (${successor.patch})`);

  const trusted = source !== 'fallback' && !beyondSchedule && !successor && problems.length === 0;
  return { patch, base, source, trusted, beyondSchedule, warnings };
}

/**
 * Lueckenlose Abschnitte einer Set: [{ patch, base, from_day, to_day }],
 * to_day einschliesslich, null = offen. Abgeleitet aus patchForDay an jeder
 * Grenze, damit beide nie auseinanderlaufen. Ohne Terminplan: [].
 */
export function patchRanges(meta, set = meta?.setNumber) {
  const setNum = Number(set);
  const { starts: all } = readStarts(meta);
  const own = all.filter((s) => s.set === setNum);
  if (!own.length) return [];
  const first = own[0].from_day;
  const successor = all.find((s) => s.set > setNum);
  const end = successor ? addDays(successor.from_day, -1) : null;

  const bounds = new Set(own.map((s) => s.from_day));
  for (const c of readCuts(meta, setNum).cuts) {
    if (c.from_day >= first && (!end || c.from_day <= end)) bounds.add(c.from_day);
  }
  const ranges = [];
  for (const d of [...bounds].sort()) {
    if (end && d > end) continue;
    const r = patchForDay(d, meta, setNum);
    if (!r.patch) continue;
    const last = ranges[ranges.length - 1];
    if (last && last.patch === r.patch) continue;
    if (last) last.to_day = addDays(d, -1);
    ranges.push({ patch: r.patch, base: r.base, from_day: d, to_day: end });
  }
  return ranges;
}

const PATCH_RE = /^([1-9]\d*)\.([1-9]\d*)([a-z]?)$/;
const SET_RE = /^[1-9]\d*$/;

/**
 * Patch-Name, unter dem ein Sammel-Lauf schreibt. Der Treiber rechnet ihn
 * einmal je Lauf und reicht ihn als --set/--patch an jede Region weiter; seine
 * Vorgabe gewinnt, eine abweichende eigene Rechnung wird nur gemeldet. So
 * schreiben alle Regionen eines Laufs denselben Namen, auch wenn
 * tft-set.json mitten im Lauf neu ausgerollt wird.
 *
 * @returns {{ set: number|null, patch: string|null, warnings: string[], error: string|null }}
 *   error  gesetzt = nicht sammeln, nichts schreiben.
 */
export function crawlPatch(day, meta, opts = {}) {
  const warnings = [];
  const fail = (error) => ({ set: null, patch: null, warnings, error });
  if (!isDay(day)) return fail(`ungueltiger Tag ${JSON.stringify(day)}`);

  const metaSet = Number(meta?.setNumber);
  let set;
  if (opts.set !== undefined && opts.set !== null) {
    if (!SET_RE.test(String(opts.set))) return fail(`ungueltige Set-Vorgabe ${JSON.stringify(opts.set)}`);
    set = Number(opts.set);
    if (set !== metaSet) warnings.push(`Set-Vorgabe ${set}, tft-set.json sagt ${meta?.setNumber ?? '–'} — die Vorgabe gilt`);
  } else {
    if (!Number.isInteger(metaSet) || metaSet <= 0) return fail(`tft-set.json ohne gueltige setNumber (${JSON.stringify(meta?.setNumber)})`);
    set = metaSet;
  }

  const own = patchForDay(day, meta, set);
  warnings.push(...own.warnings);
  if (opts.patch !== undefined && opts.patch !== null) {
    const m = String(opts.patch).match(PATCH_RE);
    if (!m) return fail(`ungueltige Patch-Vorgabe ${JSON.stringify(opts.patch)}`);
    if (Number(m[1]) !== set) return fail(`Patch-Vorgabe ${opts.patch} gehoert nicht zu Set ${set}`);
    if (own.patch !== opts.patch) warnings.push(`Patch-Vorgabe ${opts.patch}, eigene Rechnung ${own.patch ?? '–'} — die Vorgabe gilt`);
    return { set, patch: String(opts.patch), warnings, error: null };
  }
  if (!own.patch) return fail(`kein Patch-Name fuer ${day} (Set ${set})`);
  return { set, patch: own.patch, warnings, error: null };
}

/** TFT-Basis -> LoL-Patch derselben Woche ("18.3" -> "16.19"), sonst null. */
export function lolPatchFor(tftBase) {
  const b = baseOf(tftBase);
  if (!b) return null;
  const [set, minor] = b.split('.').map(Number);
  const anchor = SET_LAUNCH_LOL[set];
  if (!anchor || minor < 1) return null;
  const [aMaj, aMin] = anchor.split('.').map(Number);
  const total = aMin + minor;
  // Dieselbe 25-Patches-je-Jahr-Naeherung wie tftBaseFromLol und tft-patch-label.ts.
  return total <= 25 ? `${aMaj}.${total}` : `${aMaj + 1}.${total - 25}`;
}

/** LoL-Version -> TFT-Basis der Set ("16.19.1", 18 -> "18.3"), sonst null. */
export function tftBaseFromLol(lolVersion, setNumber) {
  const anchor = SET_LAUNCH_LOL[setNumber];
  const m = String(lolVersion ?? '').match(/^(\d+)\.(\d+)/);
  if (!anchor || !m) return null;
  const [aMaj, aMin] = anchor.split('.').map(Number);
  const minor = (Number(m[1]) - aMaj) * 25 + (Number(m[2]) - aMin);
  return minor >= 1 ? `${setNumber}.${minor}` : null;
}
