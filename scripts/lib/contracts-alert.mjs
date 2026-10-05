// Alarm fuer rote Laufzeit-Vertraege — geteilte, reine Logik.
//
// Ablauf: die Box schreibt taeglich 23:00 UTC contracts-status.json
// (check-contracts.mjs). refresh-api gibt eine GEKUERZTE Fassung unter
// GET /contracts-status heraus (redactReport), eine GitHub-Action holt sie um
// 23:30 und legt pro rotem Vertrag eine Aufgabe an (decide). Aufgaben, die der
// Bot anlegt, schicken dem Repo-Besitzer eine Mail.
//
// Gelb (`warn`) bekommt ebenfalls eine Aufgabe, betitelt mit "(Warnung)": eine
// Mail beim ersten Mal und je neuem Grund, danach Ruhe. Gelb zaehlt nicht fuer
// die Sammel-Aufgabe — die soll eine gemeinsame Ursache fuer Ausfaelle zeigen.
//
// Das Repo ist oeffentlich. Deshalb verlaesst `detail` die Box nur, wo es
// harmlos ist: Fehlertexte (err.message kann Host/Port enthalten), volle URLs
// des endpoint-Typs und die Tabellenliste des Sicherheitsvertrags bleiben dort.
// Der Sicherheitsvertrag bekommt zudem einen Titel ohne Kennung.
//
// Zum Box-Weg gibt es kein HTTPS. Das Token geht deshalb nie ueber die Leitung:
// die Anfrage traegt einen Zeitstempel und dessen HMAC.

import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

export const LABEL = 'contract-broken';
export const BUNDLE_AT = 6;          // ab so vielen roten: eine Sammel-Aufgabe
export const STALE_HOURS = 30;       // Timer 23:00 + bis 2 min Versatz + Cron-Verspaetung
export const GREEN_TO_CLOSE = 2;     // gegen Flattern (tft/ladder-daily war einen Tag rot)
export const SIG_WINDOW_MS = 5 * 60_000;

const SENSITIVE_TYPES = new Set(['anon-lockout']);
const RED = new Set(['broken', 'error']);

// ---- Signatur -------------------------------------------------------------

export function sign(token, ts) {
  return createHmac('sha256', token).update(`GET /contracts-status ${ts}`).digest('hex');
}

