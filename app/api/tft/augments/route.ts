import { NextRequest } from 'next/server';
import { cachedJson } from '../../../lib/api-cache';

// Augment-stats endpoint is intentionally inert. Riot has restricted display
// of augment statistics, so we no longer surface placement/pickrate/top4 per
// augment. The reference catalog at /tft/augments reads name/desc/tier from
// the public CommunityDragon asset bundle (= game data, not Match-V1-derived).
//
// The route is left in place so existing callers (cached client components,
// external links) don't break — it just returns an empty hasData=false payload.

export async function GET(_request: NextRequest) {
  return cachedJson({
    hasData: false,
    augments: [],
    patches: [],
    note: 'augment statistics are not available',
  });
}
