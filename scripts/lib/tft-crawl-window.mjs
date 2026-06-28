// Single source of truth for the TFT daily-crawl 24h window and its `day`
// label. Extracted verbatim from collect-tft-allranks.mjs (Backlog-Item 2 L2)
// so the all-regions driver can compute the SAME targetDay the per-region
// children will write — without replicating the 05:00-UTC boundary logic,
// which would drift (logic-flow-critic B1, 2026-06-28).
//
// mode='auto'  → most recent COMPLETED 24h window anchored at 05:00 UTC.
//                Before 05:00 UTC: [D-2 05:00, D-1 05:00), day = D-2.
//                At/after 05:00 UTC: [D-1 05:00, D 05:00), day = D-1.
//                (The boundary is why a single mode=auto run that crosses 05:00
//                 used to split its regions across two days — the driver now
//                 pins one targetDay instead, see resolveDailyTargetDay.)
// mode='today' → rolling [today 05:00, now), day = today. Falls back to auto
//                semantics before 05:00 so we never crawl a zero-length window.
// dayOverride  → 'YYYY-MM-DD' forces [day 05:00, day+1 05:00), day = override.

export function computeWindow(now = new Date(), mode = 'auto', dayOverride = null) {
  if (dayOverride) {
    const startTime = new Date(dayOverride + 'T05:00:00Z');
    const endTime = new Date(startTime.getTime() + 86_400_000);
    return { startTime, endTime };
  }
  const today5 = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 5, 0, 0, 0,
  ));
  if (mode === 'today' && now >= today5) {
    return { startTime: today5, endTime: now };
  }
  const endTime = now < today5 ? new Date(today5.getTime() - 86_400_000) : today5;
  const startTime = new Date(endTime.getTime() - 86_400_000);
  return { startTime, endTime };
}

// The calendar date (YYYY-MM-DD) the window's start falls on — i.e. the `day`
// column value each per-region child writes for this (now, mode, override).
export function resolveCrawlDay(now = new Date(), mode = 'auto', dayOverride = null) {
  return computeWindow(now, mode, dayOverride).startTime.toISOString().slice(0, 10);
}

// The ONE targetDay pinned for a whole daily run (Backlog-Item 2 L2). For
// mode=auto it anchors `now` to 00:00 UTC of its calendar day BEFORE applying
// the auto-window logic, so the result is the same D-2 no matter when within
// the day the run starts. That lets the 16:00 watchdog resume reproduce the
// exact day the 00:00 run targeted, instead of drifting to D-1 once wall-clock
// crosses 05:00. An explicit --day backfill or mode=today passes through.
export function resolveDailyTargetDay(now = new Date(), mode = 'auto', dayOverride = null) {
  if (dayOverride) return dayOverride;
  if (mode === 'today') return resolveCrawlDay(now, 'today', null);
  const anchorMidnight = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0,
  ));
  return resolveCrawlDay(anchorMidnight, 'auto', null);
}
