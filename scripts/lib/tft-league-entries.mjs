// Gebuendelter Abruf aller D2+ Liga-Eintraege einer Region.
//
// WOZU: Die Marktwert-Pipeline hat bisher fuer JEDEN der 52.091 D2+ Spieler
// eine eigene Riot-Call-Kette gefahren — auch fuer die grosse Mehrheit, die an
// dem Tag gar nicht gespielt hat. Die Liga-Eintraege liefern pro Spieler
// `wins`/`losses`; deren Summe ist der Spielzaehler. Bewegt er sich nicht,
// hat der Spieler nicht gespielt und braucht keinen einzigen Match-Call.
//
// Kosten: ~30-60 Calls pro Region statt ~10.876.
//
// Live verifiziert 2026-08-02 gegen euw1:
//   /tft/league/v1/entries/{tier}/{div}  -> puuid, tier, rank, leaguePoints,
//                                          wins, losses, veteran, inactive, …
//   /tft/league/v1/{challenger|grandmaster|master} -> dieselben Felder OHNE
//                                          tier (der ist durch den Endpoint
//                                          impliziert)
//
// ACHTUNG TFT-Semantik: `wins` sind Top-4-Platzierungen, `losses` Platz 5-8.
// Die Summe ist die Gesamtzahl gewerteter Spiele — genau das, was wir wollen.
// Einzeln sind die Werte fuer uns NICHT als Win-Rate im Sinne von "Siege"
// zu lesen.

const APEX_TIERS = ['challenger', 'grandmaster', 'master'];
// Der Marktwert-Basiswert floort bei Diamond II (siehe
// reference_marketvalue_skill_score_spec.md) — Division III/IV brauchen wir
// deshalb gar nicht erst zu holen.
const DIAMOND_DIVISIONS = ['I', 'II'];
const PAGE_GUARD = 60;
// Riots Apex-Endpunkte liefern hoechstens so viele Eintraege (gemessen
// 2026-08-02, siehe unten). Eine volle Master-Liste ist also abgeschnitten.
const APEX_CAP = 10_000;   // Schutz gegen Endlos-Paging bei API-Anomalien

/**
 * Ein Eintrag, normalisiert ueber beide Endpoint-Formen.
 * @typedef {{puuid: string, tier: string, rank: string, lp: number,
 *            wins: number, losses: number, games: number, inactive: boolean}} LeagueEntry
 */

function normalize(e, tier) {
  const wins = Number(e.wins ?? 0);
  const losses = Number(e.losses ?? 0);
  return {
    puuid: e.puuid,
    tier: (e.tier || tier || '').toUpperCase(),
    rank: e.rank || 'I',
    lp: Number(e.leaguePoints ?? 0),
    wins,
    losses,
    games: wins + losses,
    inactive: Boolean(e.inactive),
  };
}

/**
 * Holt alle D2+ Liga-Eintraege einer Region.
 *
 * @param {string} region        z.B. 'euw1'
 * @param {(url: string) => Promise<any>} rl  rate-limitierter Fetch (riot-client)
 * @param {string} apiKey
 * @param {{log?: (msg: string) => void}} [opts]
 * @returns {Promise<Map<string, LeagueEntry>>} puuid -> Eintrag
 */
export async function fetchD2PlusEntries(region, rl, apiKey, opts = {}) {
  return (await fetchD2PlusEntriesDetailed(region, rl, apiKey, opts)).entries;
}

/**
 * Wie fetchD2PlusEntries, meldet aber zusaetzlich, WELCHE Listen vollstaendig
 * geladen wurden. Ohne dieses Signal ist "Spieler fehlt in der Liste" nicht
 * von "Liste wurde nicht geladen" zu unterscheiden — genau daran hingen die
 * Tabellenplaetze und die Phantom-Challenger (2026-09-27).
 *
 * @returns {Promise<{
 *   entries: Map<string, LeagueEntry>,
 *   loaded: {CHALLENGER: boolean, GRANDMASTER: boolean, MASTER: boolean, DIAMOND_I: boolean, DIAMOND_II: boolean},
 *   masterCapped: boolean,
 * }>}
 */
