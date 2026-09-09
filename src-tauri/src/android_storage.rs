//! Asking Android for access to the user's files, from the app itself.
//!
//! The vault can live in an ordinary folder, and reaching one on Android
//! 11+ needs `MANAGE_EXTERNAL_STORAGE` - a permission with no runtime
//! dialog. The only way to obtain it is to send the user to a settings
//! screen, which means firing an `Intent`, which means calling into
//! Android.
//!
//! That does not require Kotlin. Tauri exposes the JNI environment
//! through the webview (`PlatformWebview::jni_handle()`), so both halves
//! of the job - "is it granted?" and "ask for it" - live here, in
//! tracked Rust, rather than in `src-tauri/gen/android`, which is
//! regenerated and would lose them (`docs/android/SPIKES.md`).
//!
//! Everything here is best-effort by construction. A JNI call that fails
//! must never take the app down with it: the check answers "no" and the
//! request answers with an error the screen can show, and the app carries
//! on working inside the folders it owns outright.

#![allow(dead_code)]

use crate::error::{Error, Result};

/// How long to wait for the UI thread to answer. The work is a couple of
/// JNI calls; a wait this long only ever expires when the closure is
/// never going to run at all, and hanging a command forever is a worse
/// answer than "no".
#[cfg(target_os = "android")]
const UI_THREAD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Whether this app may read and write ordinary folders on shared
/// storage.
///
/// Always true off Android: every other target this app builds for lets
/// a process read the user's own files, and reporting otherwise would
/// make the desktop show a banner asking for a permission that does not
/// exist there.
#[cfg(not(target_os = "android"))]
pub fn all_files_access<R: tauri::Runtime>(_app: &tauri::AppHandle<R>) -> bool {
    true
}

#[cfg(not(target_os = "android"))]
pub fn request_all_files_access<R: tauri::Runtime>(_app: &tauri::AppHandle<R>) -> Result<()> {
    Err(Error::State(
        "this platform has no all-files-access setting".into(),
    ))
}

#[cfg(target_os = "android")]
pub fn all_files_access<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    on_ui_thread(app, |env, _activity| {
        // isExternalStorageManager landed in API 30. Below that, shared
        // storage is reachable with the legacy permissions the manifest
        // declares, so "granted" is the honest answer.
        if sdk_int(env)? < 30 {
            return Ok(true);
        }
        let class = env.find_class("android/os/Environment")?;
        let granted = env
            .call_static_method(class, "isExternalStorageManager", "()Z", &[])?
            .z()?;
        Ok(granted)
    })
    .unwrap_or(false)
}

/// Opens the system screen where the permission is granted.
///
/// Two actions, because the per-app screen does not exist everywhere: the
/// one that lands directly on this app's entry is tried first, and the
/// whole-list screen is the fallback. Landing the user on a list of every
/// app on the phone is worse than landing on this one, and better than
/// nothing happening when a button is pressed.
#[cfg(target_os = "android")]
pub fn request_all_files_access<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<()> {
    let opened = on_ui_thread(app, |env, activity| {
        if sdk_int(env)? < 30 {
            return Err(Error::State(
                "this Android version has no all-files-access screen".into(),
            ));
        }
        // Not scoped in a block: the JavaStr borrows `name`, and letting
        // `name` fall out of scope at the end of one drops it while that
        // borrow is still alive.
        let name = env
            .call_method(activity, "getPackageName", "()Ljava/lang/String;", &[])?
            .l()?;
        let package: String = env.get_string((&name).into())?.into();
        start_settings_activity(
            env,
            activity,
            "android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION",
            Some(&format!("package:{package}")),
        )
        .or_else(|_| {
            // A pending exception from the first attempt would poison
            // every call after it.
            let _ = env.exception_clear();
            start_settings_activity(
                env,
                activity,
                "android.settings.MANAGE_ALL_FILES_ACCESS_PERMISSION",
                None,
            )
        })?;
        Ok(true)
    })?;
    match opened {
        true => Ok(()),
        false => Err(Error::State(
            "Android did not open the permission screen".into(),
        )),
    }
}

