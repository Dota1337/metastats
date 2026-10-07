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
#   * idle           -> FULL sync: reset (+ clean fallback) + npm ci when the
#                       installed deps differ from package-lock.json + timer
#                       re-arm, as before.
#
# Third mode, NOT used by the workflow:
#   * --deps-only    -> no git at all; only `npm ci` if node_modules does not
#                       match package-lock.json AND no crawl is running. Called
#                       daily by metastats-deps-catchup.timer from the copy on
#                       disk (/opt/metastats-crawler/infra/hetzner/remote-deploy.sh).
#
# Warum der Vergleich gegen den INSTALLIERTEN Stand (2026-10): bis dahin
# verglich das Script package-lock.json vor und nach dem Reset im selben Lauf.
# Lief dabei ein Crawl, wurde npm ci nur aufgeschoben — und der naechste Deploy
# sah keinen Unterschied mehr, weil der Lockfile schon auf der Platte lag. Die
# Box installierte so nie wieder: node_modules vom 14.08., next 16.2.6 statt
# 16.3.8, undici 6.27.0 statt 6.29.0. Jetzt schreibt jedes erfolgreiche npm ci
# den Hash des installierten Lockfiles nach node_modules/.metastats-lock-sha1,
# und verglichen wird gegen diesen Stempel. Er liegt bewusst IN node_modules:
# npm ci loescht den Ordner zuerst, ein abgebrochener Lauf hinterlaesst also
# keinen Stempel und wird beim naechsten Mal wiederholt.
#
# Systemd unit files (infra/hetzner/*.timer|*.service) are NOT applied here —
# they are sensitive and change rarely. Roll them out with
# infra/hetzner/apply-units.sh (writes + daemon-reload, never enables/starts).
set -euo pipefail

cd /opt/metastats-crawler

DEPS_ONLY=0
[ "${1:-}" = "--deps-only" ] && DEPS_ONLY=1

# Deploy und Nachhol-Timer duerfen nie gleichzeitig laufen: ein git reset
# mitten in npm ci installierte einen halben Stand. Der Deploy wartet (der
# Nachhol-Lauf ist nach Minuten fertig), der Nachhol-Lauf weicht aus — ein
# laufender Deploy erledigt npm ci ohnehin selbst, sobald die Box frei ist.
exec 9>/run/lock/metastats-remote-deploy.lock
if [ "$DEPS_ONLY" = 1 ]; then
  flock -n 9 || { echo "Deploy laeuft gerade — Nachhol-Lauf uebersprungen"; exit 0; }
else
  flock -w 600 9 || { echo "Nachhol-npm-ci laeuft seit >10 min — Deploy abgebrochen, bitte erneut ausloesen"; exit 1; }
fi

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
# Der Nachhol-Lauf (--deps-only) fasst git nicht an: er installiert genau den
# Stand, der schon auf der Platte liegt.
if [ "$DEPS_ONLY" = 0 ]; then
  for attempt in 1 2 3; do
    git -c http.version=HTTP/1.1 fetch origin --quiet && break
    [ "$attempt" = 3 ] && { echo "git fetch nach 3 Versuchen fehlgeschlagen"; exit 1; }
    sleep 5
  done
fi

# Crawls are Type=oneshot, so while running they sit in state "activating"
# (NOT "active"). `is-active --quiet` returns false for "activating", so match
# every in-flight state explicitly.
crawl_running() {
  local u state
  # Liste konsistent mit dem Watchdog-Skip-Check
  # (infra/hetzner/metastats-marketvalue-watchdog.sh).
  # Logic-Flow-Critic 2026-06-20: tft-pro-fullsync war asymmetrisch — Watchdog
  # checkte ihn, deploy nicht. Jetzt synchron.
  # resume + catchup nur hier (2026-10): resume faehrt denselben Tagestreiber,
  # catchup startet resume. Der Treiber startet am Ende die Patch-Umbenennung als
  # Kind — ein Reset mitten darin tauschte deren Code unter dem laufenden Lauf aus.
  for u in metastats-crawler.service \
           metastats-daily-crawl.service \
           metastats-daily-crawl-resume.service \
           metastats-daily-crawl-catchup.service \
           metastats-marketvalue-snapshot.service \
           metastats-tft-pro-fullsync.service \
           metastats-snapshot-publisher.service; do
    state=$(systemctl is-active "$u" 2>/dev/null || true)
    if [ "$state" = active ] || [ "$state" = activating ] || [ "$state" = reloading ]; then
      echo "$u is $state"
      return 0
    fi
  done
  return 1
}