export async function fetchD2PlusEntriesDetailed(region, rl, apiKey, opts = {}) {
  const log = opts.log || (() => {});
  const out = new Map();
  const loaded = { CHALLENGER: false, GRANDMASTER: false, MASTER: false, DIAMOND_I: false, DIAMOND_II: false };
  let masterCapped = false;
  let calls = 0;

  // 1) Apex — je ein Call, liefert die komplette Liga am Stueck.
  //
  // GRENZE (2026-08-02 gemessen): der Endpoint deckelt bei 10.000 Eintraegen.
  // euw1 und kr liefern beide exakt 10.000, also ist das ein Cap, kein Zufall,
  // und ein `page`-Parameter existiert nicht. In grossen Regionen fehlen daher
  // Master-Spieler jenseits der 10.000. Das ist bewusst nicht schlimm: wer
  // keinen Eintrag hat, gilt in splitByActivity als AKTIV und wird ganz normal
  // geladen — wir verlieren Ersparnis, nie Korrektheit.
  for (const tier of APEX_TIERS) {
    let data;
    try {
      data = await rl(
        `https://${region}.api.riotgames.com/tft/league/v1/${tier}`,
      );
    } catch (err) {
      // Pro Tier auffangen. Ohne das reisst ein einzelner 504 — bei den
      // grossen Apex-Antworten real beobachtet — den kompletten Regions-Abruf
      // mit, und ALLE Spieler der Region gelten wieder als aktiv. Ein
      // Teilergebnis ist deutlich mehr wert als gar keins.
      log(`  [entries] ${tier}: Abruf fehlgeschlagen (${err.message}) — Tier uebersprungen`);
      calls++;
      continue;
    }
    calls++;
    const entries = data?.entries;
    if (!Array.isArray(entries)) {
      // Kein stiller Skip: eine fehlende Apex-Liga heisst, dass uns die
      // staerksten Spieler der Region fehlen. Das muss sichtbar sein.
      log(`  [entries] WARNUNG ${tier}: keine entries (${JSON.stringify(data).slice(0, 120)})`);
      continue;
    }
    for (const e of entries) {
      if (!e?.puuid) continue;
      out.set(e.puuid, normalize(e, tier.toUpperCase()));
    }
    loaded[tier.toUpperCase()] = true;
    if (tier === 'master' && entries.length >= APEX_CAP) masterCapped = true;
    log(`  [entries] ${tier}: ${entries.length}${tier === 'master' && masterCapped ? ' (Obergrenze erreicht — Liste unvollstaendig)' : ''}`);
  }

  // 2) Diamond I + II — paginiert bis die API leer liefert.
  for (const div of DIAMOND_DIVISIONS) {
    let page = 1;
    let got = 0;
    let complete = false;
    while (page <= PAGE_GUARD) {
      let data;
      try {
        data = await rl(
          `https://${region}.api.riotgames.com/tft/league/v1/entries/DIAMOND/${div}`
          + `?page=${page}`,
        );
      } catch (err) {
        // Seite verloren -> Division hier abbrechen, aber das bisher Geholte
        // behalten. Die Spieler der fehlenden Seiten gelten dann als aktiv.
        log(`  [entries] DIAMOND ${div} Seite ${page}: ${err.message} — Rest der Division uebersprungen`);
        calls++;
        break;
      }
      calls++;
      if (!Array.isArray(data)) break;
      if (data.length === 0) { complete = true; break; }
      let added = 0;
      for (const e of data) {
        if (!e?.puuid) continue;
        // Apex gewinnt: ein Spieler kann waehrend des Abrufs aufgestiegen sein
        // und dann in beiden Listen auftauchen.
        if (!out.has(e.puuid)) { out.set(e.puuid, normalize(e, 'DIAMOND')); added++; }
      }
      got += added;
      // Bringt eine Seite ausschliesslich Duplikate, laeuft die Paginierung
      // ins Leere (API liefert dieselbe Seite erneut, oder wir sind am Ende
      // und bekommen Ueberlappung). Sofort abbrechen statt bis PAGE_GUARD
      // weiterzufragen — das waeren sonst bis zu 60 nutzlose Calls je Division.
      if (added === 0) { complete = true; break; }
      page++;
    }
    loaded[`DIAMOND_${div}`] = complete;
    log(`  [entries] DIAMOND ${div}: ${got}${complete ? '' : ' (UNVOLLSTAENDIG)'}`);
  }

  log(`  [entries] gesamt ${out.size} Spieler in ${calls} Calls`);
  return { entries: out, loaded, masterCapped };
}

/**
 * Tabellenplatz innerhalb der Challenger-Liga: LP absteigend, bei Gleichstand
 * mehr Top-4 zuerst, danach puuid — damit derselbe Stand immer dieselben
 * Plaetze ergibt, egal in welcher Reihenfolge Riot die Liste liefert.
 *
 * @param {Iterable<{puuid: string, tier: string, lp: number, wins: number}>} entries
 * @returns {Map<string, number>} puuid -> Platz (1-basiert)
 */
export function rankChallengers(entries) {
  const chall = [];
  for (const e of entries) if (e && e.tier === 'CHALLENGER' && e.puuid) chall.push(e);
  chall.sort((a, b) => (b.lp - a.lp) || ((b.wins ?? 0) - (a.wins ?? 0))
    || (a.puuid < b.puuid ? -1 : a.puuid > b.puuid ? 1 : 0));
  const out = new Map();
  chall.forEach((e, i) => out.set(e.puuid, i + 1));
  return out;
}

