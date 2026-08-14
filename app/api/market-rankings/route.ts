import { supabaseAdmin as supabase } from '../../lib/supabase';
import { cachedJson, SLOW_CACHE_CONTROL } from '../../lib/api-cache';

export async function GET() {
  try {
    const { data: players } = await supabase
      .from('players')
      .select('id, summoner_name, region, market_value, tier, rank, winrate')
      .not('market_value', 'is', null)
      .order('market_value', { ascending: false })
      .limit(20);

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const { data: history } = await supabase
      .from('market_value_history')
      .select('player_id, market_value, recorded_at')
      .gte('recorded_at', oneWeekAgo.toISOString());

    const changes = (players || []).map(p => {
      const oldEntry = (history || [])
        .filter(h => h.player_id === p.id)
        .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime())[0];
      return {
        ...p,
        change: oldEntry ? p.market_value - oldEntry.market_value : 0,
      };
    });

    const gainers = [...changes].sort((a, b) => b.change - a.change).slice(0, 5);
    const losers = [...changes].sort((a, b) => a.change - b.change).slice(0, 5);

    // Marktwerte kommen aus dem Tageslauf — 1h frisch, 24h SWR.
    return cachedJson({ top: players || [], gainers, losers }, {
      cache: SLOW_CACHE_CONTROL,
      degraded: (players || []).length === 0,
    });
  } catch {
    // Der catch liefert bewusst weiter 200 mit leeren Listen (die Startseite
    // soll nicht wegen der Rangliste kippen), aber mit 10s statt 1h: sonst
    // haelt ein Sekunden-Ausfall die Rangliste eine Stunde leer.
    return cachedJson({ top: [], gainers: [], losers: [] }, { degraded: true });
  }
}