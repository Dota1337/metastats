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
echo "$(date -u +%FT%TZ) prune done."
