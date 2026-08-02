#!/bin/bash
# metastats-marketvalue-watchdog.sh
#
# Per-Region-Sentinel für die Marktwert-Daily-Snapshot-Pipeline. Feuert
# 18:00 UTC (siehe metastats-marketvalue-watchdog.timer). Aufgabe:
#
#   1. Skip wenn ein anderer relevanter Service noch läuft (Race-Schutz)
#   2. Per-Region MAX(snapshot_date) prüfen
#   3. Wenn alle 15 aktiven Regionen heutigen Snapshot haben → No-Op
#   4. Sonst: triggert metastats-marketvalue-snapshot.service (läuft self-aware
#      über alle Regionen ohne heutigen Snapshot — kein Region-Filter nötig)
#
# Multi-Review-Verdict (perf-critic 2026-06-19): globaler MAX-Check würde
# Single-Region-Outages (z.B. kr-Riot-Maintenance) verstecken. Per-Region-
# Logik fängt das ab.

set -euo pipefail

LOG_PREFIX="[mv-watchdog]"
ACTIVE_REGIONS=(euw1 eun1 tr1 ru me1 na1 br1 la1 la2 kr jp1 oc1 sg2 tw2 vn2)

# Skip wenn ein anderer Service mit Riot-Key-Share noch läuft.
# `systemctl is-active` returnt Exit 0 für "active" und Exit 3 für jedes
# andere (activating/inactive/failed). `|| true` rettet den Exit, damit
# der echte Status-String aus stdout in $state landet — sonst würde
# "activating" durch ein altes `|| echo inactive` überschrieben (Bug
# erkannt 2026-06-20).
for svc in metastats-marketvalue-snapshot \
           metastats-crawler \
           metastats-daily-crawl \
           metastats-daily-crawl-resume \
           metastats-tft-pro-fullsync; do
  state=$(systemctl is-active "${svc}.service" 2>/dev/null) || true
  if [[ "$state" == "active" || "$state" == "activating" ]]; then
    echo "${LOG_PREFIX} ${svc}.service ist ${state} — skip"
    exit 0
  fi
done

# DB-Reads brauchen DATABASE_URL — kommt aus dem geteilten env-File.
ENV_FILE=/etc/metastats-crawler/env
if [[ ! -f "$ENV_FILE" ]]; then
  echo "${LOG_PREFIX} ${ENV_FILE} fehlt — abort" >&2
  exit 2
fi
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "${LOG_PREFIX} DATABASE_URL nicht gesetzt — abort" >&2
  exit 2
fi

# Per-Region ABDECKUNGS-Check (vorher: reiner Existenz-Check).
#
# Das alte `not exists (… snapshot_date = current_date)` war blind fuer
# Teilabdeckung: EINE geschriebene Zeile liess eine Region als "heute frisch"
# gelten. Eine zu 5% fertige Region — der Normalfall nach einem Abbruch —
# loeste damit nie eine Nachholung aus. Genau das hat mitgetragen, dass die
# Pipeline wochenlang 6-8 statt ~52.000 Snapshots pro Tag schrieb, ohne dass
# der Watchdog anschlug.
#
# Jetzt: heutige Anzahl gegen den besten Tag der letzten 7 Tage. Unter 80%
# gilt die Region als unvollstaendig. Der Referenzwert ist selbstkalibrierend
# (Regionen sind unterschiedlich gross) und braucht keine gepflegte Sollgroesse.
#
# Wichtig fuer die Gueltigkeit: der inkrementelle Umbau (2026-08-02) spart nur
# RIOT-Calls fuer inaktive Spieler — Pass 2 und damit der Snapshot laeuft
# weiterhin fuer ALLE. Die Tagesanzahl bleibt also ~Grundgesamtheit und ist
# weiter als Abdeckungsmass brauchbar.
#
# Ohne Referenz (neue Region, oder 7 Tage ohne jeden Lauf) faellt die Regel auf
# das alte Verhalten zurueck: nur "gar keine Zeile heute" gilt als fehlend.
MISSING=$(psql "$DATABASE_URL" -t -A -c "
  with regions(region) as (values
      ('euw1'),('eun1'),('tr1'),('ru'),('me1'),
      ('na1'),('br1'),('la1'),('la2'),
      ('kr'),('jp1'),
      ('oc1'),('sg2'),('tw2'),('vn2')
  ),
  heute as (
    select region, count(*)::int as n
      from tft_player_marketvalue_snapshots
     where snapshot_date = current_date
     group by region
  ),
  referenz as (
    select region, max(n)::int as n from (
      select region, snapshot_date, count(*)::int as n
        from tft_player_marketvalue_snapshots
       where snapshot_date >= current_date - 7
         and snapshot_date <  current_date
       group by region, snapshot_date
    ) t group by region
  )
  select string_agg(r.region || '(' || coalesce(h.n,0) || '/' || coalesce(ref.n,0) || ')', ',' order by r.region)
    from regions r
    left join heute h   on h.region   = r.region
    left join referenz ref on ref.region = r.region
   where case
           when coalesce(ref.n,0) = 0 then coalesce(h.n,0) = 0
           else coalesce(h.n,0) < ref.n * 0.8
         end;
" 2>/dev/null || echo "")

# Trim whitespace
MISSING=$(echo "$MISSING" | tr -d '[:space:]')

if [[ -z "$MISSING" ]]; then
  echo "${LOG_PREFIX} alle 15 aktiven Regionen haben heutigen Snapshot — No-Op"
  exit 0
fi

# Inflight-Awareness (architect F8 aus Multi-Review 2026-06-25): differenziert
# im Log "Resume-Run" (Region hat bereits Inflight-Rows aus abgebrochenem Lauf)
# vs "Full-Run" (Region startet von 0). KEINE Skip-Logik — beide Fälle triggern
# dasselbe (snapshot-service start), aber Diagnose ist klarer und Memory-Anker
# bei Vorfall-Untersuchung. Tabelle existiert seit Migration 0046.
INFLIGHT_REGIONS=$(psql "$DATABASE_URL" -t -A -c "
  select string_agg(region || ':' || cnt, ',' order by region)
    from (
      select region, count(*)::int as cnt
        from tft_mv_inflight_raw
       where day = current_date
       group by region
    ) t;
" 2>/dev/null || echo "")
INFLIGHT_REGIONS=$(echo "$INFLIGHT_REGIONS" | tr -d '[:space:]')

if [[ -n "$INFLIGHT_REGIONS" ]]; then
  echo "${LOG_PREFIX} inflight-state: ${INFLIGHT_REGIONS} (resume-runs)"
fi

echo "${LOG_PREFIX} fehlende Regionen: ${MISSING} — triggere snapshot-service"
systemctl start --no-block metastats-marketvalue-snapshot.service
exit 0
