// Tests fuer den Liquipedia-Turnier-Parser gegen echte, gespeicherte Seiten
// (scripts/fixtures/tft-tournament-*). Kein Netz, keine Datenbank.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  extractPrizePoolPlacements, parsePlacementTableHtml, parseResultsHtml, parseBatchResponse,
  parseTeamCards, resolveTeam, splitTopLevel, stripComments, decodeEntities, parsePrize,
  detectPageCurrency, parseInfobox, participantsFromInfobox, fetchWikitextBatch, fetchHtmlFresh,
  fetchRedirectAliases, resolveTitles, LiquipediaApiError,
} from './tft-tournament-parse.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (n) => readFileSync(path.join(here, '..', 'fixtures', n), 'utf8');
const find = (rows, name) => rows.filter(r => r.proName === name);

test('Einzelturnier: 32 Plaetze, Sonderpreise nicht mitgezaehlt', () => {
  const r = extractPrizePoolPlacements(fx('tft-tournament-solo.txt'));
  assert.equal(r.rows.length, 32);
  assert.equal(r.intact, true);
  assert.equal(r.needsHtml, false);
  assert.deepEqual(r.rows.map(x => x.placement), Array.from({ length: 32 }, (_, i) => i + 1));
  assert.deepEqual(find(r.rows, 'Loescher').map(x => [x.placement, x.prizeUsdRaw]), [[15, 700]]);
  assert.deepEqual(find(r.rows, 'Deleted').map(x => [x.placement, x.prizeUsdRaw]), [[16, 700]]);
  assert.deepEqual(find(r.rows, 'k0nda1').map(x => [x.placement, x.prizeUsdRaw]), [[32, 400]]);
  assert.ok(r.rows.every(x => x.placementMax === null));
});

test('Duo-Turnier: beide Spieler je Platz, kein Preis eingetragen', () => {
  const r = extractPrizePoolPlacements(fx('tft-tournament-duo.txt'));
  assert.equal(r.rows.length, 8);
  assert.deepEqual(r.rows.filter(x => x.placement === 1).map(x => x.proName).sort(), ['Loescher', 'Lorus']);
  assert.ok(r.rows.every(x => x.prizeUsdRaw === null && x.kind === 'duo'));
  assert.equal(detectPageCurrency(fx('tft-tournament-duo.txt'), parseInfobox(fx('tft-tournament-duo.txt'))), 'EUR');
});

test('Team-Pool ohne eingetragene Teams: nichts erfinden, HTML anfordern', () => {
  const r = extractPrizePoolPlacements(fx('tft-tournament-duo-noname.txt'));
  assert.equal(r.rows.length, 0);
  assert.equal(r.needsHtml, true);
  assert.equal(r.intact, false);
  // Layout-Vorlagen sind keine Karten
  assert.deepEqual(parseTeamCards(fx('tft-tournament-duo-noname.txt')).map(c => c.team),
    ['Team SLAB', 'Team Skateparkge', 'Team Geriatric Gamers', 'Team Jetlag Diff']);
  assert.equal(participantsFromInfobox(parseInfobox(fx('tft-tournament-duo-noname.txt'))), 4);
});

test('Duo-Teams im Einzel-Pool: Spieler aus den Karten, geteilter Platz zaehlt zwei Gegner', () => {
  const r = extractPrizePoolPlacements(fx('tft-tournament-duo-teamopp.txt'));
  assert.equal(r.intact, true);
  assert.equal(r.rows.length, 16);
  assert.deepEqual(r.rows.filter(x => x.placement === 1).map(x => [x.proName, x.prizeUsdRaw]),
    [['EZ', 5000], ['Hong Lian', 5000]]);
  // "GLG Esports Club" im Pool, "GLG Esports" auf der Karte
  assert.deepEqual(r.rows.filter(x => x.placement === 3).map(x => x.proName), ['Autenticos', 'LifesBad']);
  const p5 = r.rows.filter(x => x.placement === 5);
  assert.equal(p5.length, 4);
  assert.ok(p5.every(x => x.placementMax === 6 && x.prizeUsdRaw === 250));
  const p7 = r.rows.filter(x => x.placement === 7);
  assert.equal(p7.length, 4);
  assert.ok(p7.every(x => x.placementMax === 8 && x.prizeUsdRaw === 250));
});

