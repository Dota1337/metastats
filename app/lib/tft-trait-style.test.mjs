// Trait-Stufen: Riot und Bundle zaehlen verschieden (tft-trait-style.ts).
// Wird ein Test hier rot, zaehlt eine der beiden Quellen anders als die
// Uebersetzer — Farben und Beschriftungen waeren dann still falsch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { TRAIT_STYLE_COLOR, traitTierColor, traitTierFromBundle, traitTierFromRiot } from './tft-trait-style.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (rel) => JSON.parse(readFileSync(new URL(rel, ROOT), 'utf8'));
const TIERS = ['bronze', 'silver', 'unique', 'gold', 'prismatic'];

test('Riot-Zaehlung: 1–5 sind die fuenf Stufen, 0 und 6 (Eclipse) keine', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(traitTierFromRiot), TIERS);
  for (const s of [0, 6, 7, -1, null, undefined]) assert.equal(traitTierFromRiot(s), null, String(s));
});

test('Bundle-Zaehlung: 1/3/4/5/6 sind die fuenf Stufen, 2 gibt es nicht', () => {
  assert.deepEqual([1, 3, 4, 5, 6].map(traitTierFromBundle), TIERS);
  for (const s of [0, 2, 7, null, undefined]) assert.equal(traitTierFromBundle(s), null, String(s));
});

test('jede Stufe hat eine Farbe, ohne Stufe der Rueckfall', () => {
  assert.deepEqual(Object.keys(TRAIT_STYLE_COLOR).sort(), [...TIERS].sort());
  assert.equal(traitTierColor(null, 'var(--x)'), 'var(--x)');
  assert.equal(traitTierColor('gold', 'var(--x)'), TRAIT_STYLE_COLOR.gold);
});

test('jeder Stil in allen public/tft-assets-<set>.json ist bekannt', () => {
  const files = readdirSync(new URL('public/', ROOT)).filter((f) => /^tft-assets-\d+\.json$/.test(f));
  assert.ok(files.length >= 2, `nur ${files.length} Set-Bundles gefunden`);
  for (const f of files) {
    for (const [name, trait] of Object.entries(read(`public/${f}`).traits)) {
      for (const tier of trait.tiers ?? []) {
        assert.notEqual(traitTierFromBundle(tier.style), null,
          `${f}: ${name} hat Bundle-Stil ${tier.style} — neue Zaehlung? traitTierFromBundle in app/lib/tft-trait-style.ts anpassen`);
      }
    }
  }
});

test('echte Spiele Set 18: Riot-Stil und Bundle-Stil derselben Stufe ergeben dieselbe Stufe', () => {
  const sample = read('app/lib/tft-trait-style.sample-18.json');
  const traits = read(`public/tft-assets-${sample.set}.json`).traits;
  let checked = 0;
  for (const [name, tier, style, n] of sample.rows) {
    const tiers = traits[name]?.tiers ?? [];
    if (tiers.length === 0) continue;   // Mechanik ohne Stufen (Eclipse)
    assert.equal(traitTierFromRiot(style), traitTierFromBundle(tiers[tier - 1]?.style),
      `${name} Stufe ${tier}: Riot ${style}, Bundle ${tiers[tier - 1]?.style}`);
    checked += n;
  }
  assert.ok(checked > 300_000, `nur ${checked} Traits geprueft`);
});

test('Paare im Vertrag tft/trait-style-axis passen zu den Uebersetzern', () => {
  const c = read('infra/contracts.json').contracts.find((x) => x.type === 'trait-style-axis');
  assert.ok(c, 'Vertrag vom Typ trait-style-axis fehlt in infra/contracts.json');
  const pairs = Object.entries(c.expected);
  assert.deepEqual(pairs.map(([riot]) => traitTierFromRiot(Number(riot))), TIERS);
  for (const [riot, bundle] of pairs) {
    assert.equal(traitTierFromRiot(Number(riot)), traitTierFromBundle(bundle), `Riot ${riot} → Bundle ${bundle}`);
  }
});
