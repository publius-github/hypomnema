#!/usr/bin/env bash
# Builds an Android APK and copies it into releases/android/ (and, when
# APK_COPY_DIR is set, into that folder too - e.g. a synced folder a test
# phone installs from).
#
# Artifacts are named Hypomnema-<version>-b<build>-<variant>-<abi>.apk. The
# build number comes from releases/android/.build-number and increments per
# run: VERSION only moves on a release-worthy change, so without it a test
# device cannot tell two builds of the same version apart.
#
# Usage: scripts/android/build.sh [debug|release]   (default: release)
# Env overrides:
#   ANDROID_ABIS       space-separated ABIs to build (default: aarch64)
#                       one or more of: aarch64 armv7 i686 x86_64
#   ANDROID_HOME        Android SDK root (required)
#   ANDROID_NDK_HOME    NDK root (auto-detected under $ANDROID_HOME/ndk if unset)
#   JAVA_HOME           JDK root (auto-detected from `java` on PATH if unset)
#   PRUNE_DAYS          build output untouched this many days is pruned
#                       before the build (default: 7)
#   CARGO_TARGET_DIR    override if the repo's drive is low on space (see
#                       check_disk_space below) - an Android build adds
#                       several GB across Rust + Gradle caches
#   ANDROID_KEYSTORE       path to a release keystore (.jks). Without it a
#                          release build is signed with the debug key:
#                          installable for testing, not publishable.
#   ANDROID_KEYSTORE_PASS  store password
#   ANDROID_KEY_ALIAS      key alias inside the store
#   ANDROID_KEY_PASS       key password (defaults to the store password)
#   APK_COPY_DIR           optional extra folder every produced APK is
#                          copied to (created if missing)
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

REQUIRED_PROGRAMS=(node npm cargo rustup java python3)
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
      log_error "usage: scripts/android/build.sh [debug|release] (default: release)"
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

# Cargo keeps every old build of every unit; drop the ones untouched for
# PRUNE_DAYS (default 7) before adding a new one. Honors CARGO_TARGET_DIR.
# Best effort: a failed prune never stops the build.
function prune_target() {
  printf "\n"
  log_info "function prune_target - remove stale build output from the Cargo target dir"
  node scripts/general/prune-target.mjs || log_warn "pruning the target dir failed; continuing with the build"
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

function platform_cli_package() {
  # The tauri CLI's per-platform binary is a reliable proxy for which OS the
  # whole node_modules was installed for: the build runs it, and npm installs
  # it as a per-platform optional dep alongside the other native binaries
  # (rolldown's binding). It used to be @esbuild/<platform>, which left the
  # tree with Vite 8 - so the check took every node_modules for a foreign one.
  local platform
  platform="$(node -p 'process.platform + "-" + process.arch')"
  case "$platform" in
    linux-x64) printf '@tauri-apps/cli-linux-x64-gnu' ;;
    linux-arm64) printf '@tauri-apps/cli-linux-arm64-gnu' ;;
    darwin-x64) printf '@tauri-apps/cli-darwin-x64' ;;
    darwin-arm64) printf '@tauri-apps/cli-darwin-arm64' ;;
    win32-x64) printf '@tauri-apps/cli-win32-x64-msvc' ;;
    *) printf '' ;;
  esac
}

