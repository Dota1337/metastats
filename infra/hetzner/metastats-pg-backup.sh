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
DEST=/mnt/HC_Volume_105869432/backups
DATE=$(date -u +%Y%m%d)
# 7d retention FIRST so disk space is available for the new backup.
find "$DEST" -name "metastats_*.dump" -type f -mtime +7 -delete || true
sudo -u postgres pg_dump -Fc metastats > "$DEST/metastats_${DATE}.dump"
