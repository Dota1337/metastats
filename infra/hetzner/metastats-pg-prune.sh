#!/usr/bin/env bash
# Prune non-current-set rows from tft_player_match_cache so the Hetzner disk
# doesn't fill with dead data. All app/marketvalue reads filter to the current
# set, so anything below the highest set_number is never read.
#
# Set-agnostic: the keeper is max(set_number), so when a new set drops the
# previous set automatically becomes prunable on the next run — no edits needed.
# Batched delete keeps WAL bounded on the small disk; plain VACUUM (no rewrite,
# no extra disk) returns the freed space for reuse inside the table.
#
# NOTE: this only reclaims OLD-set data. It does NOT bound current-set growth
# from cold-fills (kr/vn2) — that's governed by --max-cold-ids in the collector.
#
# Installed at /usr/local/bin/metastats-pg-prune.sh, run weekly via cron.
set -euo pipefail

ENV_FILE=/etc/metastats-crawler/env
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi
if [ -z "${DATABASE_URL:-}" ]; then echo "DATABASE_URL not set in $ENV_FILE"; exit 1; fi

psqlc() { psql "$DATABASE_URL" -At -c "$1"; }

CUR=$(psqlc "select max(set_number) from tft_player_match_cache;")
if ! [[ "$CUR" =~ ^[0-9]+$ ]]; then echo "could not determine current set ('$CUR')"; exit 1; fi

# Guard: refuse to prune if the current set has suspiciously few rows (e.g.
# mid set-transition or a broken crawl) — never nuke the table to near-empty.
CURROWS=$(psqlc "select count(*) from tft_player_match_cache where set_number = $CUR;")
if [ "$CURROWS" -lt 1000 ]; then
  echo "$(date -u +%FT%TZ) current set $CUR has only $CURROWS rows — guard tripped, skipping prune"
  exit 0
fi

OLD=$(psqlc "select count(*) from tft_player_match_cache where set_number is distinct from $CUR;")
echo "$(date -u +%FT%TZ) prune: keep set=$CUR ($CURROWS rows), prunable=$OLD"

if [ "$OLD" -gt 0 ]; then
  while true; do
    N=$(psqlc "with d as (delete from tft_player_match_cache where ctid in (select ctid from tft_player_match_cache where set_number is distinct from $CUR limit 50000) returning 1) select count(*) from d;")
    echo "  deleted batch: $N"
    [ "$N" -eq 0 ] && break
  done
  echo "  vacuum..."
  psqlc "vacuum (analyze) tft_player_match_cache;" >/dev/null
fi

# ──────────────────────────────────────────────────────────────────────────
# Backup-Tables aus dem Marktwert-Daily-Driver pruning (A3, 2026-06-20).
#
# `scripts/daily-marketvalue-snapshot.mjs` schreibt vor jedem scharfen Region-
# Lauf ein Backup-Table-Snapshot `tft_pmvs_backup_YYYYMMDD_<region>` (siehe
# reference_marketvalue_daily_pipeline.md). Ohne Pruning sammeln sich pro
# Region täglich neue Backup-Tables → DB-Bloat + Catalog-Druck.
#
# Multi-Review-Verdict (architect + data-skeptic + logic-flow-critic):
#   • Window 21 Tage (data-skeptic) — Aggregator-Bugs werden oft erst nach
#     2-3 Patch-Cycles sichtbar; 7d hätte Backups gepruned bevor Bugs auffallen.
#   • Regex-anchored Pattern (logic-flow): `LIKE 'tft_pmvs_backup_%'` würde
#     rogue Tables treffen.
#   • 2-Tage-TODAY-Guard (logic-flow): pg-prune läuft Sonntags 03:00 UTC während
#     daily-crawl bei 00:00 UTC schon Backups produziert hat — niemals
#     heutige/gestrige Backups droppen.
#   • Advisory-Lock (logic-flow): falls Driver jemals selber prunet, wir wollen
#     keine Race auf DROP TABLE.
# ──────────────────────────────────────────────────────────────────────────

PRUNE_AFTER_DAYS=21
PRUNE_TODAY_GUARD_DAYS=2
ADVISORY_LOCK_KEY=68740620   # arbitrary 32-bit int — eindeutig für pg-prune-backup

echo "$(date -u +%FT%TZ) backup-prune: window=${PRUNE_AFTER_DAYS}d, guard=${PRUNE_TODAY_GUARD_DAYS}d"

# pg_try_advisory_lock returnt true wenn der Lock geholt werden konnte. Bei
# false: ein anderer Prozess prunet gerade — wir skippen ohne zu warten.
LOCK_OK=$(psqlc "select pg_try_advisory_lock($ADVISORY_LOCK_KEY);")
if [ "$LOCK_OK" != "t" ]; then
  echo "  advisory lock held by another process — skipping backup-prune"
else
  # Tabellen-Liste holen: Regex-anchored auf das Driver-Naming-Pattern.
  # Format: tft_pmvs_backup_YYYYMMDD_<region> (region kann Ziffern enthalten,
  # daher [a-z0-9]+).
  CANDIDATES=$(psqlc "
    select tablename
    from pg_tables
    where schemaname = 'public'
      and tablename ~ '^tft_pmvs_backup_[0-9]{8}_[a-z0-9]+$'
    order by tablename;
  ")

  CUT_OFF=$(date -u -d "$PRUNE_AFTER_DAYS days ago" +%Y%m%d)
  TODAY_GUARD=$(date -u -d "$PRUNE_TODAY_GUARD_DAYS days ago" +%Y%m%d)
  echo "  cutoff=$CUT_OFF (drop wenn datum davor) — keep wenn datum >= $TODAY_GUARD (today-guard)"

  DROPPED=0
  KEPT=0
  for tbl in $CANDIDATES; do
    # Date-Component aus dem Namen extrahieren: tft_pmvs_backup_YYYYMMDD_xxx
    DATE_PART=$(echo "$tbl" | sed -E 's/^tft_pmvs_backup_([0-9]{8})_.+$/\1/')
    # Safety: nur droppen wenn Date strikt vor CUT_OFF UND strikt vor TODAY_GUARD.
    # Letzteres garantiert dass selbst bei einem versehentlichen CUT_OFF=heute
    # die jüngsten Backups nicht erwischt werden.
    if [ "$DATE_PART" -lt "$CUT_OFF" ] && [ "$DATE_PART" -lt "$TODAY_GUARD" ]; then
      psqlc "drop table if exists \"$tbl\";" >/dev/null
      echo "  dropped: $tbl (date=$DATE_PART)"
      DROPPED=$((DROPPED + 1))
    else
      KEPT=$((KEPT + 1))
    fi
  done
  echo "  backup-prune done: dropped=$DROPPED, kept=$KEPT"

  psqlc "select pg_advisory_unlock($ADVISORY_LOCK_KEY);" >/dev/null
fi

echo "$(date -u +%FT%TZ) prune done."
