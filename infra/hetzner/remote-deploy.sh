#!/usr/bin/env bash
# Runs ON the Hetzner crawler box — fed via stdin by the deploy-hetzner.yml
# workflow (`ssh root@box 'bash -s' < this-file`). Syncs /opt/metastats-crawler
# to origin/main. The box is a pure CONSUMER of main; it never pushes. Crawled
# data flows box -> Supabase separately and is untouched here.
#
# Systemd unit files (infra/hetzner/*.timer|*.service) are NOT applied here —
# they are sensitive and change rarely. Apply unit changes manually:
#   scp infra/hetzner/<unit> root@<host>:/etc/systemd/system/ && systemctl daemon-reload
set -euo pipefail

cd /opt/metastats-crawler
git fetch origin --quiet

# Never pull files / run npm ci out from under an in-flight crawl: a freshly
# spawned per-region child re-reads scripts from disk, and npm ci wipes
# node_modules. Skip cleanly and let a later run (workflow_dispatch once idle)
# apply the change.
if systemctl is-active --quiet metastats-crawler.service \
   || systemctl is-active --quiet metastats-daily-crawl.service; then
  echo "WARN: a crawl is active — skipping sync. Re-run via workflow_dispatch once idle."
  exit 0
fi

before=$(sha1sum package-lock.json 2>/dev/null | cut -d' ' -f1 || true)
# Hard-sync to main. The fallback clears stray untracked files (e.g. scripts
# that predate their commit) only if they would block the reset.
git reset --hard origin/main || { git clean -fd; git reset --hard origin/main; }
after=$(sha1sum package-lock.json 2>/dev/null | cut -d' ' -f1 || true)

if [ "$before" != "$after" ]; then
  echo "package-lock.json changed — running npm ci"
  npm ci --omit=dev
fi

# Re-arm the timers so the next scheduled run uses the new code. Restarting a
# .timer never interrupts an in-flight oneshot .service.
systemctl restart metastats-daily-crawl.timer metastats-companion-backfill.timer metastats-crawler.timer

echo "Deployed $(git rev-parse --short HEAD) on $(hostname) at $(date -u +%FT%TZ)"
