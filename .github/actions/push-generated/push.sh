#!/usr/bin/env bash
# Erzeugte Dateien committen und auf main pushen — ohne Rebase.
#
# Warum kein `git pull --rebase`: Laeufe mit altem Checkout (z. B. ein vom
# Sammel-Tor angestossener Nachfolger) erzeugen dieselben Dateien wie ein
# zwischenzeitlicher Commit auf main. Der Rebase endet dann im Konflikt
# (Wochen-Sammlung EUW, 07.10.2026). Hier wird stattdessen auf den aktuellen
# Stand von main zurueckgesetzt und jede in DIESEM Lauf geaenderte Datei als
# Ganzes darueberkopiert — nie ein Mischstand aus zwei Generationen.
#
# Umgebung:
#   FILES    Pfade, durch Leerzeichen getrennt (Pflicht)
#   MESSAGE  Commit-Nachricht (Pflicht)
#   PROTECT  Pfade, die Handarbeit auf main nicht ueberschreiben duerfen: hat
#            seit dem Checkout jemand ausser dem Bot die Datei geaendert, bleibt
#            die Fassung von main stehen (Warnung im Lauf).
#   ATTEMPTS Push-Versuche (Standard 3)
#
# Exit 0 = gepusht oder nichts zu tun, Exit 1 = alle Versuche gescheitert.

set -uo pipefail

: "${FILES:?FILES fehlt}"
: "${MESSAGE:?MESSAGE fehlt}"
ATTEMPTS="${ATTEMPTS:-3}"
BOT_NAME="github-actions[bot]"
BOT_EMAIL="github-actions[bot]@users.noreply.github.com"

read -r -a files <<< "$FILES"
read -r -a protect <<< "${PROTECT:-}"

git config user.name "$BOT_NAME"
git config user.email "$BOT_EMAIL"

base=$(git rev-parse HEAD) || exit 1
backup=$(mktemp -d)
trap 'rm -rf "$backup"' EXIT

# Einmal vor der Schleife: welche Dateien hat dieser Lauf geaendert?
copied=()
deleted=()
while IFS= read -r -d '' entry; do
  status=${entry:0:2}
  path=${entry:3}
  if [[ "$status" == *D* ]]; then
    deleted+=("$path")
  else
    mkdir -p "$backup/$(dirname "$path")"
    cp -p -- "$path" "$backup/$path" || exit 1
    copied+=("$path")
  fi
done < <(git status --porcelain=v1 -z --untracked-files=all -- "${files[@]}")

if [ ${#copied[@]} -eq 0 ] && [ ${#deleted[@]} -eq 0 ]; then
  echo "Keine Datenaenderung"
  exit 0
fi
echo "Geaendert: ${copied[*]:-} ${deleted[*]:+(geloescht: ${deleted[*]})}"

is_protected() {
  local p
  for p in "${protect[@]}"; do [ "$p" = "$1" ] && return 0; done
  return 1
}

# Hat seit dem Checkout jemand ausser dem Bot die Datei auf main geaendert?
human_changed() {
  git diff --quiet "$base" FETCH_HEAD -- "$1" && return 1
  git log --format='%ae' "$base..FETCH_HEAD" -- "$1" | grep -qvxF "$BOT_EMAIL"
}

for attempt in $(seq 1 "$ATTEMPTS"); do
  if ! git fetch -q origin main; then
    echo "Versuch $attempt: fetch gescheitert"
    sleep 5
    continue
  fi
  git reset -q --hard FETCH_HEAD || exit 1

  for path in "${copied[@]}"; do
    if is_protected "$path" && human_changed "$path"; then
      echo "::warning::$path wurde auf main von Hand geaendert — Fassung dieses Laufs verworfen."
      continue
    fi
    mkdir -p "$(dirname "$path")"
    cp -p -- "$backup/$path" "$path"
    git add -- "$path"
  done
  for path in "${deleted[@]}"; do
    git rm -q --ignore-unmatch -- "$path"
  done

  if git diff --cached --quiet; then
    echo "Stand von main enthaelt bereits alle Aenderungen — nichts zu committen"
    exit 0
  fi

  if git commit -q -m "$MESSAGE" && git push -q origin HEAD:main; then
    echo "Gepusht: $(git rev-parse --short HEAD)"
    exit 0
  fi
  echo "Versuch $attempt von $ATTEMPTS gescheitert"
  sleep 5
done

echo "::error::Push nach $ATTEMPTS Versuchen gescheitert"
exit 1
