// No JS commands: the Rust core calls the Kotlin side directly through
// `run_mobile_plugin`, so nothing here needs a permission.
const COMMANDS: &[&str] = &[];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
