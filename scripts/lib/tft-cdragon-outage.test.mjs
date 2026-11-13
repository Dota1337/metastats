import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decideOutage, issueText, OUTAGE_LABEL, sinceOf, syncOutage } from './tft-cdragon-outage.mjs';

const H = 3_600_000;
const NOW = Date.parse('2026-11-14T12:00:00Z');
const openSince = (hoursAgo, assignees = []) => ({
  number: 7, assignees, body: issueText({ since: new Date(NOW - hoursAgo * H).toISOString(), runUrl: 'u' }).body,
});
const base = { owner: 'Dota1337', nowMs: NOW, alarmHours: 24 };

test('erster Ausfall: still anlegen, Beginn im Marker', () => {
  const d = decideOutage({ ...base, sourceDown: true, delivered: false, open: null });
  assert.deepEqual(d, { action: 'create', since: '2026-11-14T12:00:00.000Z', assignNow: false });
  assert.equal(sinceOf(issueText({ since: d.since }).body), d.since);
});

test('unter 24 h: nichts; ab 24 h: zuweisen, danach nie wieder', () => {
  assert.equal(decideOutage({ ...base, sourceDown: true, delivered: false, open: openSince(21) }).action, 'none');
  assert.equal(decideOutage({ ...base, sourceDown: true, delivered: false, open: openSince(24) }).action, 'assign');
  assert.equal(decideOutage({ ...base, sourceDown: true, delivered: false, open: openSince(30, ['dota1337']) }).action, 'none');
});

test('CDragon liefert wieder: schliessen; ohne offenes Issue nichts', () => {
  assert.equal(decideOutage({ ...base, sourceDown: false, delivered: true, open: openSince(30, ['Dota1337']) }).action, 'close');
  assert.equal(decideOutage({ ...base, sourceDown: false, delivered: true, open: null }).action, 'none');
});

test('anderer Fehler oder kein Lauf: Ausfall-Issue bleibt, wie es ist', () => {
  assert.equal(decideOutage({ ...base, sourceDown: false, delivered: false, open: openSince(30) }).action, 'none');
});

test('Issue ohne Marker wird nicht angefasst; Schwelle 0 meldet sofort', () => {
  assert.equal(decideOutage({ ...base, sourceDown: true, delivered: false, open: { number: 1, body: 'von Hand', assignees: [] } }).action, 'none');
  assert.equal(decideOutage({ ...base, alarmHours: 0, sourceDown: true, delivered: false, open: null }).assignNow, true);
});

test('Text in MEZ', () => {
  const t = issueText({ since: '2026-11-13T14:37:00.000Z', runUrl: 'u' });
  assert.match(t.title, /13\.11\.2026, 15:37$/);
});

// Gh-Attrappe: zeichnet Aufrufe auf, antwortet wie GitHub.
const fakeGh = (issues = []) => {
  const calls = [];
  const gh = async (method, path, body) => {
    calls.push(`${method} ${path.split('?')[0]}${body?.assignees ? ' assign' : ''}${body?.state ? ` ${body.state}` : ''}`);
    if (method === 'GET') return issues;
    if (path === '/issues') return { number: 99 };
    if (path.endsWith('/assignees')) return { assignees: body.assignees.map(login => ({ login })) };
    return {};
  };
  return { gh, calls };
};

test('Ablauf: anlegen ohne Zuweisung, spaeter Text + Zuweisung, dann still schliessen', async () => {
  const a = fakeGh([]);
  assert.equal(await syncOutage({ ...base, gh: a.gh, sourceDown: true, delivered: false }), 'create');
  assert.deepEqual(a.calls, ['GET /issues', 'POST /labels', 'POST /issues']);

  const label = { labels: [{ name: OUTAGE_LABEL }] };
  const b = fakeGh([{ ...openSince(25), ...label }]);
  assert.equal(await syncOutage({ ...base, gh: b.gh, sourceDown: true, delivered: false }), 'assign');
  assert.deepEqual(b.calls, ['GET /issues', 'PATCH /issues/7', 'POST /issues/7/assignees assign']);

  const c = fakeGh([{ ...openSince(30, [{ login: 'Dota1337' }]), ...label }]);
  assert.equal(await syncOutage({ ...base, gh: c.gh, sourceDown: false, delivered: true }), 'close');
  assert.deepEqual(c.calls, ['GET /issues', 'PATCH /issues/7 closed']);
});

test('Workflow fragt dasselbe Label ab', () => {
  const yml = readFileSync(new URL('../../.github/workflows/tft-data-refresh.yml', import.meta.url), 'utf8');
  assert.ok(yml.includes(`--label ${OUTAGE_LABEL} `), 'Label in tft-data-refresh.yml muss OUTAGE_LABEL sein');
  assert.match(yml, /CDRAGON_DOWN_ALARM_HOURS: 24/);
});

test('ohne Ausfall und ohne Lieferung: kein einziger Abruf', async () => {
  const a = fakeGh([]);
  assert.equal(await syncOutage({ ...base, gh: a.gh, sourceDown: false, delivered: false }), 'none');
  assert.deepEqual(a.calls, []);
});
