#!/usr/bin/env bash
# Runs ON the Hetzner crawler box — fed via stdin by the deploy-hetzner.yml
# workflow (`ssh root@box 'bash -s' < this-file`). Syncs /opt/metastats-crawler
# to origin/main. The box is a pure CONSUMER of main; it never pushes. Crawled
# data flows box -> Supabase separately and is untouched here.
#
# Two sync modes (the box crawls almost 24/7 — daily all-ranks ~13h + the
# chained marketvalue crawl — so an "only deploy when idle" rule starves the
# box and it silently drifts dozens of commits behind, e.g. d22f441 stuck for
# days in May 2026):
#   * crawl running  -> CODE-ONLY sync: `git reset --hard origin/main` only.
#                       Safe because an in-flight crawl already has its scripts
#                       loaded in memory; the updated files take effect on the
#                       NEXT scheduled run. We deliberately skip `git clean`,
#                       `npm ci` and timer restarts — all of which can disrupt
#                       a running crawl (wiping node_modules / untracked outputs).
#   * idle           -> FULL sync: reset (+ clean fallback) + npm ci on lock
#                       change + timer re-arm, as before.
#
# Systemd unit files (infra/hetzner/*.timer|*.service) are NOT applied here —
# they are sensitive and change rarely. Apply unit changes manually:
#   scp infra/hetzner/<unit> root@<host>:/etc/systemd/system/ && systemctl daemon-reload
set -euo pipefail

cd /opt/metastats-crawler

# http.version=HTTP/1.1 ist kein Aberglaube, sondern gemessen (02.09.2026):
# ueber HTTP/2 schlug `git fetch` auf der Box in 4 von 5 Versuchen mit
#   fatal: could not read Username for 'https://github.com'
#   fatal: expected flush after ref listing
# fehl — die Ref-Liste kam abgeschnitten an, git deutete das als
# Auth-Aufforderung und wollte nach einem Passwort fragen, das es im
# nicht-interaktiven Deploy nicht gibt. Das Repo ist oeffentlich, ein
# Zugangsproblem lag also nie vor. Mit HTTP/1.1: 3 von 3 erfolgreich.
# Vier Deploys hintereinander sind daran gescheitert, ohne dass die Box gemeldet
# haette, dass sie auf altem Code sitzt.
# Der Retry bleibt trotzdem: ein einzelner Netzwerkhaenger soll den Deploy nicht
# kosten.
for attempt in 1 2 3; do
  git -c http.version=HTTP/1.1 fetch origin --quiet && break
  [ "$attempt" = 3 ] && { echo "git fetch nach 3 Versuchen fehlgeschlagen"; exit 1; }
  sleep 5
done

# Crawls are Type=oneshot, so while running they sit in state "activating"
# (NOT "active"). `is-active --quiet` returns false for "activating", so match
# every in-flight state explicitly.
crawl_running() {
  local u state
  # Liste konsistent mit dem Watchdog-Skip-Check
  # (infra/hetzner/metastats-marketvalue-watchdog.sh).
  # Logic-Flow-Critic 2026-06-20: tft-pro-fullsync war asymmetrisch — Watchdog
  # checkte ihn, deploy nicht. Jetzt synchron.
  for u in metastats-crawler.service \
           metastats-daily-crawl.service \
           metastats-marketvalue-snapshot.service \
           metastats-tft-pro-fullsync.service; do
    state=$(systemctl is-active "$u" 2>/dev/null || true)
    if [ "$state" = active ] || [ "$state" = activating ] || [ "$state" = reloading ]; then
      echo "$u is $state"
      return 0
    fi
  done
  return 1
}

before=$(sha1sum package-lock.json 2>/dev/null | cut -d' ' -f1 || true)

# Hard-sync tracked files to main. Plain reset first; if an untracked file would
# be clobbered by a now-tracked file, stash the blockers (preserved, NOT
# deleted — no `git clean`) and retry. Safe to run mid-crawl.
sync_code() {
  git reset --hard origin/main 2>/dev/null || {
    echo "untracked collision — stashing blockers (recoverable via 'git stash list')"
    git stash push -u --quiet -m "auto pre-reset $(date -u +%FT%TZ)" || true
    git reset --hard origin/main
  }
}

if active=$(crawl_running); then
  # CODE-ONLY: update files for the next run; leave the live crawl, deps and
  # timers untouched.
  echo "crawl running ($active) — code-only sync (no clean / npm ci / restart)"
  sync_code
  after=$(sha1sum package-lock.json 2>/dev/null | cut -d' ' -f1 || true)
  if [ "$before" != "$after" ]; then
    echo "WARN: package-lock.json changed — npm ci deferred (unsafe mid-crawl). Re-run via workflow_dispatch once idle."
  fi
  # Der Long-Running-API-Service ist KEIN Crawl: er haelt keinen Cursor und
  # keine Inflight-Arbeit, ein Neustart kostet Millisekunden. Er muss aber
  # neu starten, weil CURRENT_SET und der Bundle-Cache Modul-Level sind —
  # ohne Restart laeuft der alte Prozess mit dem alten Set weiter, waehrend
  # auf der Platte schon die neuen Dateien liegen. try-restart tut nichts,
  # wenn der Service nicht laeuft.
  systemctl try-restart metastats-refresh-api.service || true
  echo "Code-synced $(git rev-parse --short HEAD) on $(hostname) at $(date -u +%FT%TZ) (crawl active; deps/timers not touched, refresh-api restarted)"
  exit 0
fi

# IDLE: full sync. The clean fallback clears stray untracked files only when
# they would block the reset.
git reset --hard origin/main || { git clean -fd; git reset --hard origin/main; }
after=$(sha1sum package-lock.json 2>/dev/null | cut -d' ' -f1 || true)

if [ "$before" != "$after" ]; then
  # Full install (NOT --omit=dev): the crawler's runtime deps `pg` and
  # `libsodium-wrappers` currently live in devDependencies, so omitting dev
  # would strip them and break every script that imports pg.
  echo "package-lock.json changed — running npm ci"
  npm ci
fi

# Re-arm the timers so the next scheduled run uses the new code. Restarting a
# .timer never interrupts an in-flight oneshot .service.
#
# metastats-crawler.timer is intentionally EXCLUDED: the marketvalue crawl runs
# via OnSuccess= chained to the daily crawl, not its own 04:00 timer. That timer
# is Persistent=true with a past OnCalendar, so `systemctl restart` would re-arm
# it and fire a spurious standalone marketvalue crawl on every deploy — which can
# then run concurrently with the chained one and double the Riot load. The timer
# is masked on the box; keep it out of this list.
systemctl restart metastats-daily-crawl.timer metastats-companion-backfill.timer metastats-position-aggregator.timer

# Siehe Begruendung im Code-only-Zweig: der API-Service friert Set und
# Klassifikations-Bundle beim Start ein und muss den Deploy mitbekommen.
systemctl try-restart metastats-refresh-api.service || true

echo "Deployed $(git rev-parse --short HEAD) on $(hostname) at $(date -u +%FT%TZ) (full sync)"
