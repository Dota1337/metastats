/** Utility to check if a summoner name matches a known pro player */

export interface ProAccount {
  name: string;
  tag: string;
  region: string;
  rank?: string;
  verified?: boolean;
  sources?: number;
}

export interface ProPlayer {
  proName: string;
  team: string;
  role: string;
  league?: string;
  accounts: string[];
  mainAccount?: ProAccount | null;
  smurfs?: ProAccount[];
}

let proData: { players: ProPlayer[] } | null = null;
let proLookup: Map<string, ProPlayer> | null = null;
let proAccountNames: { name: string; player: ProPlayer }[] = []; // for substring matching

async function loadProData(origin?: string): Promise<void> {
  if (proData) return;
  try {
    if (origin) {
      const res = await fetch(`${origin}/pro-players.json`);
      if (res.ok) {
        proData = await res.json();
      }
    }
  } catch {}
  if (!proData) {
    proData = { players: [] };
  }
  proLookup = new Map();
  proAccountNames = [];
  for (const p of proData.players) {
    for (const acc of p.accounts || []) {
      const lower = acc.toLowerCase();
      proLookup.set(lower, p);
      if (lower.includes('#')) {
        proLookup.set(lower.split('#')[0], p);
      }
      // Build substring index (only names >= 3 chars to avoid false positives)
      if (lower.length >= 3) {
        proAccountNames.push({ name: lower, player: p });
      }
    }
    if (p.proName) {
      proLookup.set(p.proName.toLowerCase(), p);
      if (p.proName.length >= 3) {
        proAccountNames.push({ name: p.proName.toLowerCase(), player: p });
      }
    }
  }
}

/** Server-side: check if a summoner name is a pro player */
export async function findProPlayer(summonerName: string, origin?: string): Promise<ProPlayer | null> {
  await loadProData(origin);
  if (!proLookup) return null;
  const lower = summonerName.toLowerCase();
  // Try full match first, then name-only (before #)
  return proLookup.get(lower) || proLookup.get(lower.split('#')[0]) || null;
}

/** Client-side: load pro player data and return lookup function */
export async function loadProLookup(): Promise<Map<string, ProPlayer>> {
  if (proLookup) return proLookup;
  try {
    const res = await fetch('/pro-players.json');
    if (res.ok) {
      proData = await res.json();
    }
  } catch {}
  if (!proData) proData = { players: [] };
  proLookup = new Map();
  proAccountNames = [];
  for (const p of proData.players) {
    for (const acc of p.accounts || []) {
      const lower = acc.toLowerCase();
      proLookup.set(lower, p);
      if (lower.includes('#')) {
        proLookup.set(lower.split('#')[0], p);
      }
      if (lower.length >= 3) {
        proAccountNames.push({ name: lower, player: p });
      }
    }
    if (p.proName) {
      proLookup.set(p.proName.toLowerCase(), p);
      if (p.proName.length >= 3) {
        proAccountNames.push({ name: p.proName.toLowerCase(), player: p });
      }
    }
  }
  return proLookup;
}

/** Helper: find a pro player by name (tries full name, name before #, proName, and substring) */
export function lookupPro(lookup: Map<string, ProPlayer>, name: string): ProPlayer | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  const namePart = lower.split('#')[0]; // "g2 skewmond"

  // Direct match
  const direct = lookup.get(lower) || lookup.get(namePart);
  if (direct) return direct;

  // Substring match: "g2 skewmond" contains "skewmond"
  for (const entry of proAccountNames) {
    if (namePart.includes(entry.name) || entry.name.includes(namePart)) {
      return entry.player;
    }
  }

  return null;
}
