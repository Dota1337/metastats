#!/usr/bin/env bash
# Rollt versionierte Unit-Files nach /etc/systemd/system aus.
#
# Warum es dieses Script gibt: deploy-hetzner.yml deployt NUR den Code nach
# /opt/metastats-crawler. Unit-Files stehen zwar im Repo, werden aber von
# nichts automatisch ausgerollt — bis 2026-08-14 war "scp von Hand" der
# dokumentierte Weg, und entsprechend driftete die Box vom Repo weg.
#
# Aufruf (lokal, nicht auf der Box):
#   infra/hetzner/apply-units.sh metastats-health metastats-contracts
#   infra/hetzner/apply-units.sh --all
#   DRY=1 infra/hetzner/apply-units.sh --all      # nur diffen, nichts schreiben
#
# Das Script macht bewusst KEIN restart. `daemon-reload` allein beruehrt
# keinen laufenden Prozess (systemd wendet Sandbox-Optionen beim Start an),
# und genau das ist gewollt: metastats-marketvalue-snapshot und
# metastats-daily-crawl duerfen mitten im Lauf nicht neu gestartet werden.
# Wer eine Aenderung sofort scharf braucht, startet die Unit selbst — nach
# Blick auf `systemctl is-active`.

set -euo pipefail

HOST="${HETZNER_HOST:-37.27.219.140}"
SSH="ssh -o BatchMode=yes root@${HOST}"
DIR="$(cd "$(dirname "$0")" && pwd)"

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <unit> [unit...] | --all" >&2
  exit 2
fi

if [ "$1" = "--all" ]; then
  units=()
  for f in "$DIR"/metastats-*.service "$DIR"/metastats-*.timer; do
    [ -e "$f" ] || continue
    units+=("$(basename "$f")")
  done
else
  units=()
  for u in "$@"; do
    case "$u" in *.service|*.timer) units+=("$u");; *) units+=("$u.service");; esac
  done
fi

changed=0
for u in "${units[@]}"; do
  local_file="$DIR/$u"
  if [ ! -f "$local_file" ]; then
    echo "!! $u: nicht im Repo" >&2
    exit 1
  fi
  remote="$($SSH "cat /etc/systemd/system/$u 2>/dev/null || true")"
  if [ "$(sed 's/\r$//' "$local_file")" = "$(printf '%s\n' "$remote" | sed 's/\r$//')" ]; then
    echo "== $u: identisch"
    continue
  fi
  echo "== $u: weicht ab"
  diff <(printf '%s\n' "$remote" | sed 's/\r$//') <(sed 's/\r$//' "$local_file") || true
  if [ -n "${DRY:-}" ]; then continue; fi
  # Backup mit Zeitstempel, damit der Rollback ohne Repo-Zugriff geht.
  $SSH "test -f /etc/systemd/system/$u && cp -a /etc/systemd/system/$u /root/unit-backups/$u.\$(date +%Y%m%d-%H%M%S) || true" \
    || $SSH "mkdir -p /root/unit-backups && test -f /etc/systemd/system/$u && cp -a /etc/systemd/system/$u /root/unit-backups/$u.\$(date +%Y%m%d-%H%M%S) || true"
  sed 's/\r$//' "$local_file" | $SSH "cat > /etc/systemd/system/$u"
  changed=$((changed + 1))
done

if [ "$changed" -gt 0 ]; then
  $SSH 'systemctl daemon-reload'
  echo "-- daemon-reload ausgefuehrt ($changed Unit(s) geschrieben)"
  for u in "${units[@]}"; do
    $SSH "systemd-analyze verify /etc/systemd/system/$u" || echo "!! $u: verify meldet etwas (siehe oben)"
  done
else
  echo "-- nichts geaendert, kein daemon-reload noetig"
fi
