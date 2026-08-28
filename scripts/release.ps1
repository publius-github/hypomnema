param(
  [ValidateSet('major', 'minor', 'patch')]
  [string]$BumpType = 'patch'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info {
  param([string]$Message)
  Write-Host "[INFO] $Message" -ForegroundColor Green
}

function Write-ErrorLog {
  param([string]$Message)
  Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Get-RepoRoot {
  Split-Path -Parent $PSScriptRoot
}

function Assert-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required program not found: $Name"
  }
}

function Assert-RequiredPrograms {
  Write-Info "Checking required programs"
  @('git', 'node', 'npm') | ForEach-Object { Assert-Command -Name $_ }
}

function Assert-CleanWorkingTree {
  Write-Info "Checking for clean git working tree"
  $status = git status --porcelain
  if ($status) {
    throw 'Working tree is not clean; commit or stash changes first.'
  }
}

function Get-BumpedVersion {
  param(
    [string]$CurrentVersion,
    [string]$Kind
  )

  if ($CurrentVersion -notmatch '^(\d+)\.(\d+)\.(\d+)$') {
    throw "VERSION must be semver X.Y.Z, got: $CurrentVersion"
  }

  $major = [int]$Matches[1]
  $minor = [int]$Matches[2]
  $patch = [int]$Matches[3]

  switch ($Kind) {
    'major' { return "{0}.0.0" -f ($major + 1) }
    'minor' { return "{0}.{1}.0" -f $major, ($minor + 1) }
    'patch' { return "{0}.{1}.{2}" -f $major, $minor, ($patch + 1) }
    default { throw "Unsupported bump type: $Kind" }
  }
}

function Set-ReleaseVersion {
  param([string]$RepoRoot)

  Write-Info "Bumping VERSION with type: $BumpType"

  $versionPath = Join-Path $RepoRoot 'VERSION'
  if (-not (Test-Path $versionPath)) {
    throw 'VERSION file not found at repository root'
  }

  $current = (Get-Content -Raw $versionPath).Trim()
  $next = Get-BumpedVersion -CurrentVersion $current -Kind $BumpType

  Set-Content -Path $versionPath -Value $next -NoNewline
  Write-Host ''
  Write-Info "Version: $current -> $next"
  return $next
}

function Sync-VersionManifests {
  param(
    [string]$RepoRoot,
    [string]$ReleaseVersion
  )

  Write-Host ''
  Write-Info "Syncing version in package.json, tauri.conf.json, Cargo.toml"

  npm pkg set "version=$ReleaseVersion"

  $tauriConfigPath = Join-Path $RepoRoot 'src-tauri/tauri.conf.json'
  $tauri = Get-Content -Raw $tauriConfigPath | ConvertFrom-Json
  $tauri.version = $ReleaseVersion
  $tauri | ConvertTo-Json -Depth 100 | Set-Content -Path $tauriConfigPath

  $cargoTomlPath = Join-Path $RepoRoot 'src-tauri/Cargo.toml'
  $cargoToml = Get-Content -Raw $cargoTomlPath
  $cargoToml = [regex]::Replace($cargoToml, '^version\s*=\s*".*"\s*$', "version = `"$ReleaseVersion`"", [System.Text.RegularExpressions.RegexOptions]::Multiline)
  Set-Content -Path $cargoTomlPath -Value $cargoToml -NoNewline

  if (Get-Command cargo -ErrorAction SilentlyContinue) {
    Push-Location (Join-Path $RepoRoot 'src-tauri')
    try {
      cargo update --package app-pkb --quiet
    }
    finally {
      Pop-Location
    }
  }
}

function Commit-And-Tag {
  param([string]$ReleaseVersion)

  Write-Host ''
  Write-Info "Committing release and creating tag v$ReleaseVersion"

  git rev-parse "v$ReleaseVersion" *> $null
  if ($LASTEXITCODE -eq 0) {
    throw "Tag v$ReleaseVersion already exists"
  }

  git add VERSION package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
  git commit -m "Release v$ReleaseVersion"
  git tag "v$ReleaseVersion"
}

function Push-Release {
  param([string]$ReleaseVersion)

  Write-Host ''
  Write-Info "Pushing branch and tag"

  $branch = git rev-parse --abbrev-ref HEAD
  git push origin $branch
  git push origin "v$ReleaseVersion"
}

function Main {
  $repoRoot = Get-RepoRoot
  Set-Location $repoRoot

  Write-Info "Creating release"
  Assert-RequiredPrograms
  Assert-CleanWorkingTree

  $releaseVersion = Set-ReleaseVersion -RepoRoot $repoRoot
  Sync-VersionManifests -RepoRoot $repoRoot -ReleaseVersion $releaseVersion
  Commit-And-Tag -ReleaseVersion $releaseVersion
  Push-Release -ReleaseVersion $releaseVersion

  Write-Host ''
  Write-Info "Release finished"
}

Main
