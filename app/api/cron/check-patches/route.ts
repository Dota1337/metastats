import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '../../../lib/supabase';
import { getLatestDdragonVersion } from '../../../lib/ddragon-version-server';
import { cronAuthFailure } from '../../../lib/cron-auth';

// This endpoint is called by Vercel Cron once a day (vercel.json)
// It checks if a new LoL patch has been released and stores it

export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel sets this header for cron jobs)
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  try {
    // Fetch latest version from DDragon
    // fresh: ohne Speicher und ohne Rueckfall, sonst landet bei einem
    // ddragon-Ausfall eine alte Version als "no_change" im Protokoll.
    const latestVersion = await getLatestDdragonVersion({ fresh: true });
    if (!latestVersion) throw new Error('ddragon nicht erreichbar');

    // Check what we last stored
    const { data: stored } = await supabase
      .from('site_config')
      .select('value')
      .eq('key', 'latest_patch')
      .single();

    const storedVersion = stored?.value || '';

    if (latestVersion !== storedVersion) {
      // New patch detected!
      await supabase.from('site_config').upsert({
        key: 'latest_patch',
        value: latestVersion,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });

      // Also store in patch history
      await supabase.from('site_config').upsert({
        key: `patch_${latestVersion}`,
        value: JSON.stringify({
          version: latestVersion,
          detectedAt: new Date().toISOString(),
        }),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });

      return NextResponse.json({
        status: 'new_patch_detected',
        version: latestVersion,
        previous: storedVersion,
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      status: 'no_change',
      currentVersion: latestVersion,
      lastChecked: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ error: 'Cron check failed' }, { status: 500 });
  }
}
