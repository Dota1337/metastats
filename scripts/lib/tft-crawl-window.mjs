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
// mode=auto it is the last COMPLETED 05:00-UTC window: D-1 from 05:00 UTC on,
// D-2 before. The value is constant from 05:00 to the next 05:00, so the
// 05:45 run and the 16/20/23:00 watchdog resumes all hit the same day.
// Bis 2026-09-13 wurde `now` auf 00:00 UTC verankert (immer D-2) — der Lauf
// startete um Mitternacht, vor dem Ende des Vortagsfensters. Seit der Timer
// auf 05:45 steht, ist D-1 fertig und die Seite damit einen Tag frischer.
// An explicit --day backfill or mode=today passes through.
export function resolveDailyTargetDay(now = new Date(), mode = 'auto', dayOverride = null) {
  if (dayOverride) return dayOverride;
  if (mode === 'today') return resolveCrawlDay(now, 'today', null);
  return resolveCrawlDay(now, 'auto', null);
}
