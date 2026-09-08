#!/usr/bin/env bash
# Builds an Android APK and copies it into releases/android/ (and into the
# Dropbox folder the test phone installs from).
#
# Artifacts are named Hypomnema-<version>-b<build>-<variant>-<abi>.apk. The
# build number comes from releases/android/.build-number and increments per
# run: VERSION only moves on a release-worthy change, so without it a test
# device cannot tell two builds of the same version apart.
#
# Usage: scripts/build-android.sh [debug|release]   (default: release)
# Env overrides:
#   ANDROID_ABIS       space-separated ABIs to build (default: aarch64)
#                       one or more of: aarch64 armv7 i686 x86_64
#   ANDROID_HOME        Android SDK root (required)
#   ANDROID_NDK_HOME    NDK root (auto-detected under $ANDROID_HOME/ndk if unset)
#   JAVA_HOME           JDK root (auto-detected from `java` on PATH if unset)
#   CARGO_TARGET_DIR    override if the repo's drive is low on space (see
#                       check_disk_space below) - an Android build adds
#                       several GB across Rust + Gradle caches
#   ANDROID_KEYSTORE       path to a release keystore (.jks). Without it a
#                          release build is signed with the debug key:
#                          installable for testing, not publishable.
#   ANDROID_KEYSTORE_PASS  store password
#   ANDROID_KEY_ALIAS      key alias inside the store
#   ANDROID_KEY_PASS       key password (defaults to the store password)
#
# Make a keystore once, and keep it somewhere backed up that is not this
# repo - losing it means never being able to update an installed app:
#   keytool -genkeypair -v -keystore hypomnema-release.jks \
#     -keyalg RSA -keysize 4096 -validity 10000 -alias hypomnema
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

REQUIRED_PROGRAMS=(node npm cargo rustup java)
ARGUMENT_ENV_VARIABLES=(BUILD_VARIANT)
SCRIPT_ARGS=("$@")

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
  log_info "function validate_env_variables - check build variant argument"
  if [ "$BUILD_VARIANT" = "blank" ]; then
    BUILD_VARIANT="release"
    log_info "no build variant given, defaulting to release"
  fi
  case "$BUILD_VARIANT" in
    debug|release) ;;
    *)
      log_error "usage: scripts/build-android.sh [debug|release] (default: release)"
      exit 1
      ;;
  esac
  if [ "$BUILD_VARIANT" = "release" ] && [ -z "${ANDROID_KEYSTORE:-}" ]; then
    log_warn "ANDROID_KEYSTORE is not set, so this release APK is signed with"
    log_warn "the auto-generated DEBUG keystore: it installs for local testing,"
    log_warn "but is not publishable. See the header of this script."
  fi
  ANDROID_ABIS="${ANDROID_ABIS:-aarch64}"
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

function resolve_android_sdk() {
  printf "\n"
  log_info "function resolve_android_sdk - locate SDK, NDK and JDK"
  if [ -z "${ANDROID_HOME:-}" ]; then
    log_error "ANDROID_HOME is not set; install the Android SDK and export ANDROID_HOME"
    exit 1
  fi
  if [ ! -d "$ANDROID_HOME" ]; then
    log_error "ANDROID_HOME does not exist: $ANDROID_HOME"
    exit 1
  fi
  export ANDROID_HOME

  if [ -z "${ANDROID_NDK_HOME:-}" ] && [ -z "${NDK_HOME:-}" ]; then
    local ndk_dir
    ndk_dir="$(find "$ANDROID_HOME/ndk" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -1)"
    if [ -z "$ndk_dir" ]; then
      log_error "no NDK found under $ANDROID_HOME/ndk"
      log_error "install one with: sdkmanager \"ndk;27.0.12077973\""
      exit 1
    fi
    export ANDROID_NDK_HOME="$ndk_dir"
    export NDK_HOME="$ndk_dir"
  fi
  log_info "ANDROID_NDK_HOME: $ANDROID_NDK_HOME"

  if [ -z "${JAVA_HOME:-}" ]; then
    export JAVA_HOME="$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")"
  fi
  log_info "JAVA_HOME: $JAVA_HOME"
}

function check_disk_space() {
  printf "\n"
  log_info "function check_disk_space - warn if the repo's drive is nearly full"
  local avail_gb
  avail_gb=$(($(df -Pk "$REPO_ROOT" | awk 'NR==2 {print $4}') / 1024 / 1024))
  if [ "$avail_gb" -lt 5 ]; then
    log_warn "only ${avail_gb}GB free on the filesystem holding $REPO_ROOT"
    log_warn "an Android build can add several GB (Rust target dir + Gradle caches)"
    log_warn "consider: export CARGO_TARGET_DIR=/path/on/a/roomier/drive before rerunning"
  fi
}

