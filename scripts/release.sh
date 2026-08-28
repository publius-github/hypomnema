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

REQUIRED_PROGRAMS=(git npm node)
EXTERNAL_ENV_VARIABLES=()
ARGUMENT_ENV_VARIABLES=(BUMP_TYPE)
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
  log_info "function validate_env_variables - check bump type argument"
  if [ "$BUMP_TYPE" = "blank" ]; then
    BUMP_TYPE="patch"
    log_info "no bump type given, defaulting to patch"
  fi
  case "$BUMP_TYPE" in
    major|minor|patch) ;;
    *)
      log_error "usage: scripts/release.sh [major|minor|patch] (default: patch)"
      exit 1
      ;;
  esac
}

function bump_version_file() {
  printf "\n"
  log_info "function bump_version_file - bump $BUMP_TYPE version in VERSION file"
  if [ ! -f VERSION ]; then
    log_error "VERSION file not found at the repository root"
    exit 1
  fi
  local current
  current="$(tr -d '[:space:]' < VERSION)"
  if ! printf "%s" "$current" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    log_error "VERSION file must contain semver X.Y.Z, got: $current"
    exit 1
  fi
  local major minor patch
  IFS='.' read -r major minor patch <<< "$current"
  case "$BUMP_TYPE" in
    major) RELEASE_VERSION="$((major + 1)).0.0" ;;
    minor) RELEASE_VERSION="$major.$((minor + 1)).0" ;;
    patch) RELEASE_VERSION="$major.$minor.$((patch + 1))" ;;
  esac
  export RELEASE_VERSION
  printf "%s\n" "$RELEASE_VERSION" > VERSION
  log_info "version: $current -> $RELEASE_VERSION"
}

function resolve_repo_root() {
  printf "\n"
  log_info "function resolve_repo_root - switch to the repository root"
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  REPO_ROOT="$(cd "$script_dir/.." && pwd)"
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

function bump_versions() {
  printf "\n"
  log_info "function bump_versions - set $RELEASE_VERSION in package.json, tauri.conf.json, Cargo.toml"
  npm pkg set "version=$RELEASE_VERSION"
  node -e '
    const fs = require("fs");
    const path = "src-tauri/tauri.conf.json";
    const conf = JSON.parse(fs.readFileSync(path, "utf8"));
    conf.version = process.argv[1];
    fs.writeFileSync(path, JSON.stringify(conf, null, 2) + "\n");
  ' "$RELEASE_VERSION"
  node -e '
    const fs = require("fs");
    const path = "src-tauri/Cargo.toml";
    const toml = fs.readFileSync(path, "utf8");
    fs.writeFileSync(path, toml.replace(/^version = ".*"$/m, `version = "${process.argv[1]}"`));
  ' "$RELEASE_VERSION"
  if command -v cargo >/dev/null 2>&1; then
    (cd src-tauri && cargo update --package app-pkb --quiet)
  else
    log_warn "cargo not found locally; Cargo.lock version sync will happen in CI"
  fi
}

function commit_and_tag() {
  printf "\n"
  log_info "function commit_and_tag - commit version bump and create tag v$RELEASE_VERSION"
  if git rev-parse "v$RELEASE_VERSION" >/dev/null 2>&1; then
    log_error "tag v$RELEASE_VERSION already exists"
    exit 1
  fi
  git add VERSION package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock 2>/dev/null || true
  git commit -m "Release v$RELEASE_VERSION"
  git tag "v$RELEASE_VERSION"
}

function push_release() {
  printf "\n"
  log_info "function push_release - push branch and tag; GitHub Actions builds the installer"
  local branch
  branch="$(git rev-parse --abbrev-ref HEAD)"
  git push origin "$branch"
  git push origin "v$RELEASE_VERSION"
  log_info "release workflow triggered; the Windows installer will be attached to the draft GitHub Release v$RELEASE_VERSION"
}

function main() {
  log_info "function main - cut a release from the VERSION file"
  validate_env_variables
  resolve_repo_root
  check_working_tree
  bump_version_file
  bump_versions
  commit_and_tag
  push_release
  log_info "release finished"
}

check_required_programs
export_env_variables_from_config
export_env_variables_external
export_env_variables_from_arguments

main
