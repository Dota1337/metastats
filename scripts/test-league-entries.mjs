#!/usr/bin/env node
// T2 aus infra/specs/2026-08-02-marktwert-inkrementell.md
// Aktivitaetserkennung isoliert — inklusive der Faelle, die wehtun.
// Kein Riot, keine DB: reine Logik, laeuft in Millisekunden.

import { splitByActivity, rankChallengers, fetchD2PlusEntriesDetailed, __testables } from './lib/tft-league-entries.mjs';

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : `\n       erwartet ${JSON.stringify(expected)}, war ${JSON.stringify(actual)}`}`);
  if (!ok) failed++;
}

const entry = (puuid, games) => [puuid, {
  puuid, tier: 'DIAMOND', rank: 'I', lp: 50,
  wins: games, losses: 0, games, inactive: false,
}];

console.log('=== splitByActivity ===');

{
  // Der Normalfall: Zaehler unveraendert -> inaktiv, kein Riot-Call noetig.
  const entries = new Map([entry('p1', 100)]);
  const { active, inactive } = splitByActivity([{ puuid: 'p1', gamesPlayed: 100 }], entries);
  check('gleicher Zaehler -> inaktiv', [active.length, inactive.length], [0, 1]);
}
{
  const entries = new Map([entry('p1', 103)]);
  const { active, inactive } = splitByActivity([{ puuid: 'p1', gamesPlayed: 100 }], entries);
  check('Zaehler gestiegen -> aktiv', [active.length, inactive.length], [1, 0]);
}
{
  // Season-Reset oder Datenkorrektur: lieber neu rechnen als stillschweigend
  // einen falschen Wert konservieren.
  const entries = new Map([entry('p1', 5)]);
  const { active, inactive } = splitByActivity([{ puuid: 'p1', gamesPlayed: 100 }], entries);
  check('Zaehler GESUNKEN -> aktiv', [active.length, inactive.length], [1, 0]);
}
{
  // Erstlauf direkt nach der Migration: Spalte ist noch NULL.
  const entries = new Map([entry('p1', 100)]);
  const { active, inactive } = splitByActivity([{ puuid: 'p1', gamesPlayed: null }], entries);
  check('kein Vortageswert -> aktiv', [active.length, inactive.length], [1, 0]);
}
{
  // Spieler aus D2+ herausgefallen: kein Eintrag mehr. Nicht ueberspringen —
  // sonst friert sein Wert fuer immer ein.
  const { active, inactive } = splitByActivity([{ puuid: 'ghost', gamesPlayed: 100 }], new Map());
  check('kein Liga-Eintrag -> aktiv', [active.length, inactive.length], [1, 0]);
  check('kein Liga-Eintrag -> entry ist null', active[0].entry, null);
}
{
  // Gemischte Kohorte, realistische Verteilung.
  const entries = new Map([entry('a', 10), entry('b', 20), entry('c', 30)]);
  const { active, inactive } = splitByActivity([
    { puuid: 'a', gamesPlayed: 10 },   // inaktiv
    { puuid: 'b', gamesPlayed: 19 },   // aktiv
    { puuid: 'c', gamesPlayed: 30 },   // inaktiv
    { puuid: 'd', gamesPlayed: 5 },    // aktiv (kein Eintrag)
  ], entries);
  check('gemischt: 2 aktiv / 2 inaktiv', [active.length, inactive.length], [2, 2]);
  check('gemischt: richtige Aktive', active.map(x => x.puuid).sort(), ['b', 'd']);
}
{
  const { active, inactive } = splitByActivity([], new Map());
  check('leere Kandidatenliste', [active.length, inactive.length], [0, 0]);
}

console.log('=== normalize ===');
{
  const n = __testables.normalize(
    { puuid: 'x', rank: 'II', leaguePoints: 42, wins: 7, losses: 3, inactive: true },
    'CHALLENGER',
  );
  check('Apex-Form: tier aus Endpoint', n.tier, 'CHALLENGER');
  check('Apex-Form: games = wins+losses', n.games, 10);
  check('Apex-Form: inactive uebernommen', n.inactive, true);
}
{
  const n = __testables.normalize(
    { puuid: 'y', tier: 'diamond', rank: 'I', leaguePoints: 0, wins: 0, losses: 0 },
    null,
  );
  check('Divisions-Form: eigener tier gewinnt', n.tier, 'DIAMOND');
  check('0 Spiele bleibt 0 (nicht null/NaN)', n.games, 0);
}
{
  // Defensive: fehlende Felder duerfen kein NaN erzeugen, sonst vergiftet
  // ein einzelner kaputter Eintrag den Vergleich fuer den ganzen Spieler.
  const n = __testables.normalize({ puuid: 'z' }, 'MASTER');
  check('fehlende wins/losses -> 0, nicht NaN', [n.wins, n.losses, n.games], [0, 0, 0]);
  check('fehlende lp -> 0', n.lp, 0);
}

console.log('=== rankChallengers ===');
{
  const ch = (puuid, lp, wins) => ({ puuid, tier: 'CHALLENGER', lp, wins });
  const m = rankChallengers([
    ch('c', 900, 50),
    ch('a', 1200, 80),
    { puuid: 'gm', tier: 'GRANDMASTER', lp: 5000, wins: 999 },  // zaehlt nicht
    ch('b2', 900, 60),   // gleiche LP, mehr Siege -> vor c
    ch('b1', 900, 60),   // gleiche LP + Siege -> puuid entscheidet
  ]);
  check('Reihenfolge LP, dann Siege, dann puuid',
    ['a', 'b1', 'b2', 'c'].map(p => m.get(p)), [1, 2, 3, 4]);
  check('Nicht-Challenger bekommt keinen Platz', m.has('gm'), false);
  check('Eingabereihenfolge egal', [...rankChallengers([ch('x', 1, 0), ch('y', 2, 0)])], [['y', 1], ['x', 2]]);
  check('leere Liste', rankChallengers([]).size, 0);
}

console.log('=== fetchD2PlusEntriesDetailed: Lade-Status ===');
{
  // Nachgebauter Riot-Abruf: Apex-Listen + Diamond-Seiten, Fehler steuerbar.
  const mk = (n, pre) => Array.from({ length: n }, (_, i) => ({ puuid: `${pre}${i}`, leaguePoints: 100, wins: 1, losses: 1 }));
  const fake = (opts) => async (url) => {
    for (const t of ['challenger', 'grandmaster', 'master']) {
      if (url.includes(`/league/v1/${t}`)) {
        if (opts.fail === t) return { _status: 503 };
        return { entries: mk(t === 'master' ? (opts.masterN ?? 3) : 2, t) };
      }
    }
    const d = url.match(/DIAMOND\/(I{1,2})\?page=(\d+)/);
    if (d) {
      if (opts.failDiv === d[1]) return { _status: 500 };
      return Number(d[2]) === 1 ? mk(2, `d${d[1]}`) : [];
    }
    return null;
  };
  const ok = await fetchD2PlusEntriesDetailed('euw1', fake({}), 'k');
  check('alles geladen', ok.loaded, { CHALLENGER: true, GRANDMASTER: true, MASTER: true, DIAMOND_I: true, DIAMOND_II: true });
  check('alles geladen: 2+2+3+2+2 Eintraege', ok.entries.size, 11);
  check('alles geladen: Master nicht gedeckelt', ok.masterCapped, false);

  const gm = await fetchD2PlusEntriesDetailed('euw1', fake({ fail: 'grandmaster' }), 'k');
  check('GM-Fehler -> GM nicht geladen, Rest schon', [gm.loaded.CHALLENGER, gm.loaded.GRANDMASTER, gm.loaded.MASTER], [true, false, true]);

  const d2 = await fetchD2PlusEntriesDetailed('euw1', fake({ failDiv: 'II' }), 'k');
  check('D-II-Fehler -> D II unvollstaendig', [d2.loaded.DIAMOND_I, d2.loaded.DIAMOND_II], [true, false]);

  const cap = await fetchD2PlusEntriesDetailed('euw1', fake({ masterN: __testables.APEX_CAP }), 'k');
  check('Master am Deckel -> masterCapped', cap.masterCapped, true);
}

console.log('');
if (failed > 0) { console.error(`=== ${failed} FEHLER ===`); process.exit(1); }
console.log('=== alle Tests gruen ===');
