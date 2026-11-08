#!/usr/bin/env bash
set -euo pipefail
# Daily pg_dump backup auf das Hetzner-Volume.
#
# Lebt auf der Box in /usr/local/bin/metastats-pg-backup.sh, getriggert via
# Cron oder systemd-Timer (siehe Memory reference_tft_pipeline_ops.md).
#
# WICHTIG (Memory reference_tft_pipeline_ops.md Mai 2026 + Vorfall 2026-06-25):
# Die Reihenfolge `find` VOR `pg_dump` ist KRITISCH. Frühere Variante hatte
# `pg_dump` zuerst — bei vollem Disk failt pg_dump mit ENOSPC, `set -e` Exit,
# `find`-Cleanup wird NIE erreicht → Disk akkumuliert Backups bis 100% voll
# → Bootstrap-Crawler kann nicht mehr schreiben (No space left on device auf
# tft_player_match_cache Tablespace). Beim manuellen Disk-Cleanup 2026-06-25
# wurden 4 alte Backups gelöscht und der Bug strukturell gefixt.
#
# `|| true` auf find-Zeile fängt Edge-Cases ab (z.B. broken symlinks) ohne
# pg_dump zu blockieren.
#
# Vorfall 2026-08-01: Volume zu 100% voll (pg 39G + backups 18G auf 59G).
# Zwei Ursachen, beide hier gefixt:
#   1) 7d Retention x ~2,1G/Dump = 14-18G ist auf diesem Volume nicht mehr
#      tragbar, seit tft_player_match_cache auf 38G gewachsen ist. -> 3d.
#   2) `pg_dump > file` liess bei ENOSPC einen abgebrochenen Torso liegen,
#      der 7 Tage lang wie ein gueltiges Backup aussah. -> tmp+rename, damit
#      nur vollstaendige Dumps den finalen Namen bekommen.
# Sicherheits-Haertung 2026-08-14: das Verzeichnis liegt auf 700, die Dumps
# auf 600. Ohne umask legt die Redirection unten neue Dumps wieder mit 644 an
# und der Riegel waere nach einem Lauf still wieder offen.
#
# 08.11.2026: Aufbewahrung nach ANZAHL statt Alter. Die alte Altersregel
# (aelter als 3 volle Tage, Aufraeumen um 04:30 vor dem Dump) erwischte den 4 Tage alten
# Dump nie, es lagen 5 statt 3 (40 GB). Jetzt bleiben vor dem Dump die
# KEEP_NEWEST neuesten Tagesdateien, die von heute zaehlt nicht mit (ein
# zweiter Lauf am selben Tag behaelt so trotzdem 3). Nach dem Dump: 3.
# Scheitert der Dump, bleiben die 2 neuesten, egal wie alt (Vorsorge 03.11.).
# Ist die neueste Tagesdatei kleiner als MIN_BYTES (= minBytes im Vertrag
# box/datenbank-sicherung), wird nichts geloescht: ein kaputter Dump soll
# keine gute Kopie verdraengen.
# Gezaehlt und geloescht werden NUR Dateien `metastats_JJJJMMTT.dump` direkt
# in $DEST. Handsicherungen dort unter einem anderen Namen ablegen, sonst
# verdraengen sie einen Tagesdump.
umask 077
DEST=/mnt/HC_Volume_105869432/backups
DATE=$(date -u +%Y%m%d)
KEEP_NEWEST=2
MIN_BYTES=300000000
# Zwei Laeufe gleichzeitig (Cron + Handstart laut Vertrags-Notiz) schrieben in
# dieselbe Zwischendatei. Der zweite endet sofort. Fehlt $DEST (Volume nicht
# eingehaengt), scheitert schon das Oeffnen, und der Lauf endet mit Fehler.
exec 9>"$DEST/.backup.lock"
if ! flock -n 9; then
  echo "Sicherung laeuft bereits, dieser Lauf endet" >&2
  exit 0
fi
# Retention FIRST so disk space is available for the new backup.
# Scheitert hier etwas, wird nichts geloescht und der Dump laeuft trotzdem.
# Reste abgebrochener Laeufe (nur nach hartem Abbruch, sonst raeumt der trap):
# ein laufender Dump schreibt staendig, ist also nie 12 h alt.
find "$DEST" -maxdepth 1 -type f -name '.metastats_*.dump.tmp' -mmin +720 -delete || true
find "$DEST" -maxdepth 1 -regextype posix-extended -type f -regex '.*/metastats_[0-9]{8}\.dump' \
     ! -name "metastats_${DATE}.dump" -printf '%T@\t%s\t%p\n' \
  | sort -rn \
  | awk -F'\t' -v keep="$KEEP_NEWEST" -v min="$MIN_BYTES" \
      'NR == 1 && $2 + 0 < min + 0 { exit } NR > keep { print $3 }' \
  | while IFS= read -r old; do
      rm -f -- "$old"
    done || true
# Atomar: erst nach .tmp, nur bei Erfolg umbenennen. Bei Abbruch (ENOSPC,
# pg_dump-Fehler) bleibt kein Torso unter dem echten Namen zurueck.
TMP="$DEST/.metastats_${DATE}.dump.tmp"
trap 'rm -f "$TMP"' EXIT
sudo -u postgres pg_dump -Fc metastats > "$TMP"
mv -f "$TMP" "$DEST/metastats_${DATE}.dump"
trap - EXIT
