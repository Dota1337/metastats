#!/usr/bin/env bash
# Catch-up hook for metastats-daily-crawl.service.
#
# Background: the daily-crawl timer fires at 00:00 UTC every day. The service
# is Type=oneshot with TimeoutStartSec=infinity, so a long run is allowed to
# finish at its own pace. But if a run ever crosses UTC midnight, systemd
# silently ignores the next 00:00 trigger (it does not start a second instance
# of a still-active oneshot). That would cost us one day of aggregation.
#
# This script runs via OnSuccess= right after the daily-crawl finishes.
# It compares the run's start day (UTC) to the current day (UTC). If they
# differ, at least one 00:00 trigger was swallowed, so we start one more
# daily-crawl pass immediately. The new run covers the day we'd otherwise lose.
#
# If that catch-up run itself crosses midnight again, this script will fire
# again on its OnSuccess — and so on, until a run finishes within its own
# UTC day. That is the user-requested behavior: "im Anschluss automatisch
# startet, unabhängig von der Uhrzeit".

set -euo pipefail

LOG_TAG="metastats-daily-crawl-catchup"

# For Type=oneshot, ExecMainStartTimestamp marks when the main process began —
# this is what we want regardless of whether the service ever reached the
# "active" state during the run. Fall back to InactiveExitTimestamp (state
# transition into activating) if needed.
last_start=$(systemctl show metastats-daily-crawl.service \
  --property=ExecMainStartTimestamp --value 2>/dev/null || true)
if [ -z "${last_start:-}" ]; then
  last_start=$(systemctl show metastats-daily-crawl.service \
    --property=InactiveExitTimestamp --value 2>/dev/null || true)
fi

if [ -z "${last_start:-}" ] || [ "$last_start" = "n/a" ]; then
  logger -t "$LOG_TAG" "No start timestamp available — skipping catch-up check"
  exit 0
fi

last_start_day_utc=$(date -u -d "$last_start" +%Y-%m-%d 2>/dev/null || true)
now_day_utc=$(date -u +%Y-%m-%d)

if [ -z "$last_start_day_utc" ]; then
  logger -t "$LOG_TAG" "Could not parse start timestamp ($last_start) — skipping"
  exit 0
fi

if [ "$last_start_day_utc" = "$now_day_utc" ]; then
  logger -t "$LOG_TAG" "Previous run finished within its UTC day ($now_day_utc) — no catch-up needed"
  exit 0
fi

logger -t "$LOG_TAG" "Previous run crossed UTC midnight (started $last_start_day_utc, finished $now_day_utc) — triggering catch-up run"
systemctl start --no-block metastats-daily-crawl.service
