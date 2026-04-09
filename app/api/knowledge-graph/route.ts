import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Knowledge Graph MVP — Supabase-based relationship queries
 * Maps: Player → Team → League → Region → Results
 * Answers: "Who played with whom?", "Career trajectories", "Team histories"
 */

interface GraphNode {
  id: string;
  type: 'player' | 'team' | 'region';
  name: string;
  meta?: Record<string, any>;
}

interface GraphEdge {
  from: string;
  to: string;
  type: 'plays_for' | 'played_for' | 'in_region' | 'teammate';
  meta?: Record<string, any>;
}

interface GraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  query: string;
}

let cachedGraph: { players: any[]; teams: any[]; time: number } | null = null;
const CACHE_TTL = 10 * 60 * 1000;

function loadData() {
  const now = Date.now();
  if (cachedGraph && now - cachedGraph.time < CACHE_TTL) return cachedGraph;

  const proPlayersPath = path.join(process.cwd(), 'public', 'pro-players.json');
  const proTeamsPath = path.join(process.cwd(), 'public', 'pro-teams.json');

  let players: any[] = [];
  let teams: any[] = [];

  try { players = JSON.parse(fs.readFileSync(proPlayersPath, 'utf-8')).players || []; } catch {}
  try { teams = JSON.parse(fs.readFileSync(proTeamsPath, 'utf-8')).teams || []; } catch {}

  cachedGraph = { players, teams, time: now };
  return cachedGraph;
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q') || '';
  const type = request.nextUrl.searchParams.get('type') || 'search'; // search, teammates, career, team-history

  const { players, teams } = loadData();

  try {
    switch (type) {
      case 'teammates':
        return NextResponse.json(findTeammates(query, players, teams));

      case 'career':
        return NextResponse.json(getCareerPath(query, players, teams));

      case 'team-history':
        return NextResponse.json(getTeamHistory(query, teams));

      case 'connections':
        return NextResponse.json(getConnections(query, players, teams));

      default:
        return NextResponse.json(searchGraph(query, players, teams));
    }
  } catch (error) {
    return NextResponse.json({ error: 'Graph-Abfrage fehlgeschlagen' }, { status: 500 });
  }
}

// Find all teammates of a player (current and historical)
function findTeammates(playerName: string, players: any[], teams: any[]): GraphResult {
  const q = playerName.toLowerCase();
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();

  // Find player in pro-players.json OR in team rosters
  let player = players.find(p => p.proName?.toLowerCase() === q || p.proName?.toLowerCase().includes(q));

  // If not found in players list, search team rosters
  if (!player) {
    for (const t of teams) {
      const found = (t.roster || []).find((r: any) =>
        r.name?.toLowerCase() === q || r.name?.toLowerCase().includes(q)
      );
      if (found) {
        player = { proName: found.name, team: t.name, role: found.role, accounts: found.accounts || [] };
        break;
      }
    }
  }
  if (!player) return { nodes: [], edges: [], query: playerName };

  const playerId = `player:${player.proName}`;
  nodes.push({ id: playerId, type: 'player', name: player.proName, meta: { role: player.role, team: player.team } });
  nodeIds.add(playerId);

  // Find current team roster
  const team = teams.find(t => t.name === player.team);
  if (team) {
    const teamId = `team:${team.name}`;
    if (!nodeIds.has(teamId)) {
      nodes.push({ id: teamId, type: 'team', name: team.name, meta: { region: team.region, logo: team.logo } });
      nodeIds.add(teamId);
    }
    edges.push({ from: playerId, to: teamId, type: 'plays_for' });

    for (const mate of (team.roster || []).filter((r: any) => r.isPlayer)) {
      const mateId = `player:${mate.name}`;
      if (mate.name !== player.proName && !nodeIds.has(mateId)) {
        nodes.push({ id: mateId, type: 'player', name: mate.name, meta: { role: mate.role, image: mate.image } });
        nodeIds.add(mateId);
        edges.push({ from: mateId, to: teamId, type: 'plays_for' });
        edges.push({ from: playerId, to: mateId, type: 'teammate', meta: { team: team.name } });
      }
    }
  }

  // Find in other teams' rosters (historical connections)
  for (const t of teams) {
    if (t.name === player.team) continue;
    const found = (t.roster || []).find((r: any) =>
      r.name?.toLowerCase() === q || r.name?.toLowerCase().includes(q)
    );
    if (found) {
      const teamId = `team:${t.name}`;
      if (!nodeIds.has(teamId)) {
        nodes.push({ id: teamId, type: 'team', name: t.name, meta: { region: t.region } });
        nodeIds.add(teamId);
      }
      edges.push({ from: playerId, to: teamId, type: 'played_for' });

      // Add former teammates
      for (const mate of (t.roster || []).filter((r: any) => r.isPlayer && r.name !== found.name)) {
        const mateId = `player:${mate.name}`;
        if (!nodeIds.has(mateId)) {
          nodes.push({ id: mateId, type: 'player', name: mate.name, meta: { role: mate.role } });
          nodeIds.add(mateId);
        }
        if (edges.length < 100) {
          edges.push({ from: playerId, to: mateId, type: 'teammate', meta: { team: t.name, historical: true } });
        }
      }
    }
  }

  return { nodes, edges, query: playerName };
}