function ensure_rust_targets() {
  printf "\n"
  log_info "function ensure_rust_targets - install missing Android Rust targets ($ANDROID_ABIS)"
  local installed abi target
  installed="$(rustup target list --installed)"
  for abi in $ANDROID_ABIS; do
    case "$abi" in
      aarch64) target="aarch64-linux-android" ;;
      armv7) target="armv7-linux-androideabi" ;;
      i686) target="i686-linux-android" ;;
      x86_64) target="x86_64-linux-android" ;;
      *)
        log_error "unknown ABI '$abi' (expected: aarch64, armv7, i686, x86_64)"
        exit 1
        ;;
    esac
    if ! grep -qx "$target" <<< "$installed"; then
      log_info "installing missing rust target: $target"
      rustup target add "$target"
    fi
  done
}

function install_frontend_dependencies() {
  printf "\n"
  log_info "function install_frontend_dependencies - npm ci"
  if [ -d node_modules ]; then
    log_info "node_modules already present, skipping npm ci"
  else
    npm ci
  fi
}

function ensure_android_project() {
  printf "\n"
  log_info "function ensure_android_project - generate src-tauri/gen/android if missing"
  if [ -d src-tauri/gen/android ]; then
    log_info "src-tauri/gen/android already exists"
  else
    npx tauri android init
  fi
}

function configure_signing() {
  printf "\n"
  log_info "function configure_signing - wire a release keystore if one is given"
  if [ "$BUILD_VARIANT" != "release" ] || [ -z "${ANDROID_KEYSTORE:-}" ]; then
    log_info "no release keystore configured; leaving signing as-is"
    return
  fi
  if [ ! -f "$ANDROID_KEYSTORE" ]; then
    log_error "ANDROID_KEYSTORE does not exist: $ANDROID_KEYSTORE"
    exit 1
  fi
  local variable
  for variable in ANDROID_KEYSTORE_PASS ANDROID_KEY_ALIAS; do
    if [ -z "${!variable:-}" ]; then
      log_error "$variable must be set alongside ANDROID_KEYSTORE"
      exit 1
    fi
  done

  # Written on every run, never committed: gen/android is regenerated by
  # `tauri android init` (docs/android/SPIKES.md), so anything hand-placed
  # in there is one rebuild away from being gone. The script that needs
  # the file is the script that writes it.
  #
  # An absolute keystore path on purpose - Gradle resolves relative paths
  # against the module directory, several levels below the repo root.
  local properties="src-tauri/gen/android/keystore.properties"
  local keystore_abs
  keystore_abs="$(cd "$(dirname "$ANDROID_KEYSTORE")" && pwd)/$(basename "$ANDROID_KEYSTORE")"
  umask 077
  cat > "$properties" <<PROPERTIES
storeFile=$keystore_abs
storePassword=$ANDROID_KEYSTORE_PASS
keyAlias=$ANDROID_KEY_ALIAS
keyPassword=${ANDROID_KEY_PASS:-$ANDROID_KEYSTORE_PASS}
PROPERTIES
  log_info "wrote $properties (mode 600, ignored by git)"

  # The release build type has to be told to use it. Tauri's generated
  # app/build.gradle.kts signs release with the debug key so a local build
  # is installable; this replaces that with the real signing config when
  # one is available, and is re-applied every run for the same reason the
  # properties file is rewritten.
  apply_signing_config
}

function apply_signing_config() {
  local gradle="src-tauri/gen/android/app/build.gradle.kts"
  if [ ! -f "$gradle" ]; then
    log_error "expected $gradle to exist after 'tauri android init'"
    exit 1
  fi
  if grep -q "hypomnemaReleaseSigning" "$gradle"; then
    log_info "release signing config already present in build.gradle.kts"
    return
  fi
  python3 - "$gradle" <<'PYTHON'
import re, sys

path = sys.argv[1]
source = open(path, encoding="utf-8").read()

block = '''
// hypomnemaReleaseSigning - injected by scripts/android/build-android.sh.
// gen/android is regenerated by `tauri android init`, so this is applied
// on every build rather than committed.
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = java.util.Properties().apply {
    if (keystorePropertiesFile.exists()) {
        load(java.io.FileInputStream(keystorePropertiesFile))
    }
}
'''

marker = "android {"
index = source.index(marker)
source = source[:index] + block + "\n" + source[index:]

signing = '''
    signingConfigs {
        create("release") {
            if (keystoreProperties.containsKey("storeFile")) {
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
            }
        }
    }
'''
index = source.index(marker, source.index(block)) + len(marker)
source = source[:index] + signing + source[index:]

# Point the release build type at it, replacing whatever it signed with.
source = re.sub(
    r'signingConfig = signingConfigs\.getByName\("debug"\)',
    'signingConfig = signingConfigs.getByName("release")',
    source,
    count=1,
)
open(path, "w", encoding="utf-8").write(source)
print("release signing config injected")
PYTHON
}

