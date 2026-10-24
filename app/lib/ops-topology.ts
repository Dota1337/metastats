// Aufbau der Box fuer das Ops-Dashboard, abgeleitet aus den erzeugten Karten
// statt von Hand gepflegt:
//   - infra/system-map.json (scripts/build-system-map.mjs): wer wen startet
//     (OnSuccess/OnFailure, `systemctl start` aus Skript oder Unit) und wann
//     ein Timer feuert
//   - infra/contracts.json: welcher Dienst welche Tabelle verspricht — jede
//     dieser Zusagen prueft metastats-contracts.service jede Nacht gegen die
//     Datenbank, die Linie im Graphen ist also eine gepruefte Behauptung.
//
// Aufgerufen auf dem Server (app/internal/3d-ops/page.tsx), damit die beiden
// Karten (~22 KB komprimiert, mit Server-Pfaden) nicht im Browser-Bundle
// landen. Nicht in der Ops-Route ableiten: scripts/build-api-map.mjs verfolgt
// die Importe jeder Route und laese die Karten als deren Abhaengigkeiten mit.

export interface OpsTrigger {
  from: string;
  to: string;
  /** OnSuccess / OnFailure der Unit oder `systemctl start` aus ihrem Skript. */
  how: 'OnSuccess' | 'OnFailure' | 'start';
}

export interface OpsWrite {
  unit: string;
  table: string;
  backend: 'supabase' | 'hetzner';
  /** Vertrags-ID oder Fundstelle im Code, falls die Linie von Hand kommt. */
  source: string;
}

export interface OpsSchedule {
  calendar: string[];
  interval: string[];
}

export interface OpsTopology {
  triggers: OpsTrigger[];
  writes: OpsWrite[];
  reads: OpsWrite[];
  schedules: Record<string, OpsSchedule>;
}

// Schreibwege ohne Laufzeit-Vertrag, je mit Fundstelle im Code. Der Test
// verbietet doppelte Eintraege: hat eine Tabelle einen Vertrag desselben
// Dienstes, gehoert sie nicht hierher.
export const HAND_WRITES: OpsWrite[] = [
  { unit: 'metastats-daily-crawl.service', table: 'tft_daily_trait_unitcount_stats', backend: 'supabase', source: 'scripts/lib/tft-supabase-writer.mjs:365' },
  { unit: 'metastats-daily-crawl.service', table: 'tft_daily_comp_pairs', backend: 'supabase', source: 'scripts/lib/tft-supabase-writer.mjs:418' },
  // Knopf "Aktualisieren": Marktwert auf die Box und direkt in den Spiegel.
  { unit: 'metastats-refresh-api.service', table: 'tft_player_marketvalue_snapshots', backend: 'hetzner', source: 'scripts/refresh-api-server.mjs:396' },
  { unit: 'metastats-refresh-api.service', table: 'tft_player_marketvalue_snapshots', backend: 'supabase', source: 'scripts/refresh-api-server.mjs:230' },
  // Partien-Speicher: refreshPlayerMatchCache schreibt auf die Box und spiegelt
  // neue Partien nach Supabase (tft-match-cache-pg.mjs:142-149) — ausser bei
  // syncSupabase:false (nur die Rangliste, collect-tft-ladder.mjs:200).
  { unit: 'metastats-refresh-api.service', table: 'tft_player_match_cache', backend: 'hetzner', source: 'scripts/lib/tft-match-cache-pg.mjs:143' },
  { unit: 'metastats-refresh-api.service', table: 'tft_player_match_cache', backend: 'supabase', source: 'scripts/lib/tft-match-cache-pg.mjs:149' },
  { unit: 'metastats-marketvalue-snapshot.service', table: 'tft_player_match_cache', backend: 'hetzner', source: 'scripts/lib/tft-marketvalue-pipeline.mjs:109' },
  { unit: 'metastats-marketvalue-snapshot.service', table: 'tft_player_match_cache', backend: 'supabase', source: 'scripts/lib/tft-marketvalue-pipeline.mjs:109' },
  { unit: 'metastats-tft-ladder.service', table: 'tft_player_match_cache', backend: 'hetzner', source: 'scripts/collect-tft-ladder.mjs:200' },
  // Companion-Aufstellungen.
  { unit: 'metastats-companion-backfill.service', table: 'tft_position_observations', backend: 'supabase', source: 'scripts/backfill-companion-placements.mjs' },
  { unit: 'metastats-position-aggregator.service', table: 'tft_position_observations', backend: 'supabase', source: 'scripts/aggregate-position-observations.mjs' },
  { unit: 'metastats-position-aggregator.service', table: 'tft_position_comp_cell', backend: 'supabase', source: 'scripts/aggregate-position-observations.mjs' },
];

