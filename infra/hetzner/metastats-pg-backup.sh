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
umask 077
DEST=/mnt/HC_Volume_105869432/backups
DATE=$(date -u +%Y%m%d)
RETENTION_DAYS=3
# Retention FIRST so disk space is available for the new backup.
find "$DEST" -name "metastats_*.dump" -type f -mtime "+${RETENTION_DAYS}" -delete || true
# Atomar: erst nach .tmp, nur bei Erfolg umbenennen. Bei Abbruch (ENOSPC,
# pg_dump-Fehler) bleibt kein Torso unter dem echten Namen zurueck.
TMP="$DEST/.metastats_${DATE}.dump.tmp"
trap 'rm -f "$TMP"' EXIT
sudo -u postgres pg_dump -Fc metastats > "$TMP"
mv -f "$TMP" "$DEST/metastats_${DATE}.dump"
trap - EXIT
