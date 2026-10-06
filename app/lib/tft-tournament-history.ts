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
// Sonderpreise (Bounty, MVP …) stehen seit 0087 in tft_tournament_awards. Die
// "zweite Preistabelle" der TPC-Cups war genau das; aeltere Laeufe hatten sie
// als falsche Plaetze in tft_tournament_results geschrieben. Ein Sonderpreis
// gehoert zum Spieler, wenn er direkt zugeordnet ist (pro_puuid), sein
// Platz-Name (place_name) eine Zeile des Spielers trifft oder sein Name in
// tft_tournament_player_links auf das Konto zeigt.

import { supabaseAdmin } from './supabase';
import {
  mergeTournamentHistory,
  type JsonResult, type ResultRow, type TourInfo, type AwardRow,
  type PlayerTournamentEntry, type PlayerTournamentHistory,
} from './tft-tournament-history-merge';

export type { PlayerTournamentEntry, PlayerTournamentHistory };
export { normalizeLiquipediaPage, parsePlace } from './tft-tournament-history-merge';

const ROW_COLUMNS = 'tournament_id,placement,placement_max,pro_name,prize_usd,prize_native,prize_currency';
const AWARD_COLUMNS = 'tournament_id,award,pro_name,place_name,prize_usd';

const none = Promise.resolve({ data: [] as never[], error: null });

export async function loadPlayerTournamentHistory(puuid: string): Promise<PlayerTournamentHistory> {
  const [proQ, directQ, linkQ, directAwardQ] = await Promise.all([
    supabaseAdmin.from('tft_pro_players').select('tournament_results,total_earnings_usd').eq('puuid', puuid).maybeSingle(),
    supabaseAdmin.from('tft_tournament_results').select(ROW_COLUMNS).eq('pro_puuid', puuid),
    supabaseAdmin.from('tft_tournament_player_links').select('tournament_id,raw_name').eq('puuid', puuid),
    supabaseAdmin.from('tft_tournament_awards').select(AWARD_COLUMNS).eq('pro_puuid', puuid),
  ]);
  if (proQ.error) throw new Error(proQ.error.message);
  if (directQ.error) throw new Error(directQ.error.message);
  if (linkQ.error) throw new Error(linkQ.error.message);
  if (directAwardQ.error) throw new Error(directAwardQ.error.message);

  const rows = new Map<string, ResultRow>();
  const key = (r: ResultRow) => `${r.tournament_id}|${r.placement}|${r.pro_name}`;
  for (const r of (directQ.data || []) as ResultRow[]) rows.set(key(r), r);

  const links = (linkQ.data || []) as { tournament_id: string; raw_name: string }[];
  const directAwards = (directAwardQ.data || []) as AwardRow[];
  const wanted = new Set(links.map(l => `${l.tournament_id}|${l.raw_name}`));
  const linkTids = [...new Set(links.map(l => l.tournament_id))];
  // Alle Turniere, aus denen Zeilen oder Boni kommen koennen — die Zeilen der
  // Konto-Zuordnung, die Boni und die Turnier-Daten in EINEM Schritt laden.
  const rowTids = [...new Set([...[...rows.values()].map(r => r.tournament_id), ...linkTids])];
  const tourIds = [...new Set([...rowTids, ...directAwards.map(a => a.tournament_id)])];
  const [linkRowQ, awardQ, tourQ] = await Promise.all([
    linkTids.length ? supabaseAdmin.from('tft_tournament_results').select(ROW_COLUMNS).in('tournament_id', linkTids) : none,
    rowTids.length ? supabaseAdmin.from('tft_tournament_awards').select(AWARD_COLUMNS).in('tournament_id', rowTids) : none,
    tourIds.length
      ? supabaseAdmin.from('tft_tournaments').select('id,name,tier,start_date,end_date,liquipedia_page').in('id', tourIds)
      : none,
  ]);
  if (linkRowQ.error) throw new Error(linkRowQ.error.message);
  if (awardQ.error) throw new Error(awardQ.error.message);
  if (tourQ.error) throw new Error(tourQ.error.message);
  for (const r of (linkRowQ.data || []) as ResultRow[]) {
    if (wanted.has(`${r.tournament_id}|${r.pro_name}`)) rows.set(key(r), r);
  }

  const mine = new Set([...rows.values()].map(r => `${r.tournament_id}|${r.pro_name}`));
  const awards = new Map<string, AwardRow>();
  const awardKey = (a: AwardRow) => `${a.tournament_id}|${a.award}|${a.pro_name}`;
  for (const a of directAwards) awards.set(awardKey(a), a);
  for (const a of (awardQ.data || []) as AwardRow[]) {
    if ((a.place_name && mine.has(`${a.tournament_id}|${a.place_name}`)) || wanted.has(`${a.tournament_id}|${a.pro_name}`)) {
      awards.set(awardKey(a), a);
    }
  }

  const tours = new Map<string, TourInfo>();
  for (const t of (tourQ.data || []) as (TourInfo & { id: string })[]) tours.set(t.id, t);

  return mergeTournamentHistory({
    json: (proQ.data?.tournament_results || []) as JsonResult[],
    totalEarningsUsd: proQ.data?.total_earnings_usd ?? null,
    rows: [...rows.values()],
    tours,
    awards: [...awards.values()],
  });
}
