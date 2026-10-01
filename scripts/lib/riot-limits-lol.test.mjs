// Waechter: jeder Box-Prozess mit dem LoL-Dev-Key nutzt LOL_DEV_KEY_BATCH. Faellt
// eine Stelle auf den Client-Standard 95 zurueck, bekommt die Live-Seite 429.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LOL_DEV_KEY_BATCH, LOL_DEV_KEY_CRAWL } from './riot-limits.mjs';

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

test('LoL-Budget laesst der Live-Seite eine volle Neuberechnung (63) und 10er-Pakete', () => {
  assert.ok(100 - LOL_DEV_KEY_BATCH.longWindowRequests >= 63);
  assert.ok(20 - LOL_DEV_KEY_BATCH.shortWindowRequests >= 10);
});

test('EUW-Sammler: Live-Seite behaelt >= 45 pro 2 min, Lauf passt mit 90 min Tor in 360 min', () => {
  assert.ok(100 - LOL_DEV_KEY_CRAWL.longWindowRequests >= 45);
  assert.ok(20 - LOL_DEV_KEY_CRAWL.shortWindowRequests >= 10);
  const minutes = 6085 / LOL_DEV_KEY_CRAWL.longWindowRequests * 122 / 60;
  assert.ok(90 + minutes + 10 <= 360, String(minutes));
  assert.match(read('../../.github/workflows/weekly-crawl.yml'), /MAX_WAIT_MIN: 90/);
  const calls = [...read('../collect-highelo.mjs').matchAll(/createRiotClient\(\{([^}]*)\}/g)];
  assert.ok(calls.length >= 1);
  for (const [, body] of calls) assert.match(body, /\.\.\.LOL_DEV_KEY_CRAWL/);
});

for (const f of ['../collect-lol-matches.mjs', '../refresh-highelo-marketvalues.mjs']) {
  test(`${f}: jeder createRiotClient-Aufruf nutzt LOL_DEV_KEY_BATCH`, () => {
    const calls = [...read(f).matchAll(/createRiotClient\(\{([^}]*)\}/g)];
    assert.ok(calls.length >= 1);
    for (const [, body] of calls) assert.match(body, /\.\.\.LOL_DEV_KEY_BATCH/);
  });
}