# Installierter Stand: Stempel, den nur ein erfolgreiches npm ci schreibt
# (Begruendung im Kopf). Fehlt er, gilt die Installation als abweichend — so
# holt die Box beim ersten Lauf nach dieser Umstellung den Rueckstand nach.
DEPS_STAMP=node_modules/.metastats-lock-sha1
lock_hash() { sha1sum package-lock.json 2>/dev/null | cut -d' ' -f1 || true; }
deps_outdated() {
  local want
  want=$(lock_hash)
  [ -n "$want" ] || return 1   # kein Lockfile -> nichts, wogegen npm ci liefe
  [ "$(cat "$DEPS_STAMP" 2>/dev/null || true)" != "$want" ]
}
# Full install (NOT --omit=dev): the crawler's runtime deps `pg` and
# `libsodium-wrappers` currently live in devDependencies, so omitting dev
# would strip them and break every script that imports pg.
# Hash VOR npm ci nehmen: das ist der Lockfile, der installiert wird. Der
# Stempel entsteht per mv, damit ein Abbruch nie einen halben Wert hinterlaesst.
install_deps() {
  local h
  h=$(lock_hash)
  npm ci
  printf '%s\n' "$h" > "$DEPS_STAMP.tmp"
  mv -f "$DEPS_STAMP.tmp" "$DEPS_STAMP"
}

if [ "$DEPS_ONLY" = 1 ]; then
  if ! deps_outdated; then
    echo "node_modules passt zu package-lock.json — nichts nachzuholen"
    exit 0
  fi
  # Dieselbe Regel wie im Deploy: npm ci loescht node_modules, ein laufender
  # Crawl stuerzte beim naechsten Import ab. Dann eben morgen.
  if active=$(crawl_running); then
    echo "node_modules weicht ab, aber $active — npm ci bleibt aufgeschoben"
    exit 0
  fi
  echo "node_modules weicht von package-lock.json ab — npm ci wird nachgeholt"
  install_deps
  # Wie im Full-Sync: die Dauerdienste haben die alten Pakete im Speicher.
  systemctl try-restart metastats-refresh-api.service || true
  systemctl try-restart metastats-explorer-api.service || true
  echo "npm ci nachgeholt fuer $(git rev-parse --short HEAD) on $(hostname) at $(date -u +%FT%TZ)"
  exit 0
fi

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
  if deps_outdated; then
    echo "WARN: node_modules weicht von package-lock.json ab — npm ci aufgeschoben (unsafe mid-crawl). Nachgeholt durch metastats-deps-catchup.timer (05:20 UTC) oder den naechsten Deploy im Leerlauf."
  fi
  # Der Long-Running-API-Service ist KEIN Crawl: er haelt keinen Cursor und
  # keine Inflight-Arbeit, ein Neustart kostet Millisekunden. Er muss aber
  # neu starten, weil CURRENT_SET und der Bundle-Cache Modul-Level sind —
  # ohne Restart laeuft der alte Prozess mit dem alten Set weiter, waehrend
  # auf der Platte schon die neuen Dateien liegen. try-restart tut nichts,
  # wenn der Service nicht laeuft.
  systemctl try-restart metastats-refresh-api.service || true
  # Explorer-Abfragedienst: haelt ebenfalls nur eine Lese-Verbindung, Neustart
  # kostet eine Aufwaerm-Abfrage. Der Build (oneshot, Timer) wird nie angefasst.
  systemctl try-restart metastats-explorer-api.service || true
  echo "Code-synced $(git rev-parse --short HEAD) on $(hostname) at $(date -u +%FT%TZ) (crawl active; deps/timers not touched, refresh-api restarted)"
  exit 0
fi

# IDLE: full sync. The clean fallback clears stray untracked files only when
# they would block the reset.
git reset --hard origin/main || { git clean -fd; git reset --hard origin/main; }

if deps_outdated; then
  echo "node_modules weicht von package-lock.json ab — running npm ci"
  install_deps
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
systemctl try-restart metastats-explorer-api.service || true

echo "Deployed $(git rev-parse --short HEAD) on $(hostname) at $(date -u +%FT%TZ) (full sync)"