export function verifySignature(token, tsHeader, sigHeader, now = Date.now()) {
  if (!token || !tsHeader || !sigHeader) return false;
  const ts = Number(tsHeader);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > SIG_WINDOW_MS) return false;
  const want = Buffer.from(sign(token, String(tsHeader)), 'hex');
  const got = Buffer.from(String(sigHeader), 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

// ---- Kuerzen auf der Box --------------------------------------------------

// typeById kommt aus infra/contracts.json. Unbekannte Kennung = vorsichtig:
// kein Grund, aber auch nicht als Sicherheitsvertrag markiert.
export function redactReport(report, typeById) {
  return {
    checkedAt: report.checkedAt,
    summary: report.summary,
    results: (report.results || []).map((r) => {
      const type = typeById.get(r.id);
      const sensitive = SENSITIVE_TYPES.has(type);
      let reason = null;
      if (r.status === 'error') reason = 'Pruefung fehlgeschlagen (Fehlertext auf der Box)';
      else if ((r.status === 'broken' || r.status === 'warn') && !sensitive) {
        if (type === 'endpoint') reason = 'Endpunkt antwortet nicht wie erwartet';
        else if (type !== undefined) reason = r.detail ?? null;
      }
      return { id: r.id, status: r.status, sensitive, reason };
    }),
  };
}

// ---- Entscheidung ---------------------------------------------------------

export const keyOf = (id) => createHash('sha256').update(id).digest('hex').slice(0, 12);
const reasonKey = (s) => (s || '').replace(/\d+/g, '#');

const MARK = /<!-- ms-contract (\{.*?\}) -->/;
export function parseMarker(body) {
  const m = MARK.exec(body || '');
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}
export function withMarker(text, state) {
  return `${text}\n\n<!-- ms-contract ${JSON.stringify(state)} -->`;
}
const textOf = (body) => (body || '').replace(MARK, '').trimEnd();

const boxHint = (id) => 'Details auf der Box: `node scripts/check-contracts.mjs' + (id ? ` --id ${id}` : '') + '`';
const BOX_HINT = boxHint();

function contractIssue(r, checkedAt) {
  const warn = r.status === 'warn';
  if (r.sensitive) {
    return {
      title: '[Vertrag] Handlungsbedarf, Details auf der Box',
      text: `Eine Pruefung ist ${warn ? 'gelb' : 'rot'} (Stand ${checkedAt}).\n\n${BOX_HINT}`,
    };
  }
  return {
    title: `[Vertrag] ${r.id}${warn ? ' (Warnung)' : ''}`,
    text: `Vertrag \`${r.id}\` ist ${warn ? 'gelb (Warnung, kein Ausfall)' : 'rot'} (Stand ${checkedAt}).\n\nGrund: ${r.reason || 'Details auf der Box'}\n\n${boxHint(r.id)}`,
  };
}

const DEADMAN = {
  unreachable: { key: '__unreachable', title: '[Vertrag] Pruefung nicht erreichbar' },
  stale: { key: '__stale', title: '[Vertrag] Pruefung laeuft nicht' },
};
const BUNDLE_KEY = '__bundle';

// issues: [{number, state:'open'|'closed', title, body}] mit Label LABEL.
// input: {kind:'unreachable', why} | {kind:'report', report, now}
// Rueckgabe: Liste von Operationen, die run() gegen GitHub ausfuehrt.
export function decide(input, issues) {
  const ops = [];
  const byKey = new Map();
  for (const i of issues) {
    const st = parseMarker(i.body);
    if (!st?.key) continue;
    const cur = byKey.get(st.key);
    // offene Aufgabe gewinnt, sonst die juengste
    if (!cur || (i.state === 'open' && cur.issue.state !== 'open')
        || (i.state === cur.issue.state && i.number > cur.issue.number)) {
      byKey.set(st.key, { issue: i, st });
    }
  }
  const isOpen = (k) => byKey.get(k)?.issue.state === 'open';

  // level: 'red' | 'warn'. Alte Marker ohne level stammen aus der Zeit vor
  // Gelb und waren immer rot.
  const openOrCreate = (key, title, text, state = {}) => {
    const hit = byKey.get(key);
    const st = { key, green: 0, ...state };
    const level = state.level ?? 'red';
    const word = level === 'warn' ? 'gelb' : 'rot';
    if (!hit) return ops.push({ op: 'create', title, body: withMarker(text, st) });
    const edit = (body, withTitle) => ops.push({
      op: 'edit', number: hit.issue.number, body, ...(withTitle && title !== hit.issue.title ? { title } : {}),
    });
    if (hit.issue.state === 'closed') {
      ops.push({ op: 'reopen', number: hit.issue.number, comment: `Wieder ${word}.\n\n${text}` });
      return edit(withMarker(text, st), true);
    }
    // offen: nur bei neuem Grund oder neuer Stufe kommentieren,
    // Gruen-Zaehler immer zuruecksetzen
    const levelChanged = level !== (hit.st.level ?? 'red');
    const changed = levelChanged || (state.reason ?? null) !== (hit.st.reason ?? null);
    if (levelChanged) ops.push({ op: 'comment', number: hit.issue.number, body: `Stufe geaendert, jetzt ${word}:\n\n${text}` });
    else if (changed) ops.push({ op: 'comment', number: hit.issue.number, body: `Grund geaendert:\n\n${text}` });
    if (changed || hit.st.green) edit(withMarker(changed ? text : textOf(hit.issue.body), st), levelChanged);
  };
  const close = (key, why) => {
    if (isOpen(key)) ops.push({ op: 'close', number: byKey.get(key).issue.number, comment: why });
  };

  if (input.kind === 'unreachable') {
    openOrCreate(DEADMAN.unreachable.key, DEADMAN.unreachable.title,
      `Der Vertragsstatus der Box war nicht abrufbar (${input.why}). Laeuft refresh-api?`);
    return ops;
  }
  close(DEADMAN.unreachable.key, 'Box wieder erreichbar.');

  const { report, now } = input;
  const ageH = (now - Date.parse(report.checkedAt)) / 3_600_000;
  if (!Number.isFinite(ageH) || ageH > STALE_HOURS) {
    openOrCreate(DEADMAN.stale.key, DEADMAN.stale.title,
      `Die letzte Vertragspruefung ist aelter als ${STALE_HOURS} h (Stand ${report.checkedAt}). Laeuft metastats-contracts.timer?`);
    return ops; // alter Stand: rot/gruen daraus nicht neu bewerten
  }
  close(DEADMAN.stale.key, 'Pruefung laeuft wieder.');

  const results = report.results || [];
  const red = results.filter((r) => RED.has(r.status));

  if (red.length >= BUNDLE_AT) {
    const ids = red.map((r) => (r.sensitive ? '(Sicherheitspruefung)' : r.id)).sort();
    openOrCreate(BUNDLE_KEY, `[Vertrag] ${red.length} Pruefungen rot`,
      `${red.length} Vertraege sind gleichzeitig rot (Stand ${report.checkedAt}) — vermutlich eine gemeinsame Ursache.\n\n${ids.map((i) => `- ${i}`).join('\n')}\n\n${BOX_HINT}`,
      { reason: reasonKey(ids.join(',')) });
    return ops; // keine zusaetzlichen Einzel-Mails
  }
  close(BUNDLE_KEY, 'Weniger als ' + BUNDLE_AT + ' Vertraege rot, Einzel-Aufgaben uebernehmen.');

  const seen = new Set();
  for (const r of results) {
    const key = keyOf(r.id);
    seen.add(key);
    if (RED.has(r.status) || r.status === 'warn') {
      const { title, text } = contractIssue(r, report.checkedAt);
      openOrCreate(key, title, text, {
        reason: r.sensitive ? 'sensitiv' : reasonKey(r.reason),
        level: r.status === 'warn' ? 'warn' : 'red',
      });
    } else if (r.status === 'ok' && isOpen(key)) {
      const hit = byKey.get(key);
      const green = (hit.st.green || 0) + 1;
      if (green >= GREEN_TO_CLOSE) ops.push({ op: 'close', number: hit.issue.number, comment: `${green} Pruefungen in Folge gruen.` });
      else ops.push({ op: 'edit', number: hit.issue.number, body: withMarker(textOf(hit.issue.body), { ...hit.st, green }) });
    }
    // skipped: weder rot noch gruen, nichts tun
  }
  for (const [key, { issue }] of byKey) {
    if (key.startsWith('__') || seen.has(key) || issue.state !== 'open') continue;
    ops.push({ op: 'close', number: issue.number, comment: 'Vertrag gibt es nicht mehr.' });
  }
  return ops;
}