// Lesewege der Dienste, die im Bild wichtig sind (Daten fliessen sonst scheinbar
// aus dem Nichts). Spiegel-Lesewege (Box → Sync-Dienst) leitet deriveTopology
// selbst ab.
export const HAND_READS: OpsWrite[] = [
  { unit: 'metastats-position-aggregator.service', table: 'tft_position_observations', backend: 'supabase', source: 'scripts/aggregate-position-observations.mjs' },
  { unit: 'metastats-position-aggregator.service', table: 'tft_player_match_cache', backend: 'supabase', source: 'scripts/aggregate-position-observations.mjs' },
  { unit: 'metastats-snapshot-publisher.service', table: 'tft_daily_comp_stats', backend: 'supabase', source: 'scripts/publish-snapshot-bundle.mjs (ueber die Statistik-Routen)' },
  { unit: 'metastats-lol-builds.service', table: 'lol_match_participant_raw', backend: 'hetzner', source: 'scripts/aggregate-lol-builds.mjs' },
];

interface MapUnit {
  name: string;
  kind: string;
  scripts?: string[];
  OnSuccess?: string[];
  OnFailure?: string[];
  onCalendar?: string[];
  interval?: string[];
  activates?: string;
}

interface SystemMapLike {
  units: MapUnit[];
  scriptEdges: Array<{ from: string; to: string; via: string }>;
}

interface ContractLike {
  id: string;
  owner?: string;
  type?: string;
  table?: string;
  backend?: string;
  armed?: boolean;
}

/**
 * Regeln (Pruefer-Verdict G5, 24.10.2026):
 * 1. Nur Vertraege ohne `type` mit `table` heissen "Dienst schreibt Tabelle".
 *    coverage/set-axis/patch-axis/mirror/endpoint sind Pruefungen, keine Schreibwege.
 * 2. Besitzer ist eine Unit — oder ein Skript, das genau eine Unit ausfuehrt.
 *    Workflow-, Middleware- und Migrations-Besitzer fallen weg.
 * 3. `armed: false` (vorbereitet, noch nicht scharf) faellt weg.
 */