// Get a player's career path
function getCareerPath(playerName: string, players: any[], teams: any[]) {
  const q = playerName.toLowerCase();
  let player = players.find(p => p.proName?.toLowerCase() === q || p.proName?.toLowerCase().includes(q));
  if (!player) {
    for (const t of teams) {
      const found = (t.roster || []).find((r: any) => r.name?.toLowerCase() === q || r.name?.toLowerCase().includes(q));
      if (found) { player = { proName: found.name, team: t.name, role: found.role }; break; }
    }
  }
  if (!player) return { career: [], query: playerName };

  const career: { team: string; region: string; role: string; current: boolean }[] = [];

  // Current team
  if (player.team) {
    const team = teams.find(t => t.name === player.team);
    career.push({
      team: player.team,
      region: team?.region || 'Unknown',
      role: player.role,
      current: true,
    });
  }

  // Check all team rosters for historical entries
  for (const t of teams) {
    if (t.name === player.team) continue;
    const found = (t.roster || []).find((r: any) =>
      r.name?.toLowerCase() === q || r.name?.toLowerCase().includes(q)
    );
    if (found) {
      career.push({
        team: t.name,
        region: t.region || 'Unknown',
        role: found.role || player.role,
        current: false,
      });
    }
  }

  return { player: player.proName, career, query: playerName };
}

// Get team history and roster changes
function getTeamHistory(teamName: string, teams: any[]) {
  const q = teamName.toLowerCase();
  const team = teams.find(t =>
    t.name?.toLowerCase() === q ||
    t.name?.toLowerCase().includes(q) ||
    t.short?.toLowerCase() === q
  );

  if (!team) return { team: null, query: teamName };

  const mainRoster = (team.roster || []).filter((r: any) => r.isPlayer && r.status === 'main');
  const subs = (team.roster || []).filter((r: any) => r.isPlayer && r.status !== 'main');
  const staff = (team.roster || []).filter((r: any) => !r.isPlayer);

  return {
    team: {
      name: team.name,
      short: team.short,
      region: team.region,
      logo: team.logo,
      mainRoster,
      subs,
      staff,
      results: (team.results || []).slice(0, 20),
      trophies: team.trophies || [],
      totalPrizeMoney: team.totalPrizeMoney || 0,
    },
    query: teamName,
  };
}

// Search for any entity in the graph
function searchGraph(query: string, players: any[], teams: any[]) {
  const q = query.toLowerCase();

  // Search players from pro-players.json (name only, not team - too many false positives)
  const matchedPlayers = players
    .filter(p => p.proName?.toLowerCase().includes(q))
    .slice(0, 10)
    .map(p => ({ type: 'player' as const, name: p.proName, team: p.team, role: p.role, country: p.country }));

  // Also search players from team rosters
  const seenNames = new Set(matchedPlayers.map(p => p.name?.toLowerCase()));
  const rosterPlayers: any[] = [];
  for (const t of teams) {
    for (const m of (t.roster || []).filter((r: any) => r.isPlayer)) {
      if (m.name?.toLowerCase().includes(q) && !seenNames.has(m.name?.toLowerCase())) {
        seenNames.add(m.name.toLowerCase());
        rosterPlayers.push({ type: 'player' as const, name: m.name, team: t.name, role: m.role, country: m.country || '' });
        if (rosterPlayers.length >= 10) break;
      }
    }
    if (rosterPlayers.length >= 10) break;
  }

  // Search teams
  const matchedTeams = teams
    .filter(t => t.name?.toLowerCase().includes(q) || t.short?.toLowerCase() === q)
    .slice(0, 10)
    .map(t => ({
      type: 'team' as const, name: t.name, short: t.short, region: t.region,
      rosterSize: (t.roster || []).filter((r: any) => r.isPlayer).length,
      trophies: (t.trophies || []).length,
    }));

  return {
    results: [...matchedTeams, ...matchedPlayers, ...rosterPlayers],
    totalPlayers: players.length,
    totalTeams: teams.length,
    query,
  };
}

// Get all connections for a player (network view)
function getConnections(playerName: string, players: any[], teams: any[]) {
  const q = playerName.toLowerCase();
  const connections: { name: string; team: string; role: string; connection: string; shared: string }[] = [];

  let player = players.find(p => p.proName?.toLowerCase() === q || p.proName?.toLowerCase().includes(q));
  if (!player) {
    for (const t of teams) {
      const found = (t.roster || []).find((r: any) => r.name?.toLowerCase() === q || r.name?.toLowerCase().includes(q));
      if (found) { player = { proName: found.name, team: t.name, role: found.role }; break; }
    }
  }
  if (!player) return { connections: [], query: playerName };

  // Find all teams this player has been on
  const playerTeams: string[] = [];
  if (player.team) playerTeams.push(player.team);

  for (const t of teams) {
    const found = (t.roster || []).find((r: any) =>
      r.name?.toLowerCase() === q || r.name?.toLowerCase().includes(q)
    );
    if (found && !playerTeams.includes(t.name)) {
      playerTeams.push(t.name);
    }
  }

  // Find all teammates from all those teams
  for (const teamName of playerTeams) {
    const team = teams.find(t => t.name === teamName);
    if (!team) continue;

    for (const mate of (team.roster || []).filter((r: any) => r.isPlayer)) {
      if (mate.name?.toLowerCase() === q || mate.name?.toLowerCase().includes(q)) continue;

      connections.push({
        name: mate.name,
        team: teamName,
        role: mate.role,
        connection: teamName === player.team ? 'Aktueller Teammate' : 'Ehemaliger Teammate',
        shared: teamName,
      });
    }
  }

  return {
    player: player.proName,
    currentTeam: player.team,
    connections,
    teamsCount: playerTeams.length,
    query: playerName,
  };
}
