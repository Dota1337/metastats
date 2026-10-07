import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemctlActions, parseUnitText, EXEC_KEYS } from './build-system-map.mjs';

test('systemctlActions: start/stop/restart sind Kanten, Abfragen nicht', () => {
  assert.deepEqual(systemctlActions('/bin/systemctl stop metastats-a.service'), [{ action: 'stop', unit: 'metastats-a.service' }]);
  assert.deepEqual(
    systemctlActions('systemctl --no-block start metastats-a.service metastats-b.timer'),
    [{ action: 'start', unit: 'metastats-a.service' }, { action: 'start', unit: 'metastats-b.timer' }],
  );
  assert.deepEqual(systemctlActions('systemctl is-active metastats-a.service'), []);
  assert.deepEqual(systemctlActions('systemctl try-restart metastats-a.service'), []);
  assert.deepEqual(systemctlActions('/usr/bin/node scripts/x.mjs'), []);
});

test('parseUnitText: Scripts aus allen Exec*-Zeilen, nicht nur ExecStart', () => {
  // Wortgleich aus metastats-snapshot-publisher.service: das ExecStartPre-Script
  // galt vor 2026-10 als "Script ohne Aufrufer".
  const text = [
    '[Service]',
    'ExecStartPre=-/usr/bin/node scripts/precompute-comp-windows.mjs',
    'ExecStart=/usr/bin/node scripts/publish-snapshots.mjs',
  ].join('\n');
  const { unit, edges } = parseUnitText('metastats-x.service', text);
  assert.deepEqual(unit.scripts, ['scripts/precompute-comp-windows.mjs', 'scripts/publish-snapshots.mjs']);
  assert.deepEqual(edges, []);
  assert.ok(EXEC_KEYS.includes('ExecStartPre') && EXEC_KEYS.includes('ExecStopPost'));
});

test('parseUnitText: systemctl stop im ExecStartPre wird Unit-Kante, Abfrage und Selbstbezug nicht', () => {
  // Gekuerzt aus metastats-daily-crawl.service: wartet per is-active, stoppt dann.
  const text = [
    '[Service]',
    "ExecStartPre=+/bin/bash -c 's=$$(systemctl is-active metastats-marketvalue-snapshot.service || true); systemctl stop metastats-marketvalue-snapshot.service || true'",
    'ExecStopPost=/bin/systemctl restart metastats-daily-crawl.service',
    'ExecStart=/usr/bin/node scripts/tft-daily-crawl.mjs',
  ].join('\n');
  const { edges } = parseUnitText('metastats-daily-crawl.service', text);
  assert.deepEqual(edges, [{
    from: 'metastats-daily-crawl.service',
    to: 'metastats-marketvalue-snapshot.service',
    via: 'systemctl-stop',
    exec: 'ExecStartPre',
  }]);
});
