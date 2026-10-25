$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info {
  param([string]$Message)
  Write-Host "[INFO] $Message" -ForegroundColor Green
}

function Write-WarnLog {
  param([string]$Message)
  Write-Warning $Message
}

function Write-ErrorLog {
  param([string]$Message)
  Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Exit-WithError {
  param([string]$Message)
  Write-ErrorLog $Message
  exit 1
}

# $ErrorActionPreference = 'Stop' does not cover native programs: Windows
# PowerShell carries on after a failed npm or cargo. Every build step that
# must succeed goes through here and stops the script on a nonzero exit.
function Invoke-Native {
  param([string]$Description, [scriptblock]$Command)
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Description failed (exit code $LASTEXITCODE)"
  }
}

function Get-RepoRoot {
  Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}

function Assert-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    if ($Name -eq 'cargo' -or $Name -eq 'rustc') {
      Exit-WithError "Required program not found: $Name. Install Rust toolchain from https://rustup.rs/, then run: rustup default stable-x86_64-pc-windows-msvc"
    }
    Exit-WithError "Required program not found: $Name"
  }
}

function Assert-RequiredPrograms {
  Write-Info "Checking required programs"
  # Ensure ~/.cargo/bin is on PATH (rustup may not have updated the current shell)
  $cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
  if ((Test-Path $cargoBin) -and ($env:PATH -notlike "*$cargoBin*")) {
    $env:PATH = "$cargoBin;$env:PATH"
  }
  @('node', 'npm', 'cargo', 'rustc') | ForEach-Object { Assert-Command -Name $_ }
}

function Assert-NodeRuntime {
  Write-Info "Validating Node.js runtime"
  Invoke-Native 'node --version' { node --version | Out-Null }
  Invoke-Native 'npm --version' { npm --version | Out-Null }
}

function Assert-RustToolchain {
  param([string]$RepoRoot)

  Write-Info "Validating Cargo lockfile compatibility"
  $manifestPath = Join-Path $RepoRoot 'src-tauri/Cargo.toml'

  # Suppress Stop so stderr progress lines from cargo don't throw before we check the exit code
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $metadataOutput = & cargo metadata --manifest-path $manifestPath --format-version 1 --locked 2>&1
  $metadataExit = $LASTEXITCODE
  $ErrorActionPreference = $prev
  if ($metadataExit -ne 0) {
    $msg = ($metadataOutput | Out-String)
    if ($msg -match 'lock file version 4 requires') {
      $cargoVersion = (& cargo --version)
      Exit-WithError "${cargoVersion} cannot parse src-tauri/Cargo.lock (version = 4). Update Rust stable and retry: rustup update stable; rustup default stable"
    }
    Exit-WithError "cargo metadata failed: $msg"
  }
}

function Assert-WindowsHost {
  $onWindows = if ($PSVersionTable.PSVersion.Major -ge 6) { $IsWindows } else { $true }
  if (-not $onWindows) {
    Exit-WithError "This PowerShell build script is for Windows installers. Run it from native Windows PowerShell (not Linux/WSL)."
  }
}

# Cargo keeps every old build of every unit; drop the ones untouched for
# PRUNE_DAYS (default 7) before adding a new one. Best effort: a failed
# prune never stops the build.
function Invoke-PruneTarget {
  Write-Info "Pruning stale build output from the Cargo target dir"
  & node scripts/general/prune-target.mjs
  if ($LASTEXITCODE -ne 0) {
    Write-WarnLog "Pruning the target dir failed; continuing with the build"
  }
}

# node_modules is shared with the WSL side (scripts/android/build.sh
# reinstalls it for Linux), so a present folder is not enough: it must hold
# the Windows native binaries, with @tauri-apps/cli-win32-x64-msvc as the proxy for all
# of them (npm/cli#4828 leaves out the other OS's). node-modules-current.mjs
# checks the installed packages against package-lock.json. When both hold,
# npm ci is skipped: it deletes and reinstalls everything on every run.
function Install-FrontendDependencies {
  $reason = $null
  if (-not (Test-Path 'node_modules/@tauri-apps/cli-win32-x64-msvc')) {
    $reason = 'node_modules is missing or was installed for another OS (WSL build?)'
  }
  else {
    $output = & node scripts/general/node-modules-current.mjs
    if ($LASTEXITCODE -ne 0) {
      $reason = "$output"
    }
  }
  if (-not $reason) {
    Write-Info "node_modules is up to date for Windows; skipping npm ci"
    return
  }
  Write-Info "Installing frontend dependencies (npm ci): $reason"
  Invoke-Native 'npm ci' { npm ci }
}