test('Team-Turnier: ohne HTML keine Zeilen, mit HTML Plaetze 1..16 und keine Betreuer', () => {
  const wt = fx('tft-tournament-team.txt');
  const bare = extractPrizePoolPlacements(wt);
  assert.equal(bare.rows.length, 0);
  assert.equal(bare.needsHtml, true);
  assert.equal(bare.intact, false);

  const places = parsePlacementTableHtml(fx('tft-tournament-team-placements.html'));
  assert.equal(places.length, 16);
  assert.deepEqual([...new Set(places.map(p => `${p.placement}-${p.placementMax ?? ''}`))],
    ['1-', '2-', '3-4', '5-8', '9-12', '13-16']);

  const r = extractPrizePoolPlacements(wt, { teamPlaces: places });
  assert.equal(r.intact, true);
  assert.equal(r.needsHtml, false);
  assert.equal(r.rows.length, 64);
  assert.deepEqual(r.rows.filter(x => x.team === 'MOUZ').map(x => [x.proName, x.placement, x.placementMax, x.prizeUsdRaw]), [
    ['salvyy', 9, 12, 15000], ['Loescher', 9, 12, 15000], ['WetJungler', 9, 12, 15000], ['Sologesang', 9, 12, 15000],
  ]);
  assert.equal(find(r.rows, 'Panda')[0].link, 'Panda (Kim Se-jin)');
  assert.deepEqual(find(r.rows, 'Saopimi').map(x => [x.placement, x.prizeUsdRaw]), [[1, 150000]]);
  assert.equal(find(r.rows, 'Xavient').length, 0);   // Betreuer
  assert.equal(find(r.rows, 'YGQF').length, 1);      // "p1=YGQF |p1wins=1"

  const split = extractPrizePoolPlacements(wt, { teamPlaces: places, teamPrizeMode: 'split' });
  assert.equal(find(split.rows, 'Loescher')[0].prizeUsdRaw, 3750);
});

test('Ergebnisliste Loescher: 10 Zeilen, 4 Siege nur fuer genau "1st"', () => {
  const { headerFound, rows } = parseResultsHtml(fx('tft-tournament-results.html'), { playerName: 'Loescher' });
  assert.equal(headerFound, true);
  assert.equal(rows.length, 10);
  assert.equal(rows.filter(r => r.win).length, 4);
  const shared = rows.find(r => r.placeText === '1st - 2nd');
  assert.equal(shared.win, false);
  assert.deepEqual([shared.placement, shared.placementMax], [1, 2]);
  assert.equal(rows.find(r => r.tournament.startsWith('BoxBox')).tier, null);   // Misc
  const duo = rows[1];
  assert.deepEqual([duo.mode, duo.partners], ['duo', ['Lorus']]);
  const dh = rows.find(r => r.pageTitle === 'Into_the_Arcane/EMEA/DreamHack_Stockholm');
  assert.deepEqual([dh.mode, dh.team, dh.prizeUsd], ['solo', 'HIGHROLLERS', 3125]);
  const ewc = rows.find(r => r.pageTitle === 'Esports_World_Cup/2025');
  assert.deepEqual([ewc.mode, ewc.team, ewc.placement, ewc.placementMax, ewc.prizeUsd], ['team', 'MOUZ', 9, 12, 15000]);
  assert.equal(rows.find(r => r.date === '2024-11-02').pageTitle, "Magic_n'_Mayhem/EMEA/Golden_Spatula");
  const last = rows[9];
  assert.equal(last.date, null);
  assert.equal(last.pageTitle, 'Esports_World_Cup/2026/EMEA/Open_Qualifier');
  assert.deepEqual([last.mode, last.team], ['team', 'Team Loescher']);
});

test('Ergebnisliste ohne Kopfzeile: headerFound false, keine Zeilen', () => {
  const r = parseResultsHtml('<div><table class="wikitable"><tr><th>Foo</th></tr><tr><td>x</td></tr></table></div>');
  assert.equal(r.headerFound, false);
  assert.equal(r.rows.length, 0);
});

test('Stapelantwort: Normalisierung, Weiterleitung Deleted→JosueDeleted, fehlende Seite', () => {
  const j = JSON.parse(fx('tft-tournament-batch.json'));
  const req = ['Space_Gods/EMEA/Major', 'TFT_Digi_Duos_Invitational', 'Hextech_Havoc_Double_Up', 'Gibt_Es_Nicht_Probe_123', 'Deleted'];
  const r = parseBatchResponse(j, req);
  assert.equal(r.byRequested.get('Deleted').title, 'JosueDeleted');
  assert.equal(r.byRequested.get('Space_Gods/EMEA/Major').title, 'Space Gods/EMEA/Major');
  assert.deepEqual(r.missing, ['Gibt_Es_Nicht_Probe_123']);
  assert.equal(r.byRequested.size, 4);
});

