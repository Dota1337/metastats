import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get('puuid') || '';
  const region = searchParams.get('region') || 'euw1';
  const apiKey = process.env.RIOT_API_KEY!;

  if (!puuid) {
    return NextResponse.json({ error: 'puuid ist erforderlich' }, { status: 400 });
  }

  try {
    const [res, configRes] = await Promise.all([
      fetch(`https://${region}.api.riotgames.com/lol/challenges/v1/player-data/${puuid}?api_key=${apiKey}`),
      fetch(`https://${region}.api.riotgames.com/lol/challenges/v1/challenges/config?api_key=${apiKey}`),
    ]);

    if (!res.ok) {
      return NextResponse.json({ error: 'Challenge-Daten nicht gefunden' }, { status: 404 });
    }

    const challenges = await res.json();

    let configMap: Record<number, { name: string; description: string; thresholds: Record<string, number> }> = {};
    if (configRes.ok) {
      const configData = await configRes.json();
      for (const c of configData) {
        configMap[c.id] = {
          name: c.localizedNames?.en_US?.name || c.localizedNames?.de_DE?.name || `Challenge #${c.id}`,
          description: c.localizedNames?.en_US?.shortDescription || '',
          thresholds: c.thresholds || {},
        };
      }
    }

    return NextResponse.json({ challenges, configMap });
  } catch (error) {
    return NextResponse.json({ error: 'Server Fehler' }, { status: 500 });
  }
}
