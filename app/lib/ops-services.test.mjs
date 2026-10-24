/**
 * Ops-Dashboard: Dienstliste und abgeleiteter Aufbau gegen die echten Karten.
 *
 * Warum: am 24.10.2026 fehlten 16 Live-Dienste in den Fristen und 19 im Text,
 * und 27 Linien im Graphen wichen von der Box ab — alles von Hand gepflegt.
 * Diese Tests schlagen an, sobald eine neue Unit in infra/hetzner/ ohne Eintrag
 * in app/lib/ops-services.ts landet, oder eine Frist kuerzer ist als der
 * Zeitplan ihres Timers (dann staende der Dienst zwischen zwei normalen
 * Laeufen auf "verzoegert").
 *
 * Lauf: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { OPS_SERVICES, MANIFEST_FAILED_MS, MANIFEST_STALE_MS } from './ops-services.ts';
import { deriveTopology, maxGapMs, describeSchedule, HAND_WRITES, HAND_READS } from './ops-topology.ts';

const systemMap = JSON.parse(readFileSync(new URL('../../infra/system-map.json', import.meta.url), 'utf8'));
const contracts = JSON.parse(readFileSync(new URL('../../infra/contracts.json', import.meta.url), 'utf8')).contracts;
const serviceUnits = systemMap.units.filter(u => u.kind === 'service').map(u => u.name);
const H = 3_600_000;

test('jede Service-Unit hat einen Eintrag, jeder Eintrag ist eine Unit', () => {
  const missing = serviceUnits.filter(n => !OPS_SERVICES[n]);
  assert.deepEqual(missing, [], `ohne Eintrag in ops-services.ts: ${missing.join(', ')}`);
  const stray = Object.keys(OPS_SERVICES).filter(n => !serviceUnits.includes(n));
  assert.deepEqual(stray, [], `Eintrag ohne Unit in infra/hetzner/: ${stray.join(', ')}`);
});

test('jeder Eintrag hat Text, Einzellaeufe haben eine Frist', () => {
  for (const [name, s] of Object.entries(OPS_SERVICES)) {
    assert.ok(s.text && s.text.length > 20, `${name}: Text fehlt`);
    if (s.kind === 'oneshot') assert.ok(s.maxAgeMs > 0, `${name}: Einzellauf ohne Frist`);
    else assert.equal(s.maxAgeMs, undefined, `${name}: Frist bei Art ${s.kind} wirkt nicht`);
  }
});

test('keine Frist ist kuerzer als die groesste Luecke im Zeitplan', () => {
  const { schedules } = deriveTopology(systemMap, contracts);
  let checked = 0;
  for (const [name, s] of Object.entries(OPS_SERVICES)) {
    if (s.kind !== 'oneshot' || !schedules[name]) continue;
    const gap = maxGapMs(schedules[name]);
    assert.notEqual(gap, null, `${name}: Zeitplan nicht lesbar (${JSON.stringify(schedules[name])})`);
    assert.ok(s.maxAgeMs > gap, `${name}: Frist ${s.maxAgeMs / H} h <= Luecke ${gap / H} h`);
    checked++;
  }
  assert.ok(checked >= 20, `nur ${checked} Fristen gegen einen Timer geprueft`);
});

test('Manifest: gelb ab einem ausgefallenen Tageslauf, rot genau beim Vertrag', () => {
  const c = contracts.find(x => x.id === 'snapshot/manifest-frische');
  assert.ok(c, 'Vertrag snapshot/manifest-frische fehlt');
  assert.equal(MANIFEST_FAILED_MS, c.maxAgeDays * 24 * H);
  assert.ok(MANIFEST_STALE_MS > 24 * H && MANIFEST_STALE_MS < MANIFEST_FAILED_MS);
});

test('deriveTopology: Ausloeser aus OnSuccess, OnFailure und systemctl start', () => {
  const map = {
    units: [
      { name: 'a.service', kind: 'service', scripts: ['scripts/a.mjs'], OnSuccess: ['b.service'] },
      { name: 'b.service', kind: 'service', scripts: ['x.sh'], OnFailure: ['a.service'] },
      { name: 'c.service', kind: 'service', scripts: ['scripts/a.mjs'] },
      { name: 'a.timer', kind: 'timer', activates: 'a.service', onCalendar: ['*-*-* 05:45:00 UTC'], interval: [] },
    ],
    scriptEdges: [
      { from: 'scripts/a.mjs', to: 'd.service', via: 'systemctl-start' }, // d ist keine Unit → weg
      { from: 'x.sh', to: 'c.service', via: 'systemctl-start' },
      { from: 'scripts/a.mjs', to: 'b.service', via: 'systemctl-start' }, // a UND c fuehren a.mjs aus
      { from: 'a.service', to: 'c.service', via: 'systemctl-stop' }, // Stopp ist kein Ausloeser
    ],
  };
  const t = deriveTopology(map, []);
  const s = t.triggers.map(x => `${x.from}>${x.to}:${x.how}`).sort();
  assert.deepEqual(s, [
    'a.service>b.service:OnSuccess',
    'a.service>b.service:start',
    'b.service>a.service:OnFailure',
    'b.service>c.service:start',
    'c.service>b.service:start',
  ]);
  assert.deepEqual(t.schedules['a.service'].calendar, ['*-*-* 05:45:00 UTC']);
});

test('deriveTopology: nur Vertraege ohne type mit Tabelle sind Schreibwege', () => {
  const map = {
    units: [
      { name: 'a.service', kind: 'service', scripts: ['scripts/a.mjs'] },
      { name: 'sync.service', kind: 'service', scripts: ['scripts/sync.mjs'] },
    ],
    scriptEdges: [],
  };
  const c = [
    { id: 'w', owner: 'a.service', backend: 'hetzner', table: 't1' },
    { id: 'cov', owner: 'a.service', type: 'coverage', backend: 'supabase', table: 't1' },
    { id: 'off', owner: 'a.service', backend: 'supabase', table: 't9', armed: false },
    { id: 's', owner: 'scripts/sync.mjs', backend: 'supabase', table: 't1' },
    { id: 'wf', owner: '.github/workflows/x.yml', backend: 'supabase', table: 't2' },
  ];
  const w = deriveTopology(map, c).writes.map(x => `${x.unit}>${x.table}@${x.backend}`).sort();
  assert.deepEqual(w, ['a.service>t1@hetzner', 'sync.service>t1@supabase']);
});

test('deriveTopology gegen die echten Karten: Kernketten sind da', () => {
  const t = deriveTopology(systemMap, contracts);
  const has = (from, to) => t.triggers.some(x => x.from === from && x.to === to);
  assert.ok(has('metastats-daily-crawl.service', 'metastats-marketvalue-snapshot.service'));
  assert.ok(has('metastats-daily-crawl.service', 'metastats-snapshot-publisher.service'));
  assert.ok(has('metastats-tft-ladder.service', 'metastats-mirror-rising.service'));
  assert.ok(has('metastats-lol-builds.service', 'metastats-lol-builds-publish.service'));
  // Aus den Shell-Waechtern (build-system-map liest seit 24.10.2026 auch .sh).
  assert.ok(has('metastats-daily-crawl-watchdog.service', 'metastats-daily-crawl-resume.service'));
  assert.ok(has('metastats-marketvalue-watchdog.service', 'metastats-marketvalue-snapshot.service'));
  const w = t.writes.find(x => x.unit === 'metastats-marketvalue-sync.service');
  assert.equal(w?.table, 'tft_player_marketvalue_snapshots');
  assert.equal(w?.backend, 'supabase');
});

test('Handlinien: Unit existiert, Fundstelle existiert, kein Doppel zu einem Vertrag', () => {
  const units = new Set(serviceUnits);
  const contractKeys = new Set(contracts.filter(c => !c.type && c.table).map(c => `${c.owner}|${c.table}|${c.backend}`));
  for (const w of [...HAND_WRITES, ...HAND_READS]) {
    assert.ok(units.has(w.unit), `${w.unit}: keine Unit`);
    const file = w.source.split(/[: ]/)[0];
    assert.ok(existsSync(new URL(`../../${file}`, import.meta.url)), `${w.source}: Datei fehlt`);
  }
  for (const w of HAND_WRITES) {
    assert.ok(!contractKeys.has(`${w.unit}|${w.table}|${w.backend}`), `${w.unit} → ${w.table}: steht schon im Vertrag`);
  }
  const t = deriveTopology(systemMap, contracts);
  assert.ok(t.reads.some(r => r.unit === 'metastats-marketvalue-sync.service'
    && r.table === 'tft_player_marketvalue_snapshots' && r.backend === 'hetzner'), 'Spiegel-Leseweg fehlt');
  assert.ok(!t.reads.some(r => r.unit === 'metastats-refresh-api.service' && r.source === 'Spiegel'),
    'refresh-api schreibt selbst auf die Box, liest also nicht den Spiegel');
});

test('maxGapMs und describeSchedule lesen die Zeitplan-Formen der Box', () => {
  assert.equal(maxGapMs({ calendar: [], interval: ['OnBootSec=5min', 'OnUnitActiveSec=10min'] }), 10 * 60_000);
  assert.equal(maxGapMs({ calendar: ['*-*-* 16:00:00 UTC', '*-*-* 20:00:00 UTC', '*-*-* 23:00:00 UTC'], interval: [] }), 17 * H);
  assert.equal(maxGapMs({ calendar: ['*-*-* 00/6:20:00 UTC'], interval: [] }), 6 * H);
  assert.equal(maxGapMs({ calendar: ['*-*-* *:00/10:00 UTC'], interval: [] }), 10 * 60_000);
  assert.equal(maxGapMs({ calendar: ['hourly'], interval: [] }), H);
  assert.equal(maxGapMs({ calendar: ['Fri *-*-* 03:00:00 UTC'], interval: [] }), 7 * 24 * H);
  assert.equal(maxGapMs({ calendar: ['Mon..Fri 12:00'], interval: [] }), null);

  const summer = new Date('2026-10-24T12:00:00Z');
  assert.equal(describeSchedule({ calendar: ['*-*-* 05:45:00 UTC'], interval: [] }, summer), 'täglich 07:45 Uhr');
  const winter = new Date('2026-11-24T12:00:00Z');
  assert.equal(describeSchedule({ calendar: ['*-*-* 05:45:00 UTC'], interval: [] }, winter), 'täglich 06:45 Uhr');
  assert.equal(describeSchedule({ calendar: ['*-*-* 16:00:00 UTC', '*-*-* 20:00:00 UTC'], interval: [] }, summer),
    'täglich 18:00, 22:00 Uhr');
  assert.equal(describeSchedule({ calendar: [], interval: ['OnBootSec=2min', 'OnUnitActiveSec=10min'] }), 'alle 10 min');
  assert.equal(describeSchedule({ calendar: ['*-*-* *:10,40:00 UTC'], interval: [] }), 'alle 30 min');
  assert.equal(describeSchedule({ calendar: ['*-*-* *:25:00 UTC'], interval: [] }), 'stündlich zur Minute 25');
});
