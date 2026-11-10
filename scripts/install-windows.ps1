# Install Omni Voice Desk from the Windows zip package.
# Usage (PowerShell):
#   .\scripts\install-windows.ps1
#   .\scripts\install-windows.ps1 -ZipPath ".\dist\Omni Voice Desk-0.1.0-win-x64.zip"

param(
  [string]$ZipPath = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Dist = Join-Path $Root "dist"
$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }

if (-not $ZipPath) {
  $ZipPath = Get-ChildItem -Path $Dist -Filter "OmniVoiceDesk-*-win-$Arch.zip" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName
  if (-not $ZipPath) {
    $ZipPath = Get-ChildItem -Path $Dist -Filter "Omni Voice Desk-*-win-$Arch.zip" |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1 -ExpandProperty FullName
  }
}

if (-not $ZipPath -or -not (Test-Path $ZipPath)) {
  throw "Windows zip not found. Build with: npm run dist:win  (or place the zip under dist/)"
}

$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\Omni Voice Desk"
$ExeName = "Omni Voice Desk.exe"

Write-Host "Omni Voice Desk — Windows installer"
Write-Host "Using: $ZipPath"
Write-Host "Install to: $InstallDir"

if (Test-Path $InstallDir) {
  Remove-Item -Recurse -Force $InstallDir
}
New-Item -ItemType Directory -Path $InstallDir | Out-Null

Expand-Archive -Path $ZipPath -DestinationPath $InstallDir -Force

# electron-builder zip usually contains the app files at the root of the archive
$Exe = Get-ChildItem -Path $InstallDir -Filter $ExeName -Recurse | Select-Object -First 1
if (-not $Exe) {
  throw "Could not find $ExeName after extracting the zip."
}

$Wsh = New-Object -ComObject WScript.Shell
$StartMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Omni Voice Desk.lnk"
$Desktop = Join-Path ([Environment]::GetFolderPath("Desktop")) "Omni Voice Desk.lnk"

foreach ($LinkPath in @($StartMenu, $Desktop)) {
  $Shortcut = $Wsh.CreateShortcut($LinkPath)
  $Shortcut.TargetPath = $Exe.FullName
  $Shortcut.WorkingDirectory = $Exe.Directory.FullName
  $Shortcut.IconLocation = $Exe.FullName
  $Shortcut.Description = "Omni Voice Desk"
  $Shortcut.Save()
}

Write-Host ""
Write-Host "Installed: $($Exe.FullName)"
Write-Host "Shortcuts created on Desktop and Start Menu."
Start-Process $Exe.FullName