function install_frontend_dependencies() {
  printf "\n"
  log_info "function install_frontend_dependencies - install node_modules for this platform"
  # node_modules can sit on a drive shared with a Windows checkout. npm installs
  # native binaries (rolldown, the tauri CLI) as per-platform optional
  # deps, and its optional-deps bug (npm/cli#4828) means an install done for one
  # OS omits the others' binaries. Under WSL that surfaces as vite
  # failing to load its native binding, or the tauri CLI failing to load. So a present
  # node_modules is not enough - it also has to match this platform.
  local expected
  expected="$(platform_cli_package)"
  if [ ! -d node_modules ]; then
    npm ci
  elif [ -z "$expected" ]; then
    log_warn "unrecognized platform; cannot verify node_modules, leaving it as-is"
  elif [ -d "node_modules/$expected" ]; then
    log_info "node_modules already present and built for this platform ($expected)"
  else
    log_warn "node_modules is missing $expected: it was installed for another OS"
    log_warn "(shared drive between Windows and WSL). Reinstalling for this platform."
    npm ci
  fi
  if [ -n "$expected" ] && [ ! -d "node_modules/$expected" ]; then
    log_error "node_modules still missing $expected after install (npm/cli#4828?)"
    exit 1
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

function sync_launcher_icons() {
  printf "\n"
  log_info "function sync_launcher_icons - copy the committed launcher icons into gen/android"
  # src-tauri/icons/android holds the output of
  # `npx tauri icon src-tauri/icons/icon-manifest.json`; the CLI writes
  # it straight into gen/android, which is regenerated and never
  # committed, so the copy kept beside icon.svg is what every build uses.
  local res="src-tauri/gen/android/app/src/main/res"
  if [ ! -d "$res" ]; then
    log_error "expected $res to exist after 'tauri android init'"
    exit 1
  fi
  cp -R src-tauri/icons/android/. "$res/"
}

function configure_storage_permission() {
  printf "\n"
  log_info "function configure_storage_permission - let the folder browser see shared storage"
  local manifest="src-tauri/gen/android/app/src/main/AndroidManifest.xml"
  if [ ! -f "$manifest" ]; then
    log_error "expected $manifest to exist after 'tauri android init'"
    exit 1
  fi
  if grep -q "MANAGE_EXTERNAL_STORAGE" "$manifest"; then
    log_info "storage permissions already declared"
    return
  fi
  # Applied on every run for the same reason the signing config is:
  # gen/android is regenerated by 'tauri android init', so a hand-edit in
  # there is one rebuild away from being gone.
  #
  # Declaring the permission is only half of it - MANAGE_EXTERNAL_STORAGE
  # is granted by hand, once, in Settings > Apps > Special app access >
  # All files access. Until then the app still reaches its own folders,
  # and the in-app browser reports which directories it cannot read
  # rather than showing them as empty.
  python3 - "$manifest" <<'MANIFEST_PY'
import sys

path = sys.argv[1]
source = open(path, encoding="utf-8").read()

anchor = '<uses-permission android:name="android.permission.INTERNET" />'
block = anchor + """

    <!-- Injected by scripts/android/build.sh: the vault can live
         in an ordinary folder, and browsing to one needs shared storage.
         MANAGE_EXTERNAL_STORAGE is granted by hand in Settings > Apps >
         Special app access > All files access. -->
    <uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />
    <uses-permission
        android:name="android.permission.READ_EXTERNAL_STORAGE"
        android:maxSdkVersion="29" />
    <uses-permission
        android:name="android.permission.WRITE_EXTERNAL_STORAGE"
        android:maxSdkVersion="29" />"""
if anchor not in source:
    raise SystemExit("AndroidManifest.xml has no INTERNET permission to anchor to")
source = source.replace(anchor, block, 1)

# Android 10 predates MANAGE_EXTERNAL_STORAGE and needs the scoped-storage
# opt-out instead.
source = source.replace(
    "    <application\n",
    '    <application\n        android:requestLegacyExternalStorage="true"\n',
    1,
)
open(path, "w", encoding="utf-8").write(source)
print("storage permissions injected")
MANIFEST_PY
}

function configure_backup() {
  printf "\n"
  log_info "function configure_backup - keep the vault out of Android's cloud backup"
  local manifest="src-tauri/gen/android/app/src/main/AndroidManifest.xml"
  if [ ! -f "$manifest" ]; then
    log_error "expected $manifest to exist after 'tauri android init'"
    exit 1
  fi
  if grep -q "android:allowBackup" "$manifest"; then
    log_info "backup already turned off"
    return
  fi
  # Android's Auto Backup is on unless the manifest says otherwise, and it
  # copies the app's internal files and getExternalFilesDir() - where the
  # default vault lives - to the user's Google backup. A journal must not
  # leave the device behind the user's back, and a restored device-id
  # would give a new phone the old one's identity in the sync log. Drive
  # sync is the app's one way to move a vault, and the user turns it on.
  python3 - "$manifest" <<'MANIFEST_PY'
import sys

path = sys.argv[1]
source = open(path, encoding="utf-8").read()
anchor = "    <application\n"
if anchor not in source:
    raise SystemExit("AndroidManifest.xml has no <application> element to patch")
source = source.replace(
    anchor,
    anchor
    + '        android:allowBackup="false"\n'
    + '        android:fullBackupContent="false"\n',
    1,
)
open(path, "w", encoding="utf-8").write(source)
print("backup turned off")
MANIFEST_PY
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
  # `tauri android init` (docs/android/ARCHITECTURE.md), so anything hand-placed
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
// hypomnemaReleaseSigning - injected by scripts/android/build.sh.
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

function check_android_notices() {
  printf "\n"
  log_info "function check_android_notices - compare notices/android-libraries.txt with the release runtime classpath"
  local notices="$REPO_ROOT/scripts/general/notices/android-libraries.txt"
  local resolved listed
  # Gradle prints the resolved tree; one coordinate per line comes out of
  # it: "a:b:1.0 -> 1.2" resolves to 1.2, "(c)" constraints and "(*)"
  # repeats keep their coordinate, "(n)" unresolved lines and project
  # modules are not libraries, BOMs ship no code (same rule as the list).
  resolved="$(cd "$REPO_ROOT/src-tauri/gen/android" && ./gradlew -q :app:dependencies --configuration universalReleaseRuntimeClasspath | awk '
    /^[|+\\ -]*--- / {
      line = $0
      sub(/^[|+\\ -]*--- /, "", line)
      if (line ~ /^project /) next
      if (line ~ /\(n\)$/) next
      sub(/ \([*c]\)$/, "", line)
      if (index(line, " -> ") > 0) {
        split(line, halves, " -> ")
        split(halves[1], parts, ":")
        line = parts[1] ":" parts[2] ":" halves[2]
      }
      if (line !~ /^[^:]+:[^:]+:[^:]+$/) next
      if (line ~ /-bom:/) next
      print line
    }' | sort -u)"
  if [ -z "$resolved" ]; then
    log_error "gradle reported no resolved libraries; the classpath configuration name may have changed"
    exit 1
  fi
  listed="$(grep -v '^#' "$notices" | grep -v '^[[:space:]]*$' | cut -f1 | sort -u)"
  local missing extra
  missing="$(comm -23 <(printf '%s\n' "$resolved") <(printf '%s\n' "$listed"))"
  extra="$(comm -13 <(printf '%s\n' "$resolved") <(printf '%s\n' "$listed"))"
  if [ -n "$missing" ] || [ -n "$extra" ]; then
    log_error "scripts/general/notices/android-libraries.txt does not match the release runtime classpath"
    if [ -n "$missing" ]; then
      log_error "in the APK but not in the list (add with the license its POM declares):"
      printf '%s\n' "$missing" >&2
    fi
    if [ -n "$extra" ]; then
      log_error "in the list but not in the APK (remove):"
      printf '%s\n' "$extra" >&2
    fi
    log_error "then run: node scripts/general/third-party-licenses.mjs"
    exit 1
  fi
  log_info "android-libraries.txt matches the classpath ($(printf '%s\n' "$resolved" | wc -l | tr -d ' ') libraries)"
}

function build_apk() {
  printf "\n"
  log_info "function build_apk - tauri android build ($BUILD_VARIANT, $ANDROID_ABIS)"
  local variant_flag=()
  if [ "$BUILD_VARIANT" = "debug" ]; then
    variant_flag=(-d)
  fi
  # --apk only: an APK, no AAB (Tauri CLI 2.11 takes both as bare flags)
  # ANDROID_ABIS is intentionally unquoted: tauri wants each ABI as its own
  # -t argument, and it's a space-separated word list, not a single token.
  # shellcheck disable=SC2086
  npx tauri android build "${variant_flag[@]+"${variant_flag[@]}"}" -t $ANDROID_ABIS --apk
}

function clear_previous_apks() {
  printf "\n"
  log_info "function clear_previous_apks - remove this variant's APKs from earlier runs"
  # With no input changed Gradle calls packaging up to date and leaves
  # the old APK in place, which collect_artifacts' staleness check then
  # refuses as not produced by this run. With the output gone Gradle
  # packages again, so a rebuild of an unchanged tree still yields an APK.
  local apk_dir="$REPO_ROOT/src-tauri/gen/android/app/build/outputs/apk"
  find "$apk_dir" -type f -name "*.apk" -path "*/${BUILD_VARIANT}/*" -delete 2>/dev/null || true
}

function collect_artifacts() {
  printf "\n"
  log_info "function collect_artifacts - copy produced APKs into releases/android"
  local version
  version="$(tr -d '[:space:]' < "$REPO_ROOT/VERSION" 2>/dev/null || printf 'dev')"
  local out_dir="$REPO_ROOT/releases/android"
  local copy_dir="${APK_COPY_DIR:-}"
  mkdir -p "$out_dir"
  if [ -n "$copy_dir" ]; then
    mkdir -p "$copy_dir"
  fi

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
  local apk abi_dir variant_dir dest apk_mtime
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
    cp "$apk" "$dest"
    log_info "artifact: $dest"
    if [ -n "$copy_dir" ]; then
      cp "$apk" "$copy_dir/$name"
      log_info "copied to: $copy_dir/$name"
    fi
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
  prune_target
  check_disk_space
  ensure_rust_targets
  install_frontend_dependencies
  ensure_android_project
  sync_launcher_icons
  configure_storage_permission
  configure_backup
  configure_signing
  clear_previous_apks
  build_apk
  # After the build, not before: Gradle cannot evaluate a freshly generated
  # gen/android until `tauri android build` has written tauri.settings.gradle
  # into it. Still before collect_artifacts, so a mismatch ships no APK.
  check_android_notices
  collect_artifacts
  log_info "build finished"
}

check_required_programs
export_env_variables_from_arguments
validate_env_variables

main
