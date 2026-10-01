// Waechter: jeder Box-Prozess mit dem LoL-Dev-Key nutzt LOL_DEV_KEY_BATCH. Faellt
// eine Stelle auf den Client-Standard 95 zurueck, bekommt die Live-Seite 429.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LOL_DEV_KEY_BATCH } from './riot-limits.mjs';

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

test('LoL-Budget laesst der Live-Seite eine volle Neuberechnung (63) und 10er-Pakete', () => {
  assert.ok(100 - LOL_DEV_KEY_BATCH.longWindowRequests >= 63);
  assert.ok(20 - LOL_DEV_KEY_BATCH.shortWindowRequests >= 10);
});

for (const f of ['../collect-lol-matches.mjs', '../refresh-highelo-marketvalues.mjs']) {
  test(`${f}: jeder createRiotClient-Aufruf nutzt LOL_DEV_KEY_BATCH`, () => {
    const calls = [...read(f).matchAll(/createRiotClient\(\{([^}]*)\}/g)];
    assert.ok(calls.length >= 1);
    for (const [, body] of calls) assert.match(body, /\.\.\.LOL_DEV_KEY_BATCH/);
  });
}
