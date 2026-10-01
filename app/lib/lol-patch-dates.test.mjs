import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePatchArticles } from './lol-patch-dates.ts';

const page = (items) => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { blades: [{ items }] } })}</script></html>`;
const art = (title, publishedAt, url) => ({ title, publishedAt, action: { payload: { url } } });

test('Titel bestimmt den Patch, Adresse kommt von Riot', () => {
  const m = parsePatchArticles(page([
    art('League of Legends Patch 26.19 Notes', '2026-09-22T18:00:00.000Z', '/en-us/news/game-updates/league-of-legends-patch-26-19-notes'),
    art('Patch 26.3 Notes', '2026-02-03T19:00:00.000Z', '/en-us/news/game-updates/patch-26-3-notes'),
    art('Patch 25.04 Notes', '2025-02-19T19:00:00.000Z', '/en-us/news/game-updates/patch-25-04-notes'),
  ]));
  assert.deepEqual(m.get('26.19'), { date: '2026-09-22', url: 'https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-19-notes' });
  assert.equal(m.get('26.3').url.endsWith('/patch-26-3-notes'), true);
  assert.equal(m.get('25.4').date, '2025-02-19');
});

test('Eintraege ohne Patch-Titel zaehlen nicht', () => {
  const m = parsePatchArticles(page([art('Patch Notes Rundown', '2026-09-22T18:00:00.000Z', '/en-us/x')]));
  assert.equal(m.size, 0);
});

test('kaputte Seite -> leere Tabelle', () => {
  assert.equal(parsePatchArticles('<html></html>').size, 0);
  assert.equal(parsePatchArticles('<script id="__NEXT_DATA__">{kaputt</script>').size, 0);
});
