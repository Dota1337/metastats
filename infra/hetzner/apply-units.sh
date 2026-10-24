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

# Hilfsskripte, die eine Unit per ExecStart aus /usr/local/bin startet, liegen
# ebenfalls im Repo (infra/hetzner/metastats-*.sh) und wurden bis 24.10.2026
# nicht mitgeschrieben — Box und Repo stimmten nur zufaellig ueberein
# (Sicherheitsdurchsicht, unausgerollte-hilfsskripte). Jetzt: vergleichen,
# Sicherung, Syntaxpruefung, dann ATOMAR per mv ersetzen. Ein `cat >` auf die
# laufende Datei wuerde ein Skript zerschiessen, das bash gerade ausfuehrt.
helpers_changed=0
apply_helpers() {
  local unit_file="$1" h name local_h remote_sum local_sum
  for h in $(sed 's/\r$//' "$unit_file" | grep -E '^Exec' | grep -oE '/usr/local/bin/metastats-[A-Za-z0-9._-]+\.sh' | sort -u); do
    name="$(basename "$h")"
    local_h="$DIR/$name"
    if [ ! -f "$local_h" ]; then
      echo "!! $name: von $(basename "$unit_file") gestartet, aber nicht im Repo" >&2
      continue
    fi
    local_sum="$(sed 's/\r$//' "$local_h" | sha1sum | cut -d' ' -f1)"
    remote_sum="$($SSH "sha1sum $h 2>/dev/null | cut -d' ' -f1" || true)"
    if [ "$local_sum" = "$remote_sum" ]; then
      echo "== $name: identisch"
      continue
    fi
    echo "== $name: weicht ab"
    diff <($SSH "cat $h 2>/dev/null || true") <(sed 's/\r$//' "$local_h") || true
    if [ -n "${DRY:-}" ]; then continue; fi
    $SSH "mkdir -p /root/unit-backups && { test -f $h && cp -a $h /root/unit-backups/$name.\$(date +%Y%m%d-%H%M%S) || true; }"
    sed 's/\r$//' "$local_h" | $SSH "set -e; umask 022; t=/usr/local/bin/.$name.new; cat > \$t; bash -n \$t; chmod 0755 \$t; mv -f \$t $h"
    helpers_changed=$((helpers_changed + 1))
  done
}

changed=0
for u in "${units[@]}"; do
  local_file="$DIR/$u"
  if [ ! -f "$local_file" ]; then
    echo "!! $u: nicht im Repo" >&2
    exit 1
  fi
  # Maskierte Units sind Symlinks auf /dev/null. Ein `cat >` darauf schreibt
  # ins Nichts, die Datei sieht danach weiter leer aus — das Script wuerde also
  # bei jedem Lauf Drift melden und nichts erreichen. metastats-crawler.timer
  # ist genau dieser Fall (stillgelegt 2026-08-02).
  if $SSH "test -L /etc/systemd/system/$u && [ \"\$(readlink -f /etc/systemd/system/$u)\" = /dev/null ]"; then
    echo "== $u: maskiert, uebersprungen"
    continue
  fi
  # Vor dem Unit-Vergleich: auch bei identischer Unit kann das Skript abweichen.
  apply_helpers "$local_file"
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
if [ "$helpers_changed" -gt 0 ]; then
  echo "-- $helpers_changed Hilfsskript(e) ersetzt (Sicherung unter /root/unit-backups/, greift beim naechsten Start)"
fi