test('Tiefenzaehler: "}}}}" schliesst genau zwei Ebenen', () => {
  const body = '|{{Slot|usdprize=1|{{SoloOpponent|A}}}}|{{Slot|usdprize=2|{{SoloOpponent|B}}}}';
  assert.deepEqual(splitTopLevel(body).filter(Boolean).length, 2);
  const wt = `{{SoloPrizePool${body}\n}}`;
  const r = extractPrizePoolPlacements(wt);
  assert.deepEqual(r.rows.map(x => [x.placement, x.proName, x.prizeUsdRaw]), [[1, 'A', 1], [2, 'B', 2]]);
});

test('Kleinkram: Kommentare, Entitaeten, Preise, Teamzuordnung', () => {
  assert.equal(stripComments('a<!-- x -->b<!-- offen'), 'ab');
  assert.equal(decodeEntities('Magic n&#39; Mayhem&#160;&amp;#39;'), "Magic n' Mayhem &#39;");
  assert.equal(parsePrize('$3,125'), 3125);
  assert.equal(parsePrize('1.234,56'), 1234);
  assert.equal(parsePrize('-'), null);
  assert.equal(parsePrize('0'), null);
  const cards = [{ team: 'Alpha Esports', players: [] }, { team: 'Alpha Esports Academy', players: [] }];
  assert.equal(resolveTeam('Alpha', cards), null);                       // mehrdeutig
  assert.equal(resolveTeam('Alpha Esports', cards).team, 'Alpha Esports'); // exakt schlaegt Praefix
});

test('Leerer Slot im Einzel-Pool macht die Seite "nicht heil"', () => {
  const r = extractPrizePoolPlacements('{{SoloPrizePool\n|{{Slot|usdprize=5|{{SoloOpponent|A}}}}\n|{{Slot|usdprize=3|{{SoloOpponent|}}}}\n}}');
  assert.equal(r.rows.length, 1);
  assert.equal(r.intact, false);
});

test('Abruf-Helfer: missingtitle → null, andere Fehler werfen, Stapel folgt continue', async () => {
  assert.equal(await fetchHtmlFresh('X', { fetchJson: async () => ({ error: { code: 'missingtitle' } }) }), null);
  assert.equal(await fetchHtmlFresh('X', { fetchJson: async () => null }), null);
  await assert.rejects(fetchHtmlFresh('X', { fetchJson: async () => ({ error: { code: 'ratelimited', info: 'x' } }) }), LiquipediaApiError);
  const ok = await fetchHtmlFresh('A_b', { fetchJson: async (p) => {
    assert.equal(p.redirects, '1');
    return { parse: { title: 'A b', text: { '*': '<p>x</p>' }, redirects: [] } };
  } });
  assert.equal(ok.html, '<p>x</p>');

  const calls = [];
  const fetchJson = async (p, o) => {
    calls.push({ p, o });
    if (!p.rvcontinue) {
      return { continue: { rvcontinue: '2', continue: '||' }, query: { pages: {
        1: { pageid: 1, title: 'A', revisions: [{ slots: { main: { '*': 'aaa' } } }] },
        2: { pageid: 2, title: 'B' },
      } } };
    }
    return { query: { pages: { 2: { pageid: 2, title: 'B', revisions: [{ slots: { main: { '*': 'bbb' } } }] } } } };
  };
  const b = await fetchWikitextBatch(['A', 'B'], { fetchJson });
  assert.equal(b.byRequested.get('B').content, 'bbb');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(c => c.o.noCache === true));
  const many = Array.from({ length: 120 }, (_, i) => `T${i}`);
  let n = 0;
  await fetchWikitextBatch(many, { fetchJson: async (p) => { n++; assert.ok(p.titles.split('|').length <= 50); return { query: { pages: {} } }; } });
  assert.equal(n, 3);
  await assert.rejects(fetchWikitextBatch(['A'], { fetchJson: async () => ({ error: { code: 'x' } }) }), LiquipediaApiError);

  const al = await fetchRedirectAliases(['JosueDeleted'], { fetchJson: async () => ({ query: { pages: {
    9: { title: 'JosueDeleted', redirects: [{ title: 'Deleted' }] },
  } } }) });
  assert.deepEqual(al.get('JosueDeleted'), ['Deleted']);

  const rt = await resolveTitles(['Deleted', 'k0nda1', 'Gibt es nicht'], { fetchJson: async () => ({ query: {
    normalized: [{ from: 'Gibt es nicht', to: 'Gibt es nicht' }],
    redirects: [{ from: 'Deleted', to: 'JosueDeleted' }],
    pages: { 1: { title: 'JosueDeleted' }, 2: { title: 'K0nda1' }, '-1': { title: 'Gibt es nicht', missing: '' } },
  } }) });
  assert.equal(rt.get('Deleted'), 'JosueDeleted');
  assert.equal(rt.get('Gibt es nicht'), null);
  assert.equal(rt.get('k0nda1'), null);   // ohne Normalisierungseintrag kein Treffer → lieber null als raten
});
