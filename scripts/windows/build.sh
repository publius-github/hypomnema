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

function validate_rust_toolchain() {
  log_info "function validate_rust_toolchain - verify Cargo supports lockfile format"

  local cargo_version metadata_error
  cargo_version="$(cargo --version | awk '{print $2}')"

  if ! metadata_error="$(cargo metadata --manifest-path src-tauri/Cargo.toml --format-version 1 --locked 2>&1 >/dev/null)"; then
    if printf "%s" "$metadata_error" | grep -qi "lock file version 4 requires"; then
      log_error "Cargo $cargo_version cannot parse src-tauri/Cargo.lock (version = 4)"
      log_error "install a newer Rust toolchain (recommended stable) and retry"
      log_error "example: rustup update stable && rustup default stable"
      exit 1
    fi

    log_error "cargo metadata failed while validating toolchain"
    log_error "$metadata_error"
    exit 1
  fi
}

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

function validate_node_runtime() {
  log_info "function validate_node_runtime - verify node/npm can execute"

  if ! node --version >/dev/null 2>&1; then
    log_error "node is on PATH but cannot be executed"
    log_error "node path: $(command -v node)"
    if grep -qi microsoft /proc/version 2>/dev/null && uname -r | grep -q '^4\.4\.'; then
      log_error "detected WSL1 kernel ($(uname -r)); newer Node builds may be incompatible"
      log_error "use WSL2 or install an older compatible Node LTS version in this environment"
    else
      log_error "reinstall Node for this architecture/OS and verify: node --version"
    fi
    exit 1
  fi

  if ! npm --version >/dev/null 2>&1; then
    log_error "npm is on PATH but cannot be executed"
    log_error "npm path: $(command -v npm)"
    log_error "verify npm uses the same working Node install"
    exit 1
  fi
}

function validate_linux_native_dependencies() {
  if [ "$(uname -s)" != "Linux" ]; then
    return
  fi

  log_info "function validate_linux_native_dependencies - verify pkg-config and GTK/WebKit dev libs"

  local pkg_config_bin
  pkg_config_bin=""
  if command -v pkg-config >/dev/null 2>&1; then
    pkg_config_bin="pkg-config"
  elif command -v pkgconf >/dev/null 2>&1; then
    pkg_config_bin="pkgconf"
  else
    log_error "pkg-config is required for Linux Tauri builds but was not found"
    if [ -f /etc/os-release ] && grep -qiE '^ID(_LIKE)?=.*(ubuntu|debian)' /etc/os-release; then
      log_error "install with: sudo apt update && sudo apt install -y pkg-config build-essential libgtk-3-dev libwebkit2gtk-4.1-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev libayatana-appindicator3-dev libxdo-dev"
    else
      log_error "install pkg-config and GTK/WebKit development packages for your distribution"
    fi
    exit 1
  fi

  local missing_modules=()
  local module
  local required_modules=(
    gdk-3.0
    gdk-pixbuf-2.0
    gio-2.0
    glib-2.0
    gobject-2.0
    cairo
    libsoup-3.0
    javascriptcoregtk-4.1
    webkit2gtk-4.1
  )

  for module in "${required_modules[@]}"; do
    if ! "$pkg_config_bin" --exists "$module"; then
      missing_modules+=("$module")
    fi
  done

  if [ ${#missing_modules[@]} -gt 0 ]; then
    log_error "missing Linux development packages for: ${missing_modules[*]}"
    if [ -f /etc/os-release ] && grep -qiE '^ID(_LIKE)?=.*(ubuntu|debian)' /etc/os-release; then
      log_error "install with: sudo apt update && sudo apt install -y pkg-config build-essential libgtk-3-dev libwebkit2gtk-4.1-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev libayatana-appindicator3-dev libxdo-dev"
    else
      log_error "install the matching -dev packages that provide the listed pkg-config modules"
    fi
    exit 1
  fi
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
  REPO_ROOT="$(cd "$script_dir/../.." && pwd)"
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
  local key_file="$HOME/.tauri/hypomnema.key"
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
  local app_binary="$REPO_ROOT/src-tauri/target/release/hypomnema"
  if [ -d "$bundle_dir" ]; then
    find "$bundle_dir" -maxdepth 2 -type f \
      \( -name "*.exe" -o -name "*.msi" -o -name "*.dmg" -o -name "*.AppImage" -o -name "*.deb" \) \
      -print | while IFS= read -r artifact; do
        log_info "artifact: $artifact"
      done
  else
    log_warn "bundle directory not found: $bundle_dir"
    if [ -f "$app_binary" ]; then
      log_info "built native binary: $app_binary"
      if [ "$(uname -s)" = "Linux" ]; then
        log_info "run it on Linux with: $app_binary"
        log_warn "this environment builds Linux binaries; Windows .exe/.msi installers must be built on native Windows (or CI Windows runner)"
      fi
    fi
  fi
}

function main() {
  log_info "function main - build Hypomnema installer for the current platform"
  resolve_repo_root
  install_frontend_dependencies
  build_bundle
  report_artifacts
  log_info "build finished"
}

check_required_programs
validate_node_runtime
validate_rust_toolchain
validate_linux_native_dependencies
export_env_variables_from_config
export_env_variables_external
export_env_variables_from_arguments

main
