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
const PAGE_GUARD = 60;   // Schutz gegen Endlos-Paging bei API-Anomalien

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
  const log = opts.log || (() => {});
  const out = new Map();
  let calls = 0;

  // 1) Apex — je ein Call, liefert die komplette Liga am Stueck.
  for (const tier of APEX_TIERS) {
    const data = await rl(
      `https://${region}.api.riotgames.com/tft/league/v1/${tier}?api_key=${apiKey}`,
    );
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
    log(`  [entries] ${tier}: ${entries.length}`);
  }

  // 2) Diamond I + II — paginiert bis die API leer liefert.
  for (const div of DIAMOND_DIVISIONS) {
    let page = 1;
    let got = 0;
    while (page <= PAGE_GUARD) {
      const data = await rl(
        `https://${region}.api.riotgames.com/tft/league/v1/entries/DIAMOND/${div}`
        + `?page=${page}&api_key=${apiKey}`,
      );
      calls++;
      if (!Array.isArray(data) || data.length === 0) break;
      for (const e of data) {
        if (!e?.puuid) continue;
        // Apex gewinnt: ein Spieler kann waehrend des Abrufs aufgestiegen sein
        // und dann in beiden Listen auftauchen.
        if (!out.has(e.puuid)) out.set(e.puuid, normalize(e, 'DIAMOND'));
      }
      got += data.length;
      page++;
    }
    log(`  [entries] DIAMOND ${div}: ${got}`);
  }

  log(`  [entries] gesamt ${out.size} Spieler in ${calls} Calls`);
  return out;
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

export const __testables = { normalize, APEX_TIERS, DIAMOND_DIVISIONS };
