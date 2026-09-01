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
#
# Zwei Ausloeser, in dieser Reihenfolge (Umbau 2026-09-01)
# -------------------------------------------------------
# 1. ARBEITSSTAND (neu, und der wichtigere). Gibt es im Cursor-Fenster einen
#    Tag, der begonnen aber nicht fertig ist, wird der Resume-Lauf gestartet —
#    unabhaengig von jeder Uhrzeit.
# 2. MITTERNACHTS-UEBERTRITT (das alte Verhalten, als Rueckfallebene). Liegt
#    kein unfertiger Tag vor, aber der letzte Lauf hat die UTC-Mitternacht
#    ueberschritten, wurde ein 00:00-Trigger verschluckt -> ein voller
#    daily-crawl-Durchgang hinterher.
#
# Warum der Umbau: bis dahin verglich dieses Skript AUSSCHLIESSLICH den
# Startzeitpunkt des gerade beendeten Laufs mit dem heutigen Tag. Am 27.08.2026
# stieg der 00:03-Lauf sofort aus, weil ein noch laufender Crawl die Sperre
# hielt — er endete mit Exit 0 innerhalb desselben UTC-Tages. Dieses Skript sah
# also "Lauf im eigenen Tag beendet, kein Nachholen noetig" und meldete genau
# das, obwohl in Wahrheit NULL Arbeit passiert war. Der 25.08. fehlt seitdem.
# Eine Uhrzeit sagt nichts darueber, ob etwas getan wurde; der Cursor-Stand tut es.
#
# If a catch-up run itself crosses midnight again, this script fires again on
# its OnSuccess — and so on, until a run finishes within its own UTC day. That
# is the user-requested behavior: "im Anschluss automatisch startet, unabhängig
# von der Uhrzeit".

set -euo pipefail

LOG_TAG="metastats-daily-crawl-catchup"
REPO_DIR="${METASTATS_REPO_DIR:-/opt/metastats-crawler}"

# ---------------------------------------------------------- 1. Arbeitsstand
# selectGapDay ist dieselbe Funktion, die der Crawler unter --resume-gaps
# benutzt: aeltester begonnener, aber nicht abgeschlossener Tag im Fenster.
# Sie liest nur die Cursor-Dateien — kein Schreibzugriff, deshalb vertraeglich
# mit ProtectSystem=strict in dieser Unit.
gap_day=$(/usr/bin/node --input-type=module -e "
  const m = await import('file://${REPO_DIR}/scripts/lib/daily-crawl-cursor.mjs');
  process.stdout.write(m.selectGapDay(new Date()) || '');
" 2>/dev/null || true)

if [ -n "${gap_day:-}" ]; then
  logger -t "$LOG_TAG" "Incomplete day in cursor window ($gap_day) — triggering resume run"
  systemctl start --no-block metastats-daily-crawl-resume.service
  exit 0
fi

# ------------------------------------------------- 2. Mitternachts-Uebertritt
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
  logger -t "$LOG_TAG" "No incomplete day, and previous run finished within its UTC day ($now_day_utc) — no catch-up needed"
  exit 0
fi

logger -t "$LOG_TAG" "Previous run crossed UTC midnight (started $last_start_day_utc, finished $now_day_utc) — triggering catch-up run"
systemctl start --no-block metastats-daily-crawl.service