function build_apk() {
  printf "\n"
  log_info "function build_apk - tauri android build ($BUILD_VARIANT, $ANDROID_ABIS)"
  local variant_flag=()
  if [ "$BUILD_VARIANT" = "debug" ]; then
    variant_flag=(-d)
  fi
  # ANDROID_ABIS is intentionally unquoted: tauri wants each ABI as its own
  # -t argument, and it's a space-separated word list, not a single token.
  # shellcheck disable=SC2086
  npx tauri android build "${variant_flag[@]+"${variant_flag[@]}"}" -t $ANDROID_ABIS --apk true --aab false
}

function collect_artifacts() {
  printf "\n"
  log_info "function collect_artifacts - copy produced APKs into releases/android"
  local version
  version="$(tr -d '[:space:]' < "$REPO_ROOT/VERSION" 2>/dev/null || printf 'dev')"
  local out_dir="$REPO_ROOT/releases/android"
  local dropbox_dir="/mnt/c/Users/user/Dropbox/apk/hypomnema"
  mkdir -p "$out_dir"
  mkdir -p "$dropbox_dir"

  # Build counter, so two APKs of the same VERSION are still tellable
  # apart on the phone: VERSION only moves on a release-worthy change,
  # while a test device sees many builds of the same version in a day.
  local counter_file="$out_dir/.build-number"
  local build_no
  build_no=$(( $(cat "$counter_file" 2>/dev/null || printf 0) + 1 ))
  printf "%s\n" "$build_no" > "$counter_file"
  log_info "build number: b$build_no"

  local apk_dir="$REPO_ROOT/src-tauri/gen/android/app/build/outputs/apk"
  local found=0
  local apk abi_dir variant_dir dest dropbox_dest apk_mtime
  # Gradle keeps every variant it has ever built side by side under
  # outputs/apk/<abi>/<variant>/, so an unfiltered search picks up APKs
  # this run did not produce. Both guards below exist because that once
  # copied a days-old release APK over the debug artifact's name and got
  # installed on a test device as if it were the new build.
  while IFS= read -r apk; do
    variant_dir="$(basename "$(dirname "$apk")")"
    abi_dir="$(basename "$(dirname "$(dirname "$apk")")")"
    apk_mtime="$(stat -c %Y "$apk" 2>/dev/null || printf 0)"
    if [ "$apk_mtime" -lt "$BUILD_STARTED_AT" ]; then
      log_warn "skipping stale APK not produced by this run: $apk"
      continue
    fi
    found=1
    # Named from the file's own path, never from the requested variant.
    local name="Hypomnema-${version}-b${build_no}-${variant_dir}-${abi_dir}.apk"
    dest="$out_dir/$name"
    dropbox_dest="$dropbox_dir/$name"
    cp "$apk" "$dest"
    cp "$apk" "$dropbox_dest"
    log_info "artifact: $dest"
    log_info "Dropbox artifact: $dropbox_dest"
  done < <(find "$apk_dir" -type f -name "*.apk" -path "*/${BUILD_VARIANT}/*" 2>/dev/null)

  if [ "$found" -eq 0 ]; then
    log_error "no APK produced by this run found under $apk_dir"
    exit 1
  fi
}

function main() {
  log_info "function main - build an Android APK for Hypomnema"
  # Cutoff for collect_artifacts' staleness check below.
  BUILD_STARTED_AT="$(date +%s)"
  resolve_repo_root
  resolve_android_sdk
  check_disk_space
  ensure_rust_targets
  install_frontend_dependencies
  ensure_android_project
  configure_signing
  build_apk
  collect_artifacts
  log_info "build finished"
}

check_required_programs
export_env_variables_from_arguments
validate_env_variables

main
