#!/usr/bin/env bash
set -Eeuo pipefail
trap cleanup SIGINT SIGTERM ERR EXIT

COLOR_INFO='\033[0;32m'
COLOR_ERROR='\033[0;31m'
COLOR_WARN='\033[0;33m'
COLOR_RESET='\033[0m'

function log_info() {
  printf "${COLOR_INFO}[INFO]${COLOR_RESET} %s\n" "$*"
}

function log_warn() {
  printf "${COLOR_WARN}[WARN]${COLOR_RESET} %s\n" "$*" >&2
}

function log_error() {
  printf "${COLOR_ERROR}[ERROR]${COLOR_RESET} %s\n" "$*" >&2
}

function cleanup() {
  trap - SIGINT SIGTERM ERR EXIT
  custom_cleanup
}

function custom_cleanup() {
  :
}

REQUIRED_PROGRAMS=(git node)
EXTERNAL_ENV_VARIABLES=()
ARGUMENT_ENV_VARIABLES=(RELEASE_MODE)
SCRIPT_ARGS=("$@")

function check_required_programs() {
  log_info "function check_required_programs - verify release toolchain is present"
  local program
  for program in "${REQUIRED_PROGRAMS[@]}"; do
    if ! command -v "$program" >/dev/null 2>&1; then
      log_error "required program not found: $program"
      exit 1
    fi
  done
}

function export_env_variables_from_config() {
  log_info "function export_env_variables_from_config - no config file for this script"
}

function export_env_variables_external() {
  log_info "function export_env_variables_external - no external variables required"
}

function export_env_variables_from_arguments() {
  log_info "function export_env_variables_from_arguments - map positional arguments"
  local index=0
  local variable
  for variable in "${ARGUMENT_ENV_VARIABLES[@]}"; do
    export "$variable"="${SCRIPT_ARGS[$index]:-blank}"
    index=$((index + 1))
  done
}

function validate_env_variables() {
  log_info "function validate_env_variables - check the mode argument"
  case "$RELEASE_MODE" in
    blank|--check) ;;
    major|minor|patch)
      log_error "release.sh no longer bumps: run scripts/general/bump.sh $RELEASE_MODE, write the CHANGELOG.md entry, commit, then release"
      exit 1
      ;;
    *)
      log_error "usage: scripts/windows/release.sh [--check]  (--check: run every check, tag and push nothing)"
      exit 1
      ;;
  esac
}

function resolve_repo_root() {
  printf "\n"
  log_info "function resolve_repo_root - switch to the repository root"
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  REPO_ROOT="$(cd "$script_dir/../.." && pwd)"
  cd "$REPO_ROOT"
}

function check_working_tree() {
  printf "\n"
  log_info "function check_working_tree - refuse to release from a dirty tree"
  if [ -n "$(git status --porcelain)" ]; then
    log_error "working tree is not clean; commit or stash changes first"
    exit 1
  fi
}

function read_release_version() {
  printf "\n"
  log_info "function read_release_version - the version to release is the VERSION file's, as bump.sh left it"
  RELEASE_VERSION="$(tr -d '[:space:]' < VERSION)"
  if ! printf "%s" "$RELEASE_VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    log_error "VERSION file must contain semver X.Y.Z, got: $RELEASE_VERSION"
    exit 1
  fi
  export RELEASE_VERSION
  # bump.sh keeps these in step; a hand edit would ship a mismatched build
  node -e '
    const fs = require("fs");
    const v = process.argv[1];
    const found = {
      "package.json": JSON.parse(fs.readFileSync("package.json", "utf8")).version,
      "package-lock.json": JSON.parse(fs.readFileSync("package-lock.json", "utf8")).version,
      "src-tauri/tauri.conf.json": JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8")).version,
      "src-tauri/Cargo.toml": (fs.readFileSync("src-tauri/Cargo.toml", "utf8").match(/^version = "(.*)"$/m) || [])[1],
    };
    const bad = Object.entries(found).filter(([, x]) => x !== v);
    for (const [f, x] of bad) console.error(`${f} has version ${x}, VERSION has ${v}`);
    process.exit(bad.length ? 1 : 0);
  ' "$RELEASE_VERSION" || {
    log_error "manifest versions differ from VERSION; run scripts/general/bump.sh instead of editing them"
    exit 1
  }
  log_info "release version: $RELEASE_VERSION"
}

function check_changelog() {
  printf "\n"
  log_info "function check_changelog - CHANGELOG.md must describe $RELEASE_VERSION (it becomes the release notes)"
  if ! node scripts/general/changelog-entry.mjs "$RELEASE_VERSION" >/dev/null; then
    log_error "add a '## $RELEASE_VERSION - <date>' entry to CHANGELOG.md and commit it first"
    exit 1
  fi
}

function check_branch_and_tag() {
  printf "\n"
  log_info "function check_branch_and_tag - the branch is up to date with origin and v$RELEASE_VERSION is new"
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  if [ "$BRANCH" = "HEAD" ]; then
    log_error "detached HEAD; check out the branch to release from"
    exit 1
  fi
  git fetch --quiet --no-tags origin
  if git rev-parse --verify --quiet "refs/remotes/origin/$BRANCH" >/dev/null \
    && ! git merge-base --is-ancestor "origin/$BRANCH" HEAD; then
    log_error "$BRANCH is behind or diverged from origin/$BRANCH; pull first"
    exit 1
  fi
  if git rev-parse --verify --quiet "refs/tags/v$RELEASE_VERSION" >/dev/null; then
    log_error "tag v$RELEASE_VERSION already exists locally"
    exit 1
  fi
  if git ls-remote --exit-code --tags origin "refs/tags/v$RELEASE_VERSION" >/dev/null; then
    log_error "tag v$RELEASE_VERSION already exists on origin"
    exit 1
  fi
}

function tag_and_push() {
  printf "\n"
  log_info "function tag_and_push - tag v$RELEASE_VERSION and push $BRANCH with it; GitHub Actions builds the installer"
  git tag "v$RELEASE_VERSION"
  git push origin "$BRANCH"
  git push origin "v$RELEASE_VERSION"
  log_info "release workflow triggered; the Windows installer will be attached to the draft GitHub Release v$RELEASE_VERSION"
}

function main() {
  log_info "function main - release the version in the VERSION file"
  validate_env_variables
  resolve_repo_root
  check_working_tree
  read_release_version
  check_changelog
  check_branch_and_tag
  if [ "$RELEASE_MODE" = "--check" ]; then
    log_info "--check: v$RELEASE_VERSION is ready to release; nothing tagged or pushed"
    return
  fi
  tag_and_push
  log_info "release finished"
}

check_required_programs
export_env_variables_from_config
export_env_variables_external
export_env_variables_from_arguments

main
