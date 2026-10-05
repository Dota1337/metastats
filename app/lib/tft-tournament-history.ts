// Turnierhistorie eines Spielers (2026-09-28) — eine Liste aus drei Quellen:
//   1. tft_pro_players.tournament_results  (Liquipedia <Spieler>/Results, nur Pros)
//   2. tft_tournament_results mit pro_puuid (verifizierte Pro-Zuordnung)
//   3. tft_tournament_player_links         (Name → Konto, fuer alle Spieler;
//      gebaut am Ende von scripts/crawl-tft-tournaments.mjs)
//
// Hier wird nur geladen. Wie die Quellen zusammengefuehrt werden (welche
// Zeile zaehlt, Siege, Tier, Preisgeld), steht in tft-tournament-history-merge.ts
// — ohne Datenbank-Import und deshalb getestet.
//
// Tabellenzeilen untereinander werden NIE entdoppelt — TPC-Cups haben zwei
// Preistabellen, ein Spieler kann dort zweimal stehen (data-skeptic 2026-09-28).

import { supabaseAdmin } from './supabase';
import {
  mergeTournamentHistory,
  type JsonResult, type ResultRow, type TourInfo,
  type PlayerTournamentEntry, type PlayerTournamentHistory,
} from './tft-tournament-history-merge';

export type { PlayerTournamentEntry, PlayerTournamentHistory };
export { normalizeLiquipediaPage, parsePlace } from './tft-tournament-history-merge';

const ROW_COLUMNS = 'tournament_id,placement,placement_max,pro_name,prize_usd,prize_native,prize_currency';

export async function loadPlayerTournamentHistory(puuid: string): Promise<PlayerTournamentHistory> {
  const [proQ, directQ, linkQ] = await Promise.all([
    supabaseAdmin.from('tft_pro_players').select('tournament_results,total_earnings_usd').eq('puuid', puuid).maybeSingle(),
    supabaseAdmin.from('tft_tournament_results').select(ROW_COLUMNS).eq('pro_puuid', puuid),
    supabaseAdmin.from('tft_tournament_player_links').select('tournament_id,raw_name').eq('puuid', puuid),
  ]);
  if (proQ.error) throw new Error(proQ.error.message);
  if (directQ.error) throw new Error(directQ.error.message);
  if (linkQ.error) throw new Error(linkQ.error.message);

  const rows = new Map<string, ResultRow>();
  const key = (r: ResultRow) => `${r.tournament_id}|${r.placement}|${r.pro_name}`;
  for (const r of (directQ.data || []) as ResultRow[]) rows.set(key(r), r);

  const links = (linkQ.data || []) as { tournament_id: string; raw_name: string }[];
  if (links.length) {
    const wanted = new Set(links.map(l => `${l.tournament_id}|${l.raw_name}`));
    const { data, error } = await supabaseAdmin.from('tft_tournament_results')
      .select(ROW_COLUMNS)
      .in('tournament_id', [...new Set(links.map(l => l.tournament_id))]);
    if (error) throw new Error(error.message);
    for (const r of (data || []) as ResultRow[]) {
      if (wanted.has(`${r.tournament_id}|${r.pro_name}`)) rows.set(key(r), r);
    }
  }

  const tourIds = [...new Set([...rows.values()].map(r => r.tournament_id))];
  const tours = new Map<string, TourInfo>();
  if (tourIds.length) {
    const { data, error } = await supabaseAdmin.from('tft_tournaments')
      .select('id,name,tier,start_date,end_date,liquipedia_page').in('id', tourIds);
    if (error) throw new Error(error.message);
    for (const t of data || []) tours.set(t.id, t);
  }

  return mergeTournamentHistory({
    json: (proQ.data?.tournament_results || []) as JsonResult[],
    totalEarningsUsd: proQ.data?.total_earnings_usd ?? null,
    rows: [...rows.values()],
    tours,
  });
}
