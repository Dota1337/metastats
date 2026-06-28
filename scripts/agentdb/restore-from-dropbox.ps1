# AgentDB Restore from Dropbox Snapshot
# Master lives in repo at scripts/agentdb/restore-from-dropbox.ps1
# Auto-mirrored to Dropbox\Metastats\workstation-setup\restore-agentdb.ps1
#
# Workflow:
#   1. Verify snapshot exists + hash matches meta
#   2. Same-host guard (kein restore wenn Snapshot vom gleichen Host stammt)
#   3. Stop running daemon on port 7878 (if any)
#   4. Backup local DB to ~/.claude/agentdb/backup-<timestamp>/
#   5. Copy snapshot DB + current-trajectory.json into ~/.claude/agentdb/
#   6. Remove stale WAL/SHM
#   7. Restart daemon via repo's ensure-daemon.mjs
#   8. Verify counts match meta

$ErrorActionPreference = "Stop"

$SnapshotDir = Join-Path $env:USERPROFILE "Dropbox\Metastats\agentdb-snapshot\db"
$LocalDir    = Join-Path $env:USERPROFILE ".claude\agentdb"
$RepoDir     = if ($env:METASTATS_REPO) { $env:METASTATS_REPO } else { Join-Path $env:USERPROFILE "metastats" }

Write-Host "==> AgentDB Restore from Dropbox"
Write-Host "    Source: $SnapshotDir"
Write-Host "    Target: $LocalDir"
Write-Host "    Repo  : $RepoDir"
Write-Host ""

# --- Step 1: Pre-checks ---
if (-not (Test-Path "$SnapshotDir\metastats.db"))           { throw "Snapshot DB missing: $SnapshotDir\metastats.db (Dropbox-Sync up-to-date?)" }
if (-not (Test-Path "$SnapshotDir\metastats.db.meta.json")) { throw "Meta missing: $SnapshotDir\metastats.db.meta.json" }
if (-not (Test-Path "$RepoDir\scripts\agentdb\ensure-daemon.mjs")) { throw "Repo missing or outdated at $RepoDir. Set env METASTATS_REPO if path differs." }

$meta = Get-Content "$SnapshotDir\metastats.db.meta.json" -Raw | ConvertFrom-Json
Write-Host "Snapshot meta:"
Write-Host "  host         : $($meta.source_host)"
Write-Host "  exported_at  : $($meta.exported_at)"
Write-Host "  size_mb      : $($meta.db_size_mb)"
Write-Host "  sections     : $($meta.sections)"
Write-Host "  vecs         : $($meta.vecs)"
Write-Host "  trajectories : $($meta.trajectories)"
Write-Host "  sha256       : $($meta.sha256.Substring(0,16))..."
Write-Host ""

# --- Step 2: Hash-Verify (catches partial Dropbox sync) ---
$snapHash = (Get-FileHash "$SnapshotDir\metastats.db" -Algorithm SHA256).Hash
if ($snapHash -ne $meta.sha256) {
  throw "Snapshot hash mismatch. Meta=$($meta.sha256) actual=$snapHash. Dropbox-Sync vmtl. unvollstaendig. Warte bis Dropbox 'Up to date' zeigt und retry."
}
Write-Host "Hash OK"

# --- Step 3: Same-Host-Guard ---
if ($meta.source_host -eq $env:COMPUTERNAME) {
  Write-Host ""
  Write-Host "WARN: Snapshot stammt vom gleichen Host ($env:COMPUTERNAME). Kein Restore noetig."
  Write-Host "      (Falls du das wirklich willst: Snapshot manuell ueberschreiben oder Hostname checken.)"
  exit 0
}

# --- Step 4: Stop running daemon ---
$conn = Get-NetTCPConnection -LocalPort 7878 -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' } | Select-Object -First 1
if ($conn) {
  Write-Host "Stopping daemon (PID $($conn.OwningProcess))..."
  Stop-Process -Id $conn.OwningProcess -Force
  Start-Sleep -Seconds 2
  $stillUp = Get-NetTCPConnection -LocalPort 7878 -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' }
  if ($stillUp) { throw "Daemon did not stop." }
  Write-Host "Daemon stopped"
} else {
  Write-Host "No daemon running on :7878"
}

# --- Step 5: Backup current local DB ---
if (-not (Test-Path $LocalDir)) { New-Item -ItemType Directory -Path $LocalDir -Force | Out-Null }
if (Test-Path "$LocalDir\metastats.db") {
  $ts = Get-Date -Format "yyyyMMdd-HHmmss"
  $bakDir = Join-Path $LocalDir "backup-$ts"
  New-Item -ItemType Directory -Path $bakDir -Force | Out-Null
  Get-ChildItem $LocalDir -Filter "metastats.db*" -File | Copy-Item -Destination $bakDir -Force
  if (Test-Path "$LocalDir\current-trajectory.json") {
    Copy-Item "$LocalDir\current-trajectory.json" -Destination $bakDir -Force
  }
  Write-Host "Backup -> $bakDir"
}

# --- Step 6: Copy snapshot ---
Copy-Item "$SnapshotDir\metastats.db" -Destination "$LocalDir\metastats.db" -Force
if (Test-Path "$SnapshotDir\current-trajectory.json") {
  Copy-Item "$SnapshotDir\current-trajectory.json" -Destination "$LocalDir\current-trajectory.json" -Force
}
# Stale WAL/SHM removen damit SQLite frisch oeffnet
foreach ($f in @("metastats.db-wal", "metastats.db-shm")) {
  $p = Join-Path $LocalDir $f
  if (Test-Path $p) { Remove-Item $p -Force }
}
Write-Host "DB copied (WAL/SHM cleaned)"

# --- Step 7: Restart daemon ---
Write-Host "Starting daemon..."
Push-Location $RepoDir
try {
  & node scripts/agentdb/ensure-daemon.mjs --quiet
} finally {
  Pop-Location
}
Start-Sleep -Seconds 3

# --- Step 8: Verify counts ---
$attempts = 0
$health = $null
while ($attempts -lt 5) {
  try {
    $health = (Invoke-WebRequest -Uri "http://127.0.0.1:7878/healthz" -UseBasicParsing -TimeoutSec 5).Content | ConvertFrom-Json
    break
  } catch {
    $attempts++
    Start-Sleep -Seconds 2
  }
}
if (-not $health) { throw "Daemon health-check failed after 5 attempts." }

$ok = $true
if ($health.counts.sections     -ne $meta.sections)     { Write-Host "FAIL sections:     meta=$($meta.sections) actual=$($health.counts.sections)"; $ok = $false }
if ($health.counts.vecs         -ne $meta.vecs)         { Write-Host "FAIL vecs:         meta=$($meta.vecs) actual=$($health.counts.vecs)"; $ok = $false }
if ($health.counts.trajectories -ne $meta.trajectories) { Write-Host "FAIL trajectories: meta=$($meta.trajectories) actual=$($health.counts.trajectories)"; $ok = $false }

if (-not $ok) { throw "Counts mismatch - restore inkonsistent. Backup unter $LocalDir\backup-*." }

Write-Host ""
Write-Host "==> Restore OK"
Write-Host "    sections     : $($health.counts.sections)"
Write-Host "    vecs         : $($health.counts.vecs)"
Write-Host "    trajectories : $($health.counts.trajectories)"
Write-Host "    daemon uptime: $($health.uptime_sec)s"
