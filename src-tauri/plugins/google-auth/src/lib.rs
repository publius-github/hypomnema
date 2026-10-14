//! Google sign-in on Android for Hypomnema.
//!
//! The Kotlin half (`android/`) wraps Google Identity Services'
//! `AuthorizationClient`: it shows the account picker and consent screen
//! when asked to, and otherwise hands back an access token for
//! `drive.appdata` that Play services keeps fresh. This half is the
//! typed Rust face of it; the app reaches it through `GoogleAuthExt`.
//!
//! Every call blocks until the Kotlin side answers (an interactive
//! authorize waits for the user), so call from a blocking thread, never
//! from the main one.
//!
//! Android only: the app depends on this crate for that target alone,
//! and on any other the crate is empty.
#![cfg(target_os = "android")]

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{mobile::PluginInvokeError, Builder, PluginHandle, TauriPlugin},
    Manager, Runtime,
};

/// The error code Kotlin rejects with when a silent authorize would
/// need a screen: the grant was withdrawn, or the account is gone.
pub const CONSENT_REQUIRED: &str = "CONSENT_REQUIRED";

#[derive(Debug, Clone)]
pub struct Error {
    pub code: Option<String>,
    pub message: String,
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for Error {}

impl From<PluginInvokeError> for Error {
    fn from(e: PluginInvokeError) -> Self {
        match e {
            PluginInvokeError::InvokeRejected(response) => Error {
                code: response.code.clone(),
                message: response
                    .message
                    .clone()
                    .unwrap_or_else(|| "Google sign-in failed".into()),
            },
            other => Error {
                code: None,
                message: format!("Google sign-in failed: {other}"),
            },
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthorizeArgs<'a> {
    interactive: bool,
    email: Option<&'a str>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Authorization {
    access_token: String,
}

/// The plugin's handle, kept in Tauri's state.
pub struct GoogleAuth<R: Runtime> {
    handle: PluginHandle<R>,
}

impl<R: Runtime> GoogleAuth<R> {
    /// An access token for the app's Drive folder. `interactive` lets
    /// Google show its account picker and consent screen; without it a
    /// grant that needs the user fails with `CONSENT_REQUIRED`. `email`
    /// pins the account signed in before.
    pub fn authorize(&self, interactive: bool, email: Option<&str>) -> Result<String, Error> {
        let reply: Authorization = self
            .handle
            .run_mobile_plugin("authorize", AuthorizeArgs { interactive, email })?;
        Ok(reply.access_token)
    }

    /// Forgets a cached token that Drive refused, so the next
    /// `authorize` mints a new one instead of handing it back.
    pub fn clear_token(&self, token: &str) -> Result<(), Error> {
        #[derive(Serialize)]
        struct Args<'a> {
            token: &'a str,
        }
        self.handle
            .run_mobile_plugin::<serde_json::Value>("clearToken", Args { token })?;
        Ok(())
    }

    /// Withdraws the app's access for `email` (sign-out).
    pub fn revoke(&self, email: &str) -> Result<(), Error> {
        #[derive(Serialize)]
        struct Args<'a> {
            email: &'a str,
        }
        self.handle
            .run_mobile_plugin::<serde_json::Value>("revoke", Args { email })?;
        Ok(())
    }
}

impl<R: Runtime> GoogleAuth<R> {
    /// Holds the app in the foreground (a notification and a foreground
    /// service) while `on`, so a sync pass survives the user putting the
    /// app away. Best effort: Android may refuse the start.
    pub fn keep_alive(&self, on: bool) -> Result<(), Error> {
        #[derive(Serialize)]
        struct Args {
            on: bool,
        }
        self.handle
            .run_mobile_plugin::<serde_json::Value>("keepAlive", Args { on })?;
        Ok(())
    }
}

/// `app.google_auth()` from anything that reaches the app.
pub trait GoogleAuthExt<R: Runtime> {
    fn google_auth(&self) -> &GoogleAuth<R>;
}

impl<R: Runtime, T: Manager<R>> GoogleAuthExt<R> for T {
    fn google_auth(&self) -> &GoogleAuth<R> {
        self.state::<GoogleAuth<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("google-auth")
        .setup(|app, api| {
            let handle =
                api.register_android_plugin("com.hypomnema.googleauth", "GoogleAuthPlugin")?;
            app.manage(GoogleAuth { handle });
            Ok(())
        })
        .build()
}
