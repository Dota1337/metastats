import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLIENT_VERSION } from './config.ts';

// Die Version steht an drei Stellen; laufen sie auseinander, meldet der Server
// eine andere Version als Overwolf anzeigt.
test('Version ist in package.json, manifest.json und config.ts gleich', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(readFileSync(new URL('../../public/manifest.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, CLIENT_VERSION);
  assert.equal(manifest.meta.version, CLIENT_VERSION);
  const major = CLIENT_VERSION.split('.').slice(0, 2).join('.');
  assert.equal(manifest.data.user_agent, `metastats-companion/${major}`);
});
