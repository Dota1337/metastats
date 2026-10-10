// Mitspieler der laufenden Partie fuer die Overwolf-App (ab 0.8): je Riot-ID
// der Rang aus dem Namensverzeichnis (nur wenn hoechstens 14 Tage alt,
// Migration 0073), die letzten Platzierungen und die haeufigsten Carries aus
// dem Match-Speicher der Box. Kein Riot-Abruf. Wen das Verzeichnis nicht kennt,
// der kommt mit found:false zurueck; die App zeigt dann nichts an.
import { NextRequest } from 'next/server';
import { searchExactNames } from '../../../../lib/tft-player-search-server';
import { fetchHetznerPlayerMatches } from '../../../../lib/tft-hetzner-matches';
import { CURRENT_SET } from '../../../../lib/current-set';
import {
  COMPANION_API_VERSION, companionJson, companionPreflight, pickLobbyAccount, toLobbyEntry,
  type CompanionLobbyEntry, type CompanionLobbyResponse,
} from '../../../../lib/companion-api';

export const maxDuration = 20;

const MAX_NAMES = 8;
const RECENT = 10;
// Mehr als die App zeigt (3): sie laesst Nicht-Champions weg (gemessen u. a.
// DA_Sentinel18 als carry_unit).
const TOP_CARRIES = 5;
// Normal und Ranked; Double Up, Hyper Roll usw. verzerren Platz und Carries.
const QUEUES = new Set([1090, 1100]);
const NO_STORE = { cdn: 'no-store', browser: 'no-store' };
const NAME_RE = /^[^#,]{1,32}#[^#,]{1,8}$/;

export function OPTIONS() {
  return companionPreflight();
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const names = [...new Set((sp.get('names') || '').split(',').map(s => s.trim()).filter(Boolean))];
  const region = (sp.get('region') || '').trim().toLowerCase();
  if (names.length === 0 || names.length > MAX_NAMES || !names.every(n => NAME_RE.test(n))) {
    return companionJson({ v: COMPANION_API_VERSION, error: 'bad_names' }, { status: 400, ...NO_STORE });
  }

  // Konto je Name#Tag: pickLobbyAccount (companion-api.ts).
  let lookupFailed = false;
  const accounts = await Promise.all(names.map(async full => {
    const [gameName, tag] = full.split('#');
    const hits = await searchExactNames(gameName);
    if (hits == null) { lookupFailed = true; return null; }
    return pickLobbyAccount(hits, tag, region || null);
  }));
  if (lookupFailed && accounts.every(a => a == null)) {
    return companionJson({ v: COMPANION_API_VERSION, error: 'lookup_unavailable' }, { status: 503, ...NO_STORE });
  }

  const puuids = accounts.filter(a => a != null).map(a => a!.puuid);
  const byPuuid = new Map<string, Array<{ placement: number; carry: string | null }>>();
  if (puuids.length > 0) {
    try {
      const rows = await fetchHetznerPlayerMatches({
        puuids, setNumber: CURRENT_SET, queueId: null, limitPerPuuid: RECENT + 10, signalTimeoutMs: 8_000,
      });
      for (const r of rows.filter(r => QUEUES.has(r.queueId)).sort((a, b) => b.gameDatetime - a.gameDatetime)) {
        const list = byPuuid.get(r.puuid) ?? [];
        if (list.length < RECENT) list.push({ placement: r.placement, carry: r.carryUnit });
        byPuuid.set(r.puuid, list);
      }
    } catch (e) {
      // Ohne Box bleibt es beim Rang.
      console.warn('[companion-lobby] player-matches failed:', (e as Error).message);
    }
  }

  const players: CompanionLobbyEntry[] = names.map((name, i) => {
    const a = accounts[i];
    return toLobbyEntry(name, a, a ? byPuuid.get(a.puuid) ?? [] : [], TOP_CARRIES);
  });
  console.log(`[companion-lobby] found ${players.filter(p => p.found).length}/${names.length}, with games ${players.filter(p => p.recent.length).length}`);

  const body: CompanionLobbyResponse = { v: COMPANION_API_VERSION, set: CURRENT_SET ?? null, players };
  return companionJson(body, { cdn: 'public, s-maxage=300, stale-while-revalidate=600', browser: 'private, max-age=120' });
}
