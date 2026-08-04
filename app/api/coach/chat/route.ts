import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { checkRateLimit } from '../../../lib/rate-limit';
import { TFT_COACH_ENABLED } from '../../../lib/feature-flags';
import { supabaseAdmin } from '../../../lib/supabase';
import { fetchHetznerPlayerMatches } from '../../../lib/tft-hetzner-matches';

// POST /api/coach/chat
// Body: { messages: [{role, content}], puuid?, region?, set? }
//
// Streaming Claude chat with optional player-context block prepended.
// When { puuid, region } is passed, we look up the player's recent matches
// from tft_player_match_cache and inject a concise summary as the first
// system-content item so the coach can give targeted advice.
//
// Requires ANTHROPIC_API_KEY. Returns 503 if missing so the frontend can
// degrade gracefully instead of throwing.

export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_MESSAGES = 20;
const STANDARD_RANKED_QUEUE = 1100;
const MODEL = 'claude-haiku-4-5-20251001';

interface ChatMessage { role: 'user' | 'assistant'; content: string }

async function buildPlayerContext(puuid: string, setNumber: number | null): Promise<string | null> {
  try {
    // Match cache lives on Hetzner — Supabase only has the marketvalue
    // snapshots replicated, so read via the refresh-api proxy.
    const matches = await fetchHetznerPlayerMatches({
      puuids: [puuid],
      setNumber: setNumber ?? undefined,
      queueId: STANDARD_RANKED_QUEUE,
      limitPerPuuid: 60,
    });
    if (matches.length === 0) return null;

    const games = matches.length;
    const sumP = matches.reduce((s: number, m: any) => s + (m.placement || 0), 0);
    const top4 = matches.filter((m: any) => m.placement <= 4).length;
    const top1 = matches.filter((m: any) => m.placement === 1).length;
    const avgPlace = sumP / games;
    const avgLevel = matches.reduce((s: number, m: any) => s + (m.level || 0), 0) / games;
    const avgGoldLeft = matches.reduce((s: number, m: any) => s + (m.goldLeft || 0), 0) / games;
    const avgDamage = matches.reduce((s: number, m: any) => s + (m.totalDamage || 0), 0) / games;

    // Top traits across last 20 games
    const traitCounts = new Map<string, number>();
    for (const m of matches as any[]) {
      for (const tr of m.traits || []) {
        if ((tr.style || 0) > 0 && tr.name) {
          traitCounts.set(tr.name, (traitCounts.get(tr.name) || 0) + 1);
        }
      }
    }
    const topTraits = [...traitCounts.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([n, c]) => `${n.replace(/^TFT\d+_/, '')} (${c})`).join(', ');

    return `## Player context (last ${games} ranked games)
- Avg placement: ${avgPlace.toFixed(2)}
- Top-4 rate: ${(top4/games*100).toFixed(0)}% (${top4}/${games})
- Win rate: ${(top1/games*100).toFixed(0)}% (${top1}/${games})
- Avg final level: ${avgLevel.toFixed(1)}
- Avg gold left at death: ${avgGoldLeft.toFixed(0)}
- Avg damage dealt: ${avgDamage.toFixed(0)}
- Most-played traits: ${topTraits}`;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  // Feature-Kill-Switch VOR allem anderen: kein Rate-Limit-State, kein
  // DB-Zugriff, keine Anthropic-Inferenz. 404 statt 503, damit der Endpoint
  // für Scraper nicht wie ein temporär gestörter Dienst aussieht.
  if (!TFT_COACH_ENABLED) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // 5 Coach-Calls pro IP pro Minute — Anthropic-Quota schützt sich indirekt
  // schon (max_tokens cap), aber einen offen-stehenden POST-Endpoint mit
  // teurer KI-Inferenz schützen wir hier zusätzlich.
  const limited = checkRateLimit(req, { key: 'coach-chat', max: 5, windowMs: 60_000 });
  if (limited) return limited;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'coach_unavailable', note: 'ANTHROPIC_API_KEY not configured' }, { status: 503 });
  }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const { messages, puuid, region: _region, set } = body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'messages_required' }, { status: 400 });
  }

  // Trim message history + sanitise roles
  const cleanMessages: ChatMessage[] = messages
    .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_MESSAGES)
    .map((m: any) => ({ role: m.role, content: m.content.slice(0, 4000) }));

  const playerCtx = puuid ? await buildPlayerContext(String(puuid), typeof set === 'number' ? set : null) : null;

  const systemPrompt = `You are a senior Teamfight Tactics coach. Give concise, actionable advice in the language of the user's last message. Reference real TFT mechanics: streaks, economy, levelling tempo, item-slamming, carousel priority, augment archetypes, comp pivots. Avoid generic platitudes.

When player context is provided, ground every recommendation in their numbers. Call out specific weaknesses (e.g. "your 73g avg gold-left is high — push econ less, slam items").

Keep responses under 200 words unless the user asks for a deep dive.${playerCtx ? '\n\n' + playerCtx : ''}`;

  const client = new Anthropic({ apiKey });

  try {
    const stream = await client.messages.stream({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: cleanMessages,
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
        } catch (e: any) {
          controller.enqueue(encoder.encode(`\n\n[error: ${e.message || 'stream_failed'}]`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'anthropic_error', detail: e.message }, { status: 502 });
  }
}
