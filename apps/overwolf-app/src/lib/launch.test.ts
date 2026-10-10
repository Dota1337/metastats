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

test('classifyLaunch: Selbststart = auto (auch relaunch), bekannte Klicks = click', () => {
  for (const o of ['gamelaunchevent', 'update', 'startup', 'relaunch', 'GameLaunchEvent', ' startup ', 'Relaunch']) assert.equal(classifyLaunch(o), 'auto', o);
  for (const o of ['dock', 'storeapi', 'odk', 'tray', 'urlscheme', 'commandline', 'after-install', 'overwolfstartlaunchevent']) assert.equal(classifyLaunch(o), 'click', o);
});

test('classifyLaunch: unbekannte Herkunft = unknown, leer = null', () => {
  for (const o of ['unknown', 'other', 'irgendwas']) assert.equal(classifyLaunch(o), 'unknown', o);
  for (const o of ['', '  ', null, undefined]) assert.equal(classifyLaunch(o), null, String(o));
});
