import { supabaseAdmin as supabase } from '../../lib/supabase';
import { cachedJson, SLOW_CACHE_CONTROL } from '../../lib/api-cache';
import { fetchAllPages } from '../../lib/supabase-pages';
import {
  MV_HISTORY_COLUMNS, WEEKLY_LOOKBACK_MS, weeklyReferenceByPlayer, type MvHistoryRow,
} from '../../lib/marketvalue-history';

interface PlayerRow {
  id: string;
  summoner_name: string;
  region: string;
  market_value: number;
  tier: string;
  rank: string;
  winrate: number;
}

export async function GET() {
  try {
    const now = Date.now();
    // Alle bewerteten Spieler und den Verlauf seitenweise lesen und im Speicher
    // verknuepfen: eine .in()-Liste ueber alle IDs wuerde die URL sprengen.
    const [players, history] = await Promise.all([
      fetchAllPages<PlayerRow>(() => supabase
        .from('players')
        .select('id, summoner_name, region, market_value, tier, rank, winrate')
        .gt('market_value', 0)
        .order('id')),
      fetchAllPages<MvHistoryRow>(() => supabase
        .from('market_value_history')
        .select(MV_HISTORY_COLUMNS)
        .gte('recorded_at', new Date(now - WEEKLY_LOOKBACK_MS).toISOString())
        .order('recorded_at')
        .order('player_id')),
    ]);
    if (!players) throw new Error('players');

    const top = [...players].sort((a, b) => b.market_value - a.market_value).slice(0, 20);

    // Nur Spieler mit echtem Vergleichswert; ohne einen gibt es keine
    // Veraenderung (nicht 0), siehe weeklyReferenceByPlayer.
    const refs = weeklyReferenceByPlayer(history || [], now);
    const changes = players
      .filter(p => refs.has(p.id))
      .map(p => ({ ...p, change: p.market_value - refs.get(p.id)! }));

    const gainers = changes.filter(p => p.change > 0).sort((a, b) => b.change - a.change).slice(0, 5);
    const losers = changes.filter(p => p.change < 0).sort((a, b) => a.change - b.change).slice(0, 5);

    // Marktwerte kommen aus dem Tageslauf — 1h frisch, 24h SWR.
    return cachedJson({ top, gainers, losers }, {
      cache: SLOW_CACHE_CONTROL,
      degraded: top.length === 0,
    });
  } catch {
    // Der catch liefert bewusst weiter 200 mit leeren Listen (die Startseite
    // soll nicht wegen der Rangliste kippen), aber mit 10s statt 1h: sonst
    // haelt ein Sekunden-Ausfall die Rangliste eine Stunde leer.
    return cachedJson({ top: [], gainers: [], losers: [] }, { degraded: true });
  }
}
