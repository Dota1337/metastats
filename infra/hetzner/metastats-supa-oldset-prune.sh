#!/usr/bin/env bash
# Sichert und loescht Zeilen alter Sets aus der SUPABASE-Spielablage
# (public.tft_player_match_cache). Seit 08.11.2026.
#
# Warum: Supabase hielt am 08.11. 120 GB in dieser Tabelle, knapp die Haelfte
# Set <= 17. Gelesen wird dort nur das laufende Set (app/lib/tft-player-cache.ts,
# player-stats ohne ?set=), die Box haelt ohnehin nur das laufende Set
# (metastats-pg-prune.sh). Die Platte von Supabase schrumpft dadurch NICHT
# (laesst sich nicht verkleinern); der Platz wird fuer neue Zeilen
# wiederverwendet und das Wachstum der Platte bleibt monatelang aus.
#
# Ablauf je Abschnitt von STEP_PAGES Datenseiten (alte Zeilen liegen vorne in
# der Datei, kein Index beginnt mit set_number):
#   1. in EINER Transaktion (repeatable read): Zeilen set_number < aktuelles Set
#      per \copy als CSV + zstd ins Archiv der Datenplatte,
#   2. Datei pruefen (zstd -t) und Zeilen zaehlen,
#   3. dieselben Zeilen loeschen; nur wenn Loeschzahl = Dateizeilen → commit,
#      sonst rollback und Abbruch.
# Fortschritt in STATE_FILE (Set + naechste Seite). Wechselt das Set, beginnt
# ein neuer Durchlauf. Laeuft nachts per cron (23:30 UTC), hoert um STOP_UTC auf
# und macht in der naechsten Nacht weiter. Pausiert, wenn Supabase langsam
# antwortet. Fertig = nichts mehr zu tun, der Lauf endet dann sofort.
#
# Notaus: touch /var/lib/metastats/supa-oldset-prune.off
# Test: DB_CONN, TABLE, ARCHIVE_DIR, STATE_DIR, STATE_FILE ueberschreiben (Kopie mit eigenem
# Namen, nie die echte Tabelle).
set -euo pipefail

STATE_DIR=${STATE_DIR:-/var/lib/metastats}
mkdir -p "$STATE_DIR"
[ -e "$STATE_DIR/supa-oldset-prune.off" ] && { echo "$(date -u +%FT%TZ) Notaus gesetzt, Ende"; exit 0; }

exec 9>"$STATE_DIR/supa-oldset-prune.lock"
flock -n 9 || { echo "$(date -u +%FT%TZ) laeuft schon, Ende"; exit 0; }

if [ -z "${DB_CONN:-}" ]; then
  set -a; . /etc/metastats-crawler/env; set +a
  DB_CONN="$SUPABASE_DB_URL"
fi
REPO=${REPO:-/opt/metastats-crawler}
TABLE=${TABLE:-public.tft_player_match_cache}
ARCHIVE_DIR=${ARCHIVE_DIR:-/mnt/HC_Volume_105869432/archiv-tabellen/supabase-match-cache-alt}
STATE_FILE=${STATE_FILE:-$STATE_DIR/supa-oldset-prune.state}
STEP_PAGES=${STEP_PAGES:-10000}
PAUSE_SEC=${PAUSE_SEC:-40}
STOP_UTC=${STOP_UTC:-04:30}
SLOW_MS=${SLOW_MS:-1500}

CUR=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(int(d.get('setNumber') or d['currentSet']['number']))" "$REPO/public/tft-set.json")
[ "$CUR" -ge 18 ] || { echo "Set-Nummer unplausibel: $CUR"; exit 1; }
mkdir -p "$ARCHIVE_DIR"

# Ende heute bzw. morgen um STOP_UTC (Start 23:30 → Ende 04:30 am Folgetag).
deadline=$(date -u -d "today $STOP_UTC" +%s)
[ "$deadline" -gt "$(date -u +%s)" ] || deadline=$(date -u -d "tomorrow $STOP_UTC" +%s)

page=0
if [ -f "$STATE_FILE" ]; then
  read -r st_set st_page st_flag < "$STATE_FILE" || true
  if [ "${st_set:-}" = "$CUR" ]; then
    [ "${st_flag:-}" = "fertig" ] && { echo "$(date -u +%FT%TZ) Set $CUR: Durchlauf fertig, nichts zu tun"; exit 0; }
    page=${st_page:-0}
  fi
fi

psqlq() { psql "$DB_CONN" -X -A -t -v ON_ERROR_STOP=1 "$@"; }
maxpage=$(psqlq -c "select (pg_relation_size('$TABLE') / current_setting('block_size')::int)::bigint")
echo "$(date -u +%FT%TZ) Start: Set < $CUR, Seite $page von $maxpage, Schritt $STEP_PAGES"

total=0
while [ "$page" -lt "$maxpage" ]; do
  [ -e "$STATE_DIR/supa-oldset-prune.off" ] && { echo "Notaus gesetzt"; break; }
  [ "$(date -u +%s)" -lt "$deadline" ] || { echo "$(date -u +%FT%TZ) Zeitfenster vorbei"; break; }

  t0=$(date +%s%N); psqlq -c 'select 1' >/dev/null; ms=$(( ($(date +%s%N) - t0) / 1000000 ))
  if [ "$ms" -gt "$SLOW_MS" ]; then
    echo "$(date -u +%FT%TZ) Supabase antwortet langsam (${ms} ms), 5 min Pause"; sleep 300; continue
  fi

  next=$(( page + STEP_PAGES ))
  f="$ARCHIVE_DIR/set_lt${CUR}_p$(printf '%09d' "$page").csv.zst"
  where="ctid >= '($page,0)'::tid and ctid < '($next,0)'::tid and set_number < $CUR"
  out=$(psql "$DB_CONN" -X -q -A -t -v ON_ERROR_STOP=1 <<SQL
set lock_timeout = '5s';
set statement_timeout = '15min';
begin isolation level repeatable read;
\\copy (select * from $TABLE where $where) to program 'zstd -q -f -o $f' with (format csv, header)
\\set filerows \`zstd -t -q "$f" 2>/dev/null && zstd -dc "$f" | python3 -c 'import csv,sys; csv.field_size_limit(1<<30); r=csv.reader(sys.stdin); next(r,None); print(sum(1 for _ in r))' || echo -1\`
delete from $TABLE where $where;
\\set deleted :ROW_COUNT
select (:filerows >= 0 and :filerows = :deleted) as ok \\gset
\\if :ok
commit;
\\echo ok :deleted
\\else
rollback;
\\echo abweichung datei=:filerows geloescht=:deleted
\\endif
SQL
)
  case "$out" in
    *"ok "*)
      n=${out##*ok }; n=${n%%[!0-9]*}
      [ "${n:-0}" -eq 0 ] && rm -f "$f"
      total=$(( total + ${n:-0} ))
      page=$next
      echo "$CUR $page" > "$STATE_FILE"
      [ "${n:-0}" -gt 0 ] && echo "$(date -u +%FT%TZ) Seiten bis $page: $n Zeilen gesichert + geloescht (gesamt $total)"
      ;;
    *)
      echo "$(date -u +%FT%TZ) FEHLER bei Seite $page: $out — Datei bleibt zur Pruefung: $f"; exit 1
      ;;
  esac
  sleep "$PAUSE_SEC"
done

if [ "$page" -ge "$maxpage" ]; then
  echo "$CUR $page fertig" > "$STATE_FILE"
  echo "$(date -u +%FT%TZ) Set < $CUR: Durchlauf fertig ($total Zeilen in dieser Nacht)"
fi
