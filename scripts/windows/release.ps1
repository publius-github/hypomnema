param(
  # Run every check, tag and push nothing
  [switch]$Check
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
  Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}

function Assert-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required program not found: $Name"
  }
}

function Assert-RequiredPrograms {
  Write-Info "Checking required programs"
  @('git', 'node') | ForEach-Object { Assert-Command -Name $_ }
}

function Assert-CleanWorkingTree {
  Write-Info "Checking for clean git working tree"
  $status = git status --porcelain
  if ($status) {
    throw 'Working tree is not clean; commit or stash changes first.'
  }
}

function Get-ReleaseVersion {
  param([string]$RepoRoot)

  Write-Host ''
  Write-Info "Reading the version to release from VERSION (as bump.sh left it)"

  $versionPath = Join-Path $RepoRoot 'VERSION'
  if (-not (Test-Path $versionPath)) {
    throw 'VERSION file not found at repository root'
  }
  $version = (Get-Content -Raw $versionPath).Trim()
  if ($version -notmatch '^\d+\.\d+\.\d+$') {
    throw "VERSION must be semver X.Y.Z, got: $version"
  }

  # bump.sh keeps these in step; a hand edit would ship a mismatched build
  $found = [ordered]@{
    'package.json'              = (Get-Content -Raw (Join-Path $RepoRoot 'package.json') | ConvertFrom-Json).version
    # Windows PowerShell's ConvertFrom-Json rejects the lockfile's "" key;
    # its first "version" is the root package's
    'package-lock.json'         = [regex]::Match((Get-Content -Raw (Join-Path $RepoRoot 'package-lock.json')), '"version":\s*"([^"]*)"').Groups[1].Value
    'src-tauri/tauri.conf.json' = (Get-Content -Raw (Join-Path $RepoRoot 'src-tauri/tauri.conf.json') | ConvertFrom-Json).version
    'src-tauri/Cargo.toml'      = [regex]::Match((Get-Content -Raw (Join-Path $RepoRoot 'src-tauri/Cargo.toml')), '(?m)^version = "(.*)"\s*$').Groups[1].Value
  }
  $bad = @($found.Keys | Where-Object { $found[$_] -ne $version })
  if ($bad.Count -gt 0) {
    $bad | ForEach-Object { Write-ErrorLog "$_ has version $($found[$_]), VERSION has $version" }
    throw 'Manifest versions differ from VERSION; run scripts/general/bump.sh instead of editing them.'
  }

  Write-Info "Release version: $version"
  return $version
}

function Assert-ChangelogEntry {
  param([string]$ReleaseVersion)

  Write-Host ''
  Write-Info "Checking CHANGELOG.md describes $ReleaseVersion (it becomes the release notes)"
  # Windows PowerShell turns a native program's stderr into a terminating
  # error under 'Stop'; the exit code is what decides here
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  node scripts/general/changelog-entry.mjs $ReleaseVersion *> $null
  $code = $LASTEXITCODE
  $ErrorActionPreference = $previous
  if ($code -ne 0) {
    throw "Add a '## $ReleaseVersion - <date>' entry to CHANGELOG.md and commit it first."
  }
}

function Get-ReleaseBranch {
  param([string]$ReleaseVersion)

  Write-Host ''
  Write-Info "Checking the branch is up to date with origin and v$ReleaseVersion is new"

  $branch = git rev-parse --abbrev-ref HEAD
  if ($branch -eq 'HEAD') {
    throw 'Detached HEAD; check out the branch to release from.'
  }
  git fetch --quiet --no-tags origin
  if ($LASTEXITCODE -ne 0) { throw 'git fetch origin failed' }

  git rev-parse --verify --quiet "refs/remotes/origin/$branch" *> $null
  if ($LASTEXITCODE -eq 0) {
    git merge-base --is-ancestor "origin/$branch" HEAD
    if ($LASTEXITCODE -ne 0) {
      throw "$branch is behind or diverged from origin/$branch; pull first."
    }
  }

  git rev-parse --verify --quiet "refs/tags/v$ReleaseVersion" *> $null
  if ($LASTEXITCODE -eq 0) {
    throw "Tag v$ReleaseVersion already exists locally"
  }
  git ls-remote --exit-code --tags origin "refs/tags/v$ReleaseVersion" *> $null
  if ($LASTEXITCODE -eq 0) {
    throw "Tag v$ReleaseVersion already exists on origin"
  }
  return $branch
}

function Push-Release {
  param(
    [string]$ReleaseVersion,
    [string]$Branch
  )

  Write-Host ''
  Write-Info "Tagging v$ReleaseVersion and pushing $Branch with it"

  git tag "v$ReleaseVersion"
  if ($LASTEXITCODE -ne 0) { throw 'git tag failed' }
  git push origin $Branch
  if ($LASTEXITCODE -ne 0) { throw "git push origin $Branch failed" }
  git push origin "v$ReleaseVersion"
  if ($LASTEXITCODE -ne 0) { throw "git push of tag v$ReleaseVersion failed" }
}

function Main {
  $repoRoot = Get-RepoRoot
  Set-Location $repoRoot

  Write-Info "Releasing the version in the VERSION file"
  Assert-RequiredPrograms
  Assert-CleanWorkingTree

  $releaseVersion = Get-ReleaseVersion -RepoRoot $repoRoot
  Assert-ChangelogEntry -ReleaseVersion $releaseVersion
  $branch = Get-ReleaseBranch -ReleaseVersion $releaseVersion

  if ($Check) {
    Write-Host ''
    Write-Info "-Check: v$releaseVersion is ready to release; nothing tagged or pushed"
    return
  }

  Push-Release -ReleaseVersion $releaseVersion -Branch $branch

  Write-Host ''
  Write-Info "Release workflow triggered; the Windows installer will be attached to the draft GitHub Release v$releaseVersion"
}

Main
