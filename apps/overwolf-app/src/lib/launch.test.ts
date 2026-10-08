import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchSource, classifyLaunch } from './launch.ts';

test('launchSource liest ?source= aus der Fensteradresse', () => {
  assert.equal(launchSource('overwolf-extension://abc/windows/background.html?source=dock'), 'dock');
  assert.equal(launchSource('overwolf-extension://abc/windows/background.html?x=1&source=gamelaunchevent'), 'gamelaunchevent');
  assert.equal(launchSource('overwolf-extension://abc/windows/background.html'), null);
  assert.equal(launchSource('overwolf-extension://abc/windows/background.html?source='), null);
  assert.equal(launchSource('kein link'), null);
});

test('classifyLaunch: Selbststart = auto, alles andere Bekannte = click, leer = null', () => {
  for (const o of ['gamelaunchevent', 'update', 'startup', 'GameLaunchEvent', ' startup ']) assert.equal(classifyLaunch(o), 'auto', o);
  for (const o of ['dock', 'storeapi', 'odk', 'tray', 'urlscheme', 'commandline', 'unknown', 'other']) assert.equal(classifyLaunch(o), 'click', o);
  for (const o of ['', '  ', null, undefined]) assert.equal(classifyLaunch(o), null, String(o));
});