export function deriveTopology(map: SystemMapLike, contracts: ContractLike[]): OpsTopology {
  const services = map.units.filter(u => u.kind === 'service');
  const serviceNames = new Set(services.map(u => u.name));
  const unitsByScript = new Map<string, string[]>();
  for (const u of services) {
    for (const s of u.scripts || []) {
      const list = unitsByScript.get(s) || [];
      list.push(u.name);
      unitsByScript.set(s, list);
    }
  }

  const triggers: OpsTrigger[] = [];
  const seen = new Set<string>();
  const addTrigger = (from: string, to: string, how: OpsTrigger['how']) => {
    if (from === to || !serviceNames.has(from) || !serviceNames.has(to)) return;
    const key = `${from}|${to}|${how}`;
    if (seen.has(key)) return;
    seen.add(key);
    triggers.push({ from, to, how });
  };
  for (const u of services) {
    for (const t of u.OnSuccess || []) addTrigger(u.name, t, 'OnSuccess');
    for (const t of u.OnFailure || []) addTrigger(u.name, t, 'OnFailure');
  }
  for (const e of map.scriptEdges) {
    if (e.via !== 'systemctl-start') continue;
    // Start direkt aus einer Exec*-Zeile der Unit, oder aus einem Skript, das
    // eine oder mehrere Units ausfuehren (der Tageslauf und sein Nachhol-Lauf
    // teilen sich crawl-allranks-all-regions.mjs — beide starten den Publisher).
    const starters = serviceNames.has(e.from) ? [e.from] : (unitsByScript.get(e.from) || []);
    for (const from of starters) addTrigger(from, e.to, 'start');
  }

  const writes: OpsWrite[] = [];
  const seenWrites = new Set<string>();
  for (const c of contracts) {
    if (c.type || !c.table || c.armed === false || !c.owner) continue;
    if (c.backend !== 'supabase' && c.backend !== 'hetzner') continue;
    let unit: string | null = null;
    if (serviceNames.has(c.owner)) unit = c.owner;
    else {
      const runners = unitsByScript.get(c.owner) || [];
      if (runners.length === 1) unit = runners[0];
    }
    if (!unit) continue;
    const key = `${unit}|${c.table}|${c.backend}`;
    if (seenWrites.has(key)) continue;
    seenWrites.add(key);
    writes.push({ unit, table: c.table, backend: c.backend, source: `Vertrag ${c.id}` });
  }
  for (const w of HAND_WRITES) {
    const key = `${w.unit}|${w.table}|${w.backend}`;
    if (!serviceNames.has(w.unit) || seenWrites.has(key)) continue;
    seenWrites.add(key);
    writes.push(w);
  }

  // Spiegel: schreibt ein Dienst eine Supabase-Tabelle, die es auch auf der Box
  // gibt, ohne selbst auf die Box zu schreiben, liest er sie dort (heute:
  // metastats-marketvalue-sync, Box → Supabase).
  const reads: OpsWrite[] = HAND_READS.filter(r => serviceNames.has(r.unit));
  for (const w of writes) {
    if (w.backend !== 'supabase') continue;
    const onBox = writes.some(x => x.backend === 'hetzner' && x.table === w.table);
    const writesBox = writes.some(x => x.backend === 'hetzner' && x.table === w.table && x.unit === w.unit);
    if (onBox && !writesBox) reads.push({ unit: w.unit, table: w.table, backend: 'hetzner', source: 'Spiegel' });
  }

  const schedules: Record<string, OpsSchedule> = {};
  for (const t of map.units.filter(u => u.kind === 'timer')) {
    if (!t.activates) continue;
    schedules[t.activates] = { calendar: t.onCalendar || [], interval: t.interval || [] };
  }

  return { triggers, writes, reads, schedules };
}

// ------------------------------------------------------------ Zeitplan

/** `10min`, `2h`, `30s` → Millisekunden; unbekannt → null. */
export function spanMs(v: string): number | null {
  const m = /^(\d+)\s*(s|sec|min|m|h|d)$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = { s: 1000, sec: 1000, m: 60_000, min: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]]!;
  return n * unit;
}

/** Feld einer Kalender-Angabe (`*`, `5`, `00,06`, `00/6`, `*:00/10`) → Werte im Bereich. */
function fieldValues(field: string, max: number): number[] | null {
  if (field === '*') return Array.from({ length: max }, (_, i) => i);
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const step = /^(\d+|\*)\/(\d+)$/.exec(part);
    if (step) {
      const start = step[1] === '*' ? 0 : Number(step[1]);
      for (let v = start; v < max; v += Number(step[2])) out.add(v);
    } else if (/^\d+$/.test(part)) {
      out.add(Number(part));
    } else {
      return null;
    }
  }
  return [...out].sort((a, b) => a - b);
}

interface Calendar { weekday: string | null; hours: number[]; minutes: number[] }

function parseCalendar(expr: string): Calendar | null {
  const e = expr.trim();
  if (e === 'hourly') return { weekday: null, hours: fieldValues('*', 24)!, minutes: [0] };
  if (e === 'daily') return { weekday: null, hours: [0], minutes: [0] };
  const m = /^(?:([A-Z][a-z]{2})\s+)?\*-\*-\*\s+([\d*,/]+):([\d*,/]+)(?::\d+)?(?:\s+UTC)?$/.exec(e);
  if (!m) return null;
  const hours = fieldValues(m[2], 24);
  const minutes = fieldValues(m[3], 60);
  if (!hours || !minutes) return null;
  return { weekday: m[1] || null, hours, minutes };
}

