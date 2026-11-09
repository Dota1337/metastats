// Googlebot bekommt Titel + canonical im <head> (htmlLimitedBots), normale
// Browser weiter nachgestreamt. Nexts eigene Liste muss erhalten bleiben.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_LIMITED_BOTS } from './html-limited-bots.ts';

const BOTS = {
  googlebotDesktop: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/131.0.0.0 Safari/537.36',
  googlebotSmartphone: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  googlebotClassic: 'Googlebot/2.1 (+http://www.google.com/bot.html)',
  inspectionTool: 'Mozilla/5.0 (compatible; Google-InspectionTool/1.0)',
  bingbot: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  twitterbot: 'Twitterbot/1.0',
  discordbot: 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
};
const BROWSERS = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
};

test('Bots aus Nexts Liste und Googlebot warten auf den Kopf', () => {
  for (const [name, ua] of Object.entries(BOTS)) assert.ok(HTML_LIMITED_BOTS.test(ua), name);
});

test('normale Browser bekommen den Kopf weiter nachgestreamt', () => {
  for (const [name, ua] of Object.entries(BROWSERS)) assert.ok(!HTML_LIMITED_BOTS.test(ua), name);
});

// Next macht aus dem Wert `new RegExp(source, 'i')` (server/config.js,
// streaming-metadata.js) — die Quelle allein muss also reichen.
test('Quelle allein (wie Next sie nutzt) erkennt Googlebot', () => {
  const asNext = new RegExp(HTML_LIMITED_BOTS.source, 'i');
  assert.ok(asNext.test(BOTS.googlebotSmartphone));
  assert.ok(!asNext.test(BROWSERS.chrome));
});
