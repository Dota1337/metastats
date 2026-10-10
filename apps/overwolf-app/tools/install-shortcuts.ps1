# Legt Desktop- und Startmenue-Verknuepfung fuer die metastats.gg Companion an
# (oder entfernt sie mit -Remove). Doppelklick startet Overwolf, falls es nicht
# laeuft, und oeffnet die App — derselbe Weg, den Overwolf fuer installierte
# Store-Apps nimmt (OverwolfLauncher.exe -launchapp <uid> -from-desktop).
#
# Nur fuer den Entwickler-PC: Fremde bekommen die App erst ueber den Overwolf-
# Store, Overwolf blockt nicht veroeffentlichte Apps auf anderen Konten.
#
# Lauf: npm run shortcuts            (anlegen, wiederholbar)
#       npm run shortcuts -- -Remove (entfernen)
param([switch]$Remove)
$ErrorActionPreference = 'Stop'

# Kennung der App; Overwolf bildet sie aus meta.name und meta.author im
# Manifest. Gemessen im App-Log („ready … overwolf-extension://<uid>/…“).
$Uid = 'oicogphdbdfklkcmhipflepkdackclicbnjacmek'
$Name = 'metastats.gg Companion'

$desktop = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) ''
$links = @(
  @{ Path = Join-Path $desktop "$Name.lnk"; From = '-from-desktop' },
  @{ Path = Join-Path $startMenu "$Name.lnk"; From = '-from-startmenu' }
)

if ($Remove) {
  foreach ($l in $links) {
    if (Test-Path -LiteralPath $l.Path) { Remove-Item -LiteralPath $l.Path; "entfernt: $($l.Path)" }
  }
  exit 0
}

# Overwolf liegt nicht zwingend unter Program Files (hier A:\overwolf\).
$folder = $null
foreach ($key in 'HKLM:\SOFTWARE\WOW6432Node\Overwolf', 'HKLM:\SOFTWARE\Overwolf') {
  try { $folder = (Get-ItemProperty -Path $key -Name InstallFolder -ErrorAction Stop).InstallFolder; if ($folder) { break } } catch { }
}
if (-not $folder) { $folder = Join-Path ${env:ProgramFiles(x86)} 'Overwolf' }
$launcher = Join-Path $folder 'OverwolfLauncher.exe'
if (-not (Test-Path -LiteralPath $launcher)) { throw "Overwolf nicht gefunden: $launcher" }

# Symbol an einen festen Ort kopieren, damit die Verknuepfung nicht am
# Arbeitsordner haengt.
$iconDir = Join-Path $env:LOCALAPPDATA 'metastats-companion'
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null
$icon = Join-Path $iconDir 'metastats.ico'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\public\images\launcher_icon.ico') -Destination $icon -Force

$shell = New-Object -ComObject WScript.Shell
foreach ($l in $links) {
  $lnk = $shell.CreateShortcut($l.Path)
  $lnk.TargetPath = $launcher
  $lnk.Arguments = "-launchapp $Uid $($l.From)"
  $lnk.WorkingDirectory = $folder
  $lnk.IconLocation = "$icon,0"
  $lnk.Description = $Name
  $lnk.Save()
  "angelegt: $($l.Path)"
}
