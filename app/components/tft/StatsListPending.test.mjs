// Quelltext-Test fuer die Ladeanzeige der Statistik-Listen (F1-B, 15.10.2026).
// Prueft zwei Dinge, die kein Typcheck sieht: dass keine Liste mehr den
// deutschen Ladetext per Textersetzung baut (griff nur auf Deutsch), und dass
// der Block das Merkmal behaelt, ueber das stats-pending.ts ihn einblendet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { statsPendingCss } from '../../lib/seo/stats-pending.ts';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');

const LISTS = [
  '../../tft/comps/CompsClient.tsx',
  '../../tft/units/UnitsClient.tsx',
  '../../tft/items/ItemsClient.tsx',
  '../../tft/traits/TraitsClient.tsx',
  '../../tft/comps/atlas/page.tsx',
];

test('alle fuenf Listen nutzen StatsListPending, keine Textersetzung mehr', () => {
  for (const p of LISTS) {
    const src = read(p);
    assert.match(src, /<StatsListPending\b/, p);
    assert.doesNotMatch(src, /replace\('Noch keine Daten'/, p);
  }
});

test('Listen mit Server-Startdaten behalten das E3-Merkmal, Atlas nicht', () => {
  for (const p of LISTS) {
    const src = read(p);
    if (p.includes('atlas')) assert.match(src, /<StatsListPending[^>]*e3=\{false\}/, p);
    else assert.doesNotMatch(src, /<StatsListPending[^>]*e3=\{false\}/, p);
  }
});

test('Komponente: Merkmal aussen, Ladetext fuer Screenreader, Balken stumm', () => {
  const src = read('./StatsListPending.tsx');
  assert.match(src, /data-e3-wait=\{e3 \? '' : undefined\}/);
  assert.match(src, /role="status"/);
  assert.match(src, /sr-only">\{t\('tft\.loading'\)\}/);
  assert.match(src, /aria-hidden="true"/);
  // Das <style> blendet genau dieses Merkmal ein.
  assert.match(statsPendingCss(null), /\[data-e3-wait\]\{display:block!important\}/);
});