/**
 * Nur die Challenger-Liste holen und daraus die Plaetze bilden — fuer Pfade,
 * die einzelne Spieler rechnen (Refresh-Knopf, --puuids-Nachlauf).
 *
 * @returns {Promise<Map<string, number> | null>} null, wenn die Liste nicht
 *   geladen werden konnte. Der Aufrufer entscheidet dann, nicht der Helfer.
 */
export async function fetchChallengerLadder(region, rl) {
  let data;
  try {
    data = await rl(`https://${region}.api.riotgames.com/tft/league/v1/challenger`);
  } catch {
    return null;
  }
  if (!Array.isArray(data?.entries)) return null;
  return rankChallengers(data.entries.filter(e => e?.puuid).map(e => normalize(e, 'CHALLENGER')));
}

/**
 * Teilt die Iterations-Kandidaten in aktiv/inaktiv anhand des Spielzaehlers.
 *
 * Regeln, bewusst konservativ — im Zweifel AKTIV, weil ein zu Unrecht
 * uebersprungener Spieler stillschweigend veraltet, waehrend ein zu Unrecht
 * aktualisierter nur Zeit kostet:
 *   - kein Liga-Eintrag        -> aktiv (Spieler evtl. abgestiegen/umbenannt)
 *   - kein Vortageswert (NULL) -> aktiv (Erstlauf nach der Migration)
 *   - games > gespeichert      -> aktiv
 *   - games < gespeichert      -> aktiv (Season-Reset o.ae., neu rechnen)
 *   - games == gespeichert     -> inaktiv
 *
 * @param {Array<{puuid: string, gamesPlayed: number|null}>} candidates
 * @param {Map<string, LeagueEntry>} entries
 */
export function splitByActivity(candidates, entries) {
  const active = [];
  const inactive = [];
  for (const c of candidates) {
    const e = entries.get(c.puuid);
    if (!e || c.gamesPlayed == null || e.games !== c.gamesPlayed) {
      active.push({ ...c, entry: e || null });
    } else {
      inactive.push({ ...c, entry: e });
    }
  }
  return { active, inactive };
}

export const __testables = { normalize, APEX_TIERS, DIAMOND_DIVISIONS, APEX_CAP };

/**
 * Die ganze Rangliste ab Smaragd IV — fuer die Aufsteiger-Seite.
 *
 * Anders als fetchD2PlusEntriesDetailed: alle vier Diamant- und alle vier
 * Smaragd-Divisionen, eine hoehere Seitengrenze (Smaragd ist in grossen
 * Regionen viel breiter als Diamant I/II), und jeder Eintrag traegt den
 * Zeitpunkt SEINER Seite. Die Seite zaehlt spaeter die Partien zwischen zwei
 * Staenden — ein Abruf ueber mehrere Minuten soll dabei nicht verschmieren.
 *
 * @returns {Promise<{ entries: Map<string, LeagueEntry & {at: Date}>,
 *   apexLoaded: number, incomplete: string[], calls: number }>}
 */
const LADDER_PAGE_GUARD = 400;
export async function fetchLadderEntries(region, rl, opts = {}) {
  const log = opts.log || (() => {});
  const out = new Map();
  const incomplete = [];
  let apexLoaded = 0;
  let calls = 0;

  for (const tier of APEX_TIERS) {
    const at = new Date();
    let data;
    try {
      data = await rl(`https://${region}.api.riotgames.com/tft/league/v1/${tier}`);
    } catch (err) {
      calls++;
      incomplete.push(tier.toUpperCase());
      log(`  [ladder] ${region} ${tier}: ${err.message}`);
      continue;
    }
    calls++;
    if (!Array.isArray(data?.entries)) { incomplete.push(tier.toUpperCase()); continue; }
    for (const e of data.entries) {
      if (e?.puuid) out.set(e.puuid, { ...normalize(e, tier.toUpperCase()), at });
    }
    apexLoaded++;
  }

  for (const tier of ['DIAMOND', 'EMERALD']) {
    for (const div of ['I', 'II', 'III', 'IV']) {
      let complete = false;
      for (let page = 1; page <= LADDER_PAGE_GUARD; page++) {
        const at = new Date();
        let data;
        try {
          data = await rl(`https://${region}.api.riotgames.com/tft/league/v1/entries/${tier}/${div}?page=${page}`);
        } catch (err) {
          calls++;
          log(`  [ladder] ${region} ${tier} ${div} Seite ${page}: ${err.message}`);
          break;
        }
        calls++;
        if (!Array.isArray(data)) break;
        if (data.length === 0) { complete = true; break; }
        let added = 0;
        for (const e of data) {
          if (!e?.puuid || out.has(e.puuid)) continue;
          out.set(e.puuid, { ...normalize(e, tier), at });
          added++;
        }
        if (added === 0) { complete = true; break; }
      }
      if (!complete) incomplete.push(`${tier}_${div}`);
    }
  }

  return { entries: out, apexLoaded, incomplete, calls };
}
