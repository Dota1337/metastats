#!/bin/bash
# metastats-daily-crawl-watchdog.sh
#
# Recovery trigger for the daily all-ranks crawl (Backlog-Item 2 L3). The 00:00
# UTC daily-crawl already isolates per-region failures (one region's 522 doesn't
# stop the others) and L1 retries transient blips, but a sustained Supabase
# outage can still leave some regions without data for the day. This watchdog
# fires at 16:00 + 20:00 UTC and triggers a cursor-aware resume for whatever
# regions are still missing.
#
# No DB check here: the resume driver is cursor-aware (a region is "done" <=>
# its child exited 0, recorded in /etc/metastats-crawler/daily-crawl-cursor.json)
# and No-Ops when every active region already completed. So the watchdog only
# has to make sure nothing else is holding the Riot bucket, then kick the resume
# service. This deliberately avoids the psql-local check the marketvalue watchdog
# uses — tft_daily_* live on Supabase, not the local PG (logic-flow-critic W3).
#
# NO Conflicts= anywhere in this chain: a Conflicts= SIGTERM would kill a running
# crawl instead of protecting it. We use an is-active skip instead (W1).

set -euo pipefail

LOG_PREFIX="[daily-crawl-watchdog]"

# Skip if anything sharing the Riot bucket — or a still-running prior resume, or
# the post-crawl snapshot publish — is live. `systemctl is-active` returns exit 3
# for activating/inactive/failed; `|| true` keeps the real status string in
# $state instead of letting the non-zero exit clobber it (the `|| echo inactive`
# bug from 2026-06-20).
for svc in metastats-daily-crawl \
           metastats-daily-crawl-resume \
           metastats-crawler \
           metastats-marketvalue-snapshot \
           metastats-snapshot-publisher \
           metastats-daily-crawl-catchup \
           metastats-tft-pro-fullsync; do
  state=$(systemctl is-active "${svc}.service" 2>/dev/null) || true
  if [[ "$state" == "active" || "$state" == "activating" ]]; then
    echo "${LOG_PREFIX} ${svc}.service ist ${state} — skip"
    exit 0
  fi
done

echo "${LOG_PREFIX} kein Geschwister-Crawl aktiv — triggere cursor-aware resume"
systemctl start --no-block metastats-daily-crawl-resume.service
exit 0
