#!/bin/bash
# install-caddy.sh — einmalig auf der Box (als root), idempotent:
#   ssh root@37.27.219.140 'bash -s' < infra/hetzner/install-caddy.sh
#
# Caddy aus dem offiziellen Caddy-apt-Repo, weil Ubuntu 24.04 nur 2.6.2
# liefert und erst 2.10 ACME-Profile kann (noetig fuer Let's-Encrypt-
# IP-Zertifikate, Profil "shortlived"). Danach:
#   infra/hetzner/apply-units.sh metastats-caddy   (Caddyfile + Unit)
#   systemctl enable --now metastats-caddy
#
# Sicherheit: das Fremd-Repo darf per apt-Pin NUR das Paket caddy liefern.
# Updates kommen ueber `apt upgrade` im Server-Fenster.
set -euo pipefail

KEYRING=/usr/share/keyrings/caddy-stable-archive-keyring.gpg
LIST=/etc/apt/sources.list.d/caddy-stable.list
PIN=/etc/apt/preferences.d/caddy-stable

if [ ! -s "$KEYRING" ]; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor > "$KEYRING.new"
  chmod 0644 "$KEYRING.new"
  mv -f "$KEYRING.new" "$KEYRING"
fi
echo "deb [signed-by=$KEYRING] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" > "$LIST"
chmod 0644 "$LIST"
cat > "$PIN" <<'EOF'
# Aus dem Caddy-Repo nur caddy selbst, nie ein anderes Paket.
Package: *
Pin: origin dl.cloudsmith.io
Pin-Priority: -1

Package: caddy
Pin: origin dl.cloudsmith.io
Pin-Priority: 500
EOF
chmod 0644 "$PIN"

apt-get update -o Dir::Etc::sourcelist="$LIST" -o Dir::Etc::sourceparts="-" -o APT::Get::List-Cleanup="0"

# Das Paket startet sonst sofort seine eigene Unit mit Beispiel-Konfiguration
# auf Port 80. policy-rc.d verbietet das Starten waehrend der Installation.
if [ -e /usr/sbin/policy-rc.d ]; then
  echo "!! /usr/sbin/policy-rc.d existiert schon — Abbruch, nichts installiert" >&2
  exit 1
fi
printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d
chmod 0755 /usr/sbin/policy-rc.d
trap 'rm -f /usr/sbin/policy-rc.d' EXIT
DEBIAN_FRONTEND=noninteractive apt-get install -y caddy
rm -f /usr/sbin/policy-rc.d

systemctl disable --now caddy.service caddy-api.service 2>/dev/null || true
systemctl mask caddy.service caddy-api.service
echo "caddy: $(caddy version)"
echo "Herkunft: $(apt-cache policy caddy | grep -E 'Installed|Candidate' | tr -s ' ' | tr '\n' ' ')"
