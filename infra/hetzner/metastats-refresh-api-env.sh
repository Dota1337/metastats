#!/bin/bash
# metastats-refresh-api-env.sh
#
# Erzeugt vor jedem Start von metastats-refresh-api dessen eigene Env-Datei:
# nur die Schluessel, die der Dienst liest. Laeuft als ExecStartPre=+ (also als
# root, ohne die Sandbox der Unit), der Dienst selbst darf die gemeinsame Datei
# /etc/metastats-crawler/env danach nicht mehr sehen (InaccessiblePaths).
#
# Warum: refresh-api ist der einzige aus dem Internet erreichbare Dienst der
# Box, die gemeinsame Datei traegt 17 Geheimnisse (Sicherheitsdurchsicht
# 24.10.2026, geteilte-env-datei). Bei jedem Start neu erzeugt, damit ein
# rotierter Schluessel (rotate-refresh-token, refresh-supabase-key) mit dem
# naechsten Neustart ankommt.
#
# Die Positivliste steht gleichlautend als ENV_KEYS in
# scripts/refresh-api-server.mjs; scripts/refresh-api-env.test.mjs prueft den
# Gleichlauf und dass der Dienst keinen anderen Schluessel liest.

set -euo pipefail

SRC=/etc/metastats-crawler/env
DIR=${1:-/run/metastats-refresh-api}
KEYS='CONTRACTS_READ_TOKEN|CONTRACTS_STATUS_PATH|DATABASE_URL|EXPLORER_API_URL|MV_TIMING|NEXT_PUBLIC_SUPABASE_URL|REFRESH_API_PORT|REFRESH_API_TOKEN|RIOT_API_KEY_TFT|SUPABASE_SERVICE_ROLE_KEY'

umask 077
mkdir -p "$DIR"
chmod 0700 "$DIR"
# grep endet mit 1, wenn nichts passt — dann laeuft der Dienst ohne Schluessel
# an und beendet sich laut ("Missing env"), statt hier still zu scheitern.
grep -E "^(${KEYS})=" "$SRC" > "$DIR/env.tmp" || true
mv -f "$DIR/env.tmp" "$DIR/env"
echo "[refresh-api-env] $(wc -l < "$DIR/env") Schluessel nach $DIR/env"