#[cfg(target_os = "android")]
fn sdk_int(env: &mut jni::JNIEnv<'_>) -> Result<i32> {
    let class = env.find_class("android/os/Build$VERSION")?;
    Ok(env.get_static_field(class, "SDK_INT", "I")?.i()?)
}

/// `startActivity(new Intent(action[, Uri.parse(data)]))`.
#[cfg(target_os = "android")]
fn start_settings_activity(
    env: &mut jni::JNIEnv<'_>,
    activity: &jni::objects::JObject<'_>,
    action: &str,
    data: Option<&str>,
) -> Result<()> {
    use jni::objects::JValue;

    let action = env.new_string(action)?;
    let intent_class = env.find_class("android/content/Intent")?;
    let intent = match data {
        Some(uri) => {
            let uri_string = env.new_string(uri)?;
            let uri_class = env.find_class("android/net/Uri")?;
            let uri = env
                .call_static_method(
                    uri_class,
                    "parse",
                    "(Ljava/lang/String;)Landroid/net/Uri;",
                    &[JValue::Object(&uri_string)],
                )?
                .l()?;
            env.new_object(
                intent_class,
                "(Ljava/lang/String;Landroid/net/Uri;)V",
                &[JValue::Object(&action), JValue::Object(&uri)],
            )?
        }
        None => env.new_object(
            intent_class,
            "(Ljava/lang/String;)V",
            &[JValue::Object(&action)],
        )?,
    };
    // FLAG_ACTIVITY_NEW_TASK. Harmless from an Activity, and required if
    // the context handed over ever turns out to be the Application.
    env.call_method(
        &intent,
        "addFlags",
        "(I)Landroid/content/Intent;",
        &[JValue::Int(0x1000_0000)],
    )?;
    env.call_method(
        activity,
        "startActivity",
        "(Landroid/content/Intent;)V",
        &[JValue::Object(&intent)],
    )?;
    Ok(())
}

/// Runs `work` on the Android UI thread and waits for its answer.
///
/// The webview is the way in: Tauri hands out the JNI environment through
/// it, and an app with no webview has no user to ask anyway.
#[cfg(target_os = "android")]
fn on_ui_thread<R, F, T>(app: &tauri::AppHandle<R>, work: F) -> Result<T>
where
    R: tauri::Runtime,
    F: FnOnce(&mut jni::JNIEnv<'_>, &jni::objects::JObject<'_>) -> Result<T> + Send + 'static,
    T: Send + 'static,
{
    use tauri::Manager;

    let webview = app
        .get_webview_window("main")
        .ok_or_else(|| Error::State("no window to ask Android through".into()))?;
    let (tx, rx) = std::sync::mpsc::channel();
    webview
        .with_webview(move |platform| {
            platform.jni_handle().exec(move |env, activity, _webview| {
                let outcome = work(env, activity);
                // Leaving a pending exception behind breaks every JNI
                // call the app makes afterwards, including ones that have
                // nothing to do with permissions.
                if outcome.is_err() {
                    let _ = env.exception_clear();
                }
                let _ = tx.send(outcome);
            });
        })
        .map_err(|e| Error::State(format!("cannot reach Android from the webview: {e}")))?;
    rx.recv_timeout(UI_THREAD_TIMEOUT)
        .map_err(|_| Error::State("Android did not answer in time".into()))?
}

#[cfg(target_os = "android")]
impl From<jni::errors::Error> for Error {
    fn from(e: jni::errors::Error) -> Self {
        Error::State(format!("Android call failed: {e}"))
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn off_android_the_app_never_claims_a_permission_is_missing() {
        // The desktop has no such setting, and a banner asking for one
        // would be an instruction the user cannot follow.
        #[cfg(not(target_os = "android"))]
        {
            // Compile-time shape check: the stub takes an app handle and
            // answers without touching Android. Exercised for real by the
            // command in lib.rs.
            fn _assert_signature<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
                super::all_files_access(app)
            }
        }
    }
}
