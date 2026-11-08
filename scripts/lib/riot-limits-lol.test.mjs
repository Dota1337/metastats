// Waechter: jeder Box-Prozess mit dem LoL-Dev-Key nutzt LOL_DEV_KEY_BATCH. Faellt
// eine Stelle auf den Client-Standard 95 zurueck, bekommt die Live-Seite 429.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LOL_DEV_KEY_BATCH, LOL_DEV_KEY_CRAWL, LOL_FILL_HARD_MAX, lolFillOptions } from './riot-limits.mjs';

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

test('Auffuellen: Env-Regeln und harte Obergrenze 85', () => {
  assert.equal(lolFillOptions(undefined).maxRequests, 85);
  assert.equal(lolFillOptions('').maxRequests, 85);
  assert.equal(lolFillOptions(' 60 ').maxRequests, 60);
  assert.equal(lolFillOptions('500').maxRequests, LOL_FILL_HARD_MAX);
  for (const off of ['35', '20', '0', '-5', 'abc', '60.5']) assert.equal(lolFillOptions(off), null, off);
  assert.equal(LOL_FILL_HARD_MAX, 85);
  assert.ok(100 - LOL_FILL_HARD_MAX >= 15, 'erste Abrufe der Spielerseite (ohne Wiederholung) finden Platz');
  assert.equal(lolFillOptions().baseRequests, LOL_DEV_KEY_BATCH.longWindowRequests);
});

test('Auffuell-Zone passt zu den Wiederholungen der Live-Seite', () => {
  const src = read('../../app/lib/riot-fetch.ts');
  const attempts = Number(/const RETRY_ATTEMPTS = (\d+);/.exec(src)?.[1]);
  const maxMs = Number(/const RETRY_MAX_MS = (\d+);/.exec(src)?.[1]);
  const { endZoneMs } = lolFillOptions();
  // Spielerseite: Details mit Standard-Wiederholungen ueberbruecken die ganze Zone (+2 s Luft).
  assert.ok(endZoneMs + 2_000 <= attempts * maxMs, `${endZoneMs} vs ${attempts}×${maxMs}`);
  assert.match(read('../../app/api/summoner/route.ts'), /matches\/\$\{encodeURIComponent\(id\)\}`, apiKey\);/);
  // „mehr laden" (1 Wiederholung, bis 1+30 Abrufe): in den ersten (Zone − 5 s) schafft der
  // Sammler hoechstens 8 je 1,1 s — danach reicht eine Wiederholung bis zum Fensterwechsel.
  const early = Math.ceil((endZoneMs - maxMs) / 1100) * LOL_DEV_KEY_BATCH.shortWindowRequests;
  assert.ok(100 - LOL_DEV_KEY_BATCH.longWindowRequests - early >= 31, String(early));
  assert.match(read('../../app/api/matches/route.ts'), /count, 30\)/);
});

test('collect-lol-matches: Client fuellt nur ueber den Env-Wert auf, Wert je Zyklus neu', () => {
  const src = read('../collect-lol-matches.mjs');
  const calls = [...src.matchAll(/createRiotClient\(\{([^}]*)\}/g)];
  assert.equal(calls.length, 1);
  assert.match(calls[0][1], /fill: fillFromEnv\(\)/);
  assert.match(src, /riot\.setFill\(fillCfg\)/);
});

for (const f of ['../collect-lol-matches.mjs', '../refresh-highelo-marketvalues.mjs']) {
  test(`${f}: jeder createRiotClient-Aufruf nutzt LOL_DEV_KEY_BATCH`, () => {
    const calls = [...read(f).matchAll(/createRiotClient\(\{([^}]*)\}/g)];
    assert.ok(calls.length >= 1);
    for (const [, body] of calls) assert.match(body, /\.\.\.LOL_DEV_KEY_BATCH/);
  });
}