/**
 * Groesste Luecke zwischen zwei Laeufen eines Timers in Millisekunden, oder
 * null, wenn der Zeitplan nicht lesbar ist. Kalender gelten in UTC; ein
 * Wochentag-Timer hat eine Luecke von einer Woche.
 */
export function maxGapMs(schedule: OpsSchedule): number | null {
  const gaps: number[] = [];
  for (const iv of schedule.interval) {
    const m = /^OnUnitActiveSec=(.+)$/.exec(iv);
    if (!m) continue;
    const ms = spanMs(m[1]);
    if (ms == null) return null;
    gaps.push(ms);
  }
  const fires: number[] = [];
  let weekly = false;
  for (const expr of schedule.calendar) {
    const c = parseCalendar(expr);
    if (!c) return null;
    // Ein Wochentag-Termin neben taeglichen Terminen (explorer-build: naechtlich
    // + sonntags) fuegt nur einen Lauf hinzu, er vergroessert keine Luecke.
    if (c.weekday) { weekly = true; continue; }
    for (const h of c.hours) for (const mi of c.minutes) fires.push(h * 60 + mi);
  }
  if (weekly && !fires.length) gaps.push(7 * 86_400_000);
  if (fires.length) {
    const sorted = [...new Set(fires)].sort((a, b) => a - b);
    let gap = sorted[0] + 1440 - sorted[sorted.length - 1];
    for (let i = 1; i < sorted.length; i++) gap = Math.max(gap, sorted[i] - sorted[i - 1]);
    gaps.push(gap * 60_000);
  }
  return gaps.length ? Math.max(...gaps) : null;
}

const WEEKDAY_DE: Record<string, string> = {
  Mon: 'montags', Tue: 'dienstags', Wed: 'mittwochs', Thu: 'donnerstags',
  Fri: 'freitags', Sat: 'samstags', Sun: 'sonntags',
};

function berlinTime(hourUtc: number, minute: number, now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, minute));
  return d.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });
}

/** Zeitplan in Alltagssprache, Uhrzeiten in deutscher Zeit. */
export function describeSchedule(schedule: OpsSchedule, now = new Date()): string {
  const parts: string[] = [];
  for (const iv of schedule.interval) {
    const m = /^OnUnitActiveSec=(.+)$/.exec(iv);
    const ms = m ? spanMs(m[1]) : null;
    if (ms != null) parts.push(ms % 3_600_000 === 0 ? `alle ${ms / 3_600_000} h` : `alle ${Math.round(ms / 60_000)} min`);
  }
  // Mehrere Kalender-Zeilen desselben Tages ("16:00", "20:00", "23:00") zu
  // einer Angabe zusammenziehen: "täglich 18:00, 22:00, 01:00 Uhr".
  const timesByPrefix = new Map<string, string[]>();
  for (const expr of schedule.calendar) {
    const c = parseCalendar(expr);
    if (!c) { parts.push(`${expr} (UTC)`); continue; }
    const prefix = c.weekday ? (WEEKDAY_DE[c.weekday] || c.weekday) : 'täglich';
    if (c.hours.length === 24 && c.minutes.length === 1) {
      parts.push(`stündlich zur Minute ${c.minutes[0]}`);
    } else if (c.hours.length === 24 && c.minutes.length > 1) {
      const step = c.minutes[1] - c.minutes[0];
      parts.push(c.minutes.every((v, i) => v === c.minutes[0] + i * step) ? `alle ${step} min` : `stündlich ${c.minutes.length}×`);
    } else {
      const list = timesByPrefix.get(prefix) || [];
      list.push(...c.hours.flatMap(h => c.minutes.map(mi => berlinTime(h, mi, now))));
      timesByPrefix.set(prefix, list);
    }
  }
  for (const [prefix, times] of timesByPrefix) parts.push(`${prefix} ${times.join(', ')} Uhr`);
  return parts.join(' · ');
}
