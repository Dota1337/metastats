import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '../../../lib/supabase';

// This endpoint is called by Vercel Cron every 6 hours
// It checks if a new LoL patch has been released and stores it

export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel sets this header for cron jobs)
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // Also allow without auth in dev
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    // Fetch latest version from DDragon
    const versionsRes = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
    const versions: string[] = await versionsRes.json();
    const latestVersion = versions[0];

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
