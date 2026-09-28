// Turnierhistorie eines Spielers (2026-09-28) — eine Liste aus drei Quellen:
//   1. tft_pro_players.tournament_results  (Liquipedia-Spielerseite, nur Pros)
//   2. tft_tournament_results mit pro_puuid (verifizierte Pro-Zuordnung)
//   3. tft_tournament_player_links         (Name → Konto, fuer alle Spieler;
//      gebaut am Ende von scripts/crawl-tft-tournaments.mjs)
//
// Entdoppeln: ein JSON-Eintrag (1) faellt nur weg, wenn fuer dieselbe
// Liquipedia-Seite eine Tabellenzeile dieses Spielers existiert. Tabellenzeilen
// untereinander werden NIE entdoppelt — TPC-Cups haben zwei Preistabellen, ein
// Spieler kann dort zweimal stehen (data-skeptic 2026-09-28).

import { supabaseAdmin } from './supabase';

export interface PlayerTournamentEntry {
  tournament: string;
  date: string | null;
  /** Platz als Anzeige: "1", "5–8". */
  place: string | null;
  /** Bester Platz der Spanne — fuer die Farbe. */
  placeMin: number | null;
  prizeUsd: number | null;
  prizeNative: number | null;
  prizeCurrency: string | null;
  tier: string | null;
  /** Interne Turnierseite, wenn wir das Turnier haben; sonst Liquipedia. */
  href: string | null;
  internal: boolean;
}

export interface PlayerTournamentHistory {
  entries: PlayerTournamentEntry[];
  wins: number;
  earningsUsd: number | null;
}

interface JsonResult {
  tournament?: string;
  date?: string;
  place?: string | null;
  prize_usd?: number | null;
  tier?: string | null;
  page?: string | null;
}

interface ResultRow {
  tournament_id: string;
  placement: number;
  pro_name: string;
  prize_usd: number | null;
  prize_native: number | null;
  prize_currency: string | null;
}

/** Liquipedia-Seitenname vergleichbar machen: Praefix weg, dekodiert, Leerzeichen → _. */
export function normalizeLiquipediaPage(p: string | null | undefined): string | null {
  if (!p) return null;
  let s = String(p).replace(/^https?:\/\/liquipedia\.net\/(tft|teamfighttactics)\//i, '');
  try { s = decodeURIComponent(s); } catch { /* Rohwert behalten */ }
  return s.replace(/ /g, '_').replace(/\/+$/, '').toLowerCase();
}

/** "5th-8th" → { place: "5–8", min: 5 }, "1st" → { "1", 1 }. */
export function parsePlace(raw: string | null | undefined): { place: string | null; min: number | null } {
  if (!raw) return { place: null, min: null };
  const nums = String(raw).match(/\d+/g);
  if (!nums) return { place: String(raw), min: null };
  const a = parseInt(nums[0], 10);
  const b = nums[1] ? parseInt(nums[1], 10) : null;
  return { place: b && b !== a ? `${a}–${b}` : String(a), min: a };
}

function tierLabel(t: string | null): string | null {
  if (!t) return null;
  return /^[SABC]$/.test(t) ? `${t}-Tier` : t;
}

export async function loadPlayerTournamentHistory(puuid: string): Promise<PlayerTournamentHistory> {
  const [proQ, directQ, linkQ] = await Promise.all([
    supabaseAdmin.from('tft_pro_players').select('tournament_results,total_earnings_usd').eq('puuid', puuid).maybeSingle(),
    supabaseAdmin.from('tft_tournament_results')
      .select('tournament_id,placement,pro_name,prize_usd,prize_native,prize_currency')
      .eq('pro_puuid', puuid),
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
      .select('tournament_id,placement,pro_name,prize_usd,prize_native,prize_currency')
      .in('tournament_id', [...new Set(links.map(l => l.tournament_id))]);
    if (error) throw new Error(error.message);
    for (const r of (data || []) as ResultRow[]) {
      if (wanted.has(`${r.tournament_id}|${r.pro_name}`)) rows.set(key(r), r);
    }
  }

  const tourIds = [...new Set([...rows.values()].map(r => r.tournament_id))];
  const tours = new Map<string, { name: string; tier: string | null; start_date: string | null; end_date: string | null; liquipedia_page: string }>();
  if (tourIds.length) {
    const { data, error } = await supabaseAdmin.from('tft_tournaments')
      .select('id,name,tier,start_date,end_date,liquipedia_page').in('id', tourIds);
    if (error) throw new Error(error.message);
    for (const t of data || []) tours.set(t.id, t);
  }

  const entries: PlayerTournamentEntry[] = [];
  const tablePages = new Set<string>();
  for (const r of rows.values()) {
    const t = tours.get(r.tournament_id);
    if (!t) continue;
    const page = normalizeLiquipediaPage(t.liquipedia_page);
    if (page) tablePages.add(page);
    entries.push({
      tournament: t.name,
      date: t.end_date || t.start_date,
      place: String(r.placement),
      placeMin: r.placement,
      prizeUsd: r.prize_usd,
      prizeNative: r.prize_native,
      prizeCurrency: r.prize_currency,
      tier: tierLabel(t.tier),
      href: `/tft/tournaments/${r.tournament_id}`,
      internal: true,
    });
  }

  const json = (proQ.data?.tournament_results || []) as JsonResult[];
  for (const j of json) {
    const page = normalizeLiquipediaPage(j.page);
    if (page && tablePages.has(page)) continue;
    const p = parsePlace(j.place);
    entries.push({
      tournament: j.tournament || '—',
      date: j.date || null,
      place: p.place,
      placeMin: p.min,
      prizeUsd: j.prize_usd && j.prize_usd > 0 ? j.prize_usd : null,
      prizeNative: null,
      prizeCurrency: null,
      tier: j.tier || null,
      href: j.page || null,
      internal: false,
    });
  }

  entries.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const wins = entries.filter(e => e.placeMin === 1).length;
  const summed = entries.reduce((s, e) => s + (e.prizeUsd || 0), 0);
  // Liquipedias Gesamtsumme fuer Pros ist die gepflegte Zahl; sonst die Summe
  // der bekannten Dollarbetraege (Landeswaehrung ohne Kurs zaehlt nicht mit).
  const proTotal = proQ.data?.total_earnings_usd;
  const earningsUsd = proTotal && proTotal > 0 ? Math.max(proTotal, summed) : summed > 0 ? summed : null;
  return { entries, wins, earningsUsd };
}
