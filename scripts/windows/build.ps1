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
  node --version | Out-Null
  npm --version | Out-Null
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

function Install-FrontendDependencies {
  Write-Info "Installing frontend dependencies (npm ci)"
  npm ci
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
  $keyFile = Join-Path $HOME '.tauri/app-pkb.key'

  if ($env:TAURI_SIGNING_PRIVATE_KEY) {
    Write-Info "Using signing key from TAURI_SIGNING_PRIVATE_KEY"
    npm run tauri build -- -b nsis
    return
  }

  if ((Test-Path $keyFile) -and $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
    Write-Info "Using signing key from $keyFile"
    $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw $keyFile
    try {
      npm run tauri build -- -b nsis
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
    npm run tauri build -- -b nsis --config $tmpCfg
  }
  finally {
    Remove-Item $tmpCfg -ErrorAction SilentlyContinue
  }
}

function Publish-ReleaseArtifact {
  param([string]$RepoRoot)

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

  $installer = Get-ChildItem -Path $nsisDir -Filter '*.exe' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $installer) {
    Exit-WithError "No .exe installer found in $nsisDir"
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
    $repoRoot = Get-RepoRoot
    Set-Location $repoRoot

    Write-Info "Building app-pkb Windows installer"
    Assert-RequiredPrograms
    Assert-NodeRuntime
    Assert-RustToolchain -RepoRoot $repoRoot
    Assert-WindowsHost
    Install-FrontendDependencies
    Import-GoogleClientSecret
    Invoke-TauriBuild -RepoRoot $repoRoot
    Publish-ReleaseArtifact -RepoRoot $repoRoot
    Write-Info "Build finished"
  }
  catch {
    Exit-WithError $_.Exception.Message
  }
}

Main