# The Google desktop client secret is compiled in (google_auth.rs). A
# shell started before the variable was set - or from WSL - lacks it in
# its process environment, so fall back to the user-level value. Without
# it the build still succeeds, with Google sign-in disabled.
function Import-GoogleClientSecret {
  $name = 'HYPOMNEMA_GOOGLE_DESKTOP_CLIENT_SECRET'
  if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) {
    $userValue = [Environment]::GetEnvironmentVariable($name, 'User')
    if ($userValue) {
      [Environment]::SetEnvironmentVariable($name, $userValue, 'Process')
    }
  }
  if ([Environment]::GetEnvironmentVariable($name, 'Process')) {
    Write-Info "Google client secret found; Google sign-in enabled"
  }
  else {
    Write-WarnLog "$name is not set; this build cannot sign in to Google"
  }
}

function Invoke-TauriBuild {
  param([string]$RepoRoot)

  Write-Info "Running Tauri build for NSIS installer"
  $keyFile = Join-Path $HOME '.tauri/hypomnema.key'

  if ($env:TAURI_SIGNING_PRIVATE_KEY) {
    Write-Info "Using signing key from TAURI_SIGNING_PRIVATE_KEY"
    Invoke-Native 'tauri build' { npm run tauri build -- -b nsis }
    return
  }

  if ((Test-Path $keyFile) -and $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
    Write-Info "Using signing key from $keyFile"
    $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw $keyFile
    try {
      Invoke-Native 'tauri build' { npm run tauri build -- -b nsis }
    }
    finally {
      Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
    }
    return
  }

  Write-WarnLog "No updater signing key found; building installer without updater artifacts"
  $tmpCfg = Join-Path ([System.IO.Path]::GetTempPath()) "tauri-build-cfg-$([System.Guid]::NewGuid()).json"
  '{"bundle":{"createUpdaterArtifacts":false}}' | Set-Content -Path $tmpCfg -Encoding UTF8
  try {
    Invoke-Native 'tauri build' { npm run tauri build -- -b nsis --config $tmpCfg }
  }
  finally {
    Remove-Item $tmpCfg -ErrorAction SilentlyContinue
  }
}

# Copies the installer this run produced - picked by its exact name and
# its timestamp, never "the newest .exe in the folder": bundle/nsis keeps
# installers of earlier versions, and one of those must not be passed off
# under the current version's name.
function Publish-ReleaseArtifact {
  param([string]$RepoRoot, [datetime]$BuildStartedAt)

  $versionPath = Join-Path $RepoRoot 'VERSION'
  if (-not (Test-Path $versionPath)) {
    Exit-WithError "VERSION file not found at repository root"
  }

  $version = (Get-Content -Raw $versionPath).Trim()
  if ($version -notmatch '^\d+\.\d+\.\d+$') {
    Exit-WithError "VERSION must be semver X.Y.Z, got: $version"
  }

  $tauriConfigPath = Join-Path $RepoRoot 'src-tauri/tauri.conf.json'
  $tauriConfig = Get-Content -Raw $tauriConfigPath | ConvertFrom-Json
  $productName = $tauriConfig.productName
  if (-not $productName) {
    Exit-WithError "productName missing in src-tauri/tauri.conf.json"
  }

  $nsisDir = Join-Path $RepoRoot 'src-tauri/target/release/bundle/nsis'
  if (-not (Test-Path $nsisDir)) {
    Exit-WithError "NSIS bundle directory not found: $nsisDir"
  }

  $installerName = "{0}_{1}_x64-setup.exe" -f $productName, $version
  $installerPath = Join-Path $nsisDir $installerName
  if (-not (Test-Path $installerPath)) {
    Exit-WithError "Installer $installerName not found in $nsisDir"
  }
  $installer = Get-Item $installerPath
  if ($installer.LastWriteTime -lt $BuildStartedAt) {
    Exit-WithError "$installerName predates this build; refusing to publish a stale installer"
  }

  $releaseDir = Join-Path $RepoRoot 'releases/windows'
  New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null

  $safeName = $productName -replace '[^A-Za-z0-9._-]', '-'
  $destination = Join-Path $releaseDir ("{0}-{1}.exe" -f $safeName, $version)

  Copy-Item -Path $installer.FullName -Destination $destination -Force
  Write-Info "Copied installer: $destination"
}

function Main {
  try {
    $buildStartedAt = Get-Date
    $repoRoot = Get-RepoRoot
    Set-Location $repoRoot

    Write-Info "Building Hypomnema Windows installer"
    Assert-RequiredPrograms
    Assert-NodeRuntime
    Assert-RustToolchain -RepoRoot $repoRoot
    Assert-WindowsHost
    Invoke-PruneTarget
    Install-FrontendDependencies
    Import-GoogleClientSecret
    Invoke-TauriBuild -RepoRoot $repoRoot
    Publish-ReleaseArtifact -RepoRoot $repoRoot -BuildStartedAt $buildStartedAt
    Write-Info "Build finished"
  }
  catch {
    Exit-WithError $_.Exception.Message
  }
}

Main
