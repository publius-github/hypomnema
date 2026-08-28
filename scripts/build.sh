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

REQUIRED_PROGRAMS=(node npm cargo rustc)
EXTERNAL_ENV_VARIABLES=()
ARGUMENT_ENV_VARIABLES=()

function check_required_programs() {
  log_info "function check_required_programs - verify build toolchain is present"
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
  local variable
  # ${arr[@]+...} keeps set -u happy on empty arrays (bash 3.2)
  for variable in ${EXTERNAL_ENV_VARIABLES[@]+"${EXTERNAL_ENV_VARIABLES[@]}"}; do
    export "$variable"="${!variable:-blank}"
  done
}

function export_env_variables_from_arguments() {
  log_info "function export_env_variables_from_arguments - no positional arguments expected"
}

function validate_env_variables() {
  log_info "function validate_env_variables - check exported variables"
  local variable
  for variable in ${EXTERNAL_ENV_VARIABLES[@]+"${EXTERNAL_ENV_VARIABLES[@]}"}; do
    if [ "${!variable}" = "blank" ]; then
      log_error "environment variable $variable is not set"
      exit 1
    fi
  done
}

function resolve_repo_root() {
  printf "\n"
  log_info "function resolve_repo_root - switch to the repository root"
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  REPO_ROOT="$(cd "$script_dir/.." && pwd)"
  cd "$REPO_ROOT"
  log_info "repository root: $REPO_ROOT"
}

function install_frontend_dependencies() {
  printf "\n"
  log_info "function install_frontend_dependencies - npm ci"
  npm ci
}

function build_bundle() {
  printf "\n"
  log_info "function build_bundle - tauri release build with installer bundles"
  local key_file="$HOME/.tauri/app-pkb.key"
  if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
    log_info "using signing key from TAURI_SIGNING_PRIVATE_KEY"
    npm run tauri build
  elif [ -f "$key_file" ] && [ -n "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]; then
    log_info "using signing key from $key_file"
    TAURI_SIGNING_PRIVATE_KEY="$(cat "$key_file")" \
      npm run tauri build
  else
    log_warn "no updater signing key found; building installer without updater artifacts"
    npm run tauri build -- --config '{"bundle":{"createUpdaterArtifacts":false}}'
  fi
}

function report_artifacts() {
  printf "\n"
  log_info "function report_artifacts - list produced installer bundles"
  local bundle_dir="$REPO_ROOT/src-tauri/target/release/bundle"
  if [ -d "$bundle_dir" ]; then
    find "$bundle_dir" -maxdepth 2 -type f \
      \( -name "*.exe" -o -name "*.msi" -o -name "*.dmg" -o -name "*.AppImage" -o -name "*.deb" \) \
      -print | while IFS= read -r artifact; do
        log_info "artifact: $artifact"
      done
  else
    log_warn "bundle directory not found: $bundle_dir"
  fi
}

function main() {
  log_info "function main - build app-pkb installer for the current platform"
  resolve_repo_root
  install_frontend_dependencies
  build_bundle
  report_artifacts
  log_info "build finished"
}

check_required_programs
export_env_variables_from_config
export_env_variables_external
export_env_variables_from_arguments

main
