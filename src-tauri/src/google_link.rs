//! This device's Google sign-in: which account, and a usable access token.
//!
//! Two files in the app's private config dir (never the vault, never
//! anything synced; on Android only the first, since Play services keeps
//! the grant there):
//! - `google-account.json` - email, name and Drive permission id. Plain:
//!   it is what the screen shows, and it must be readable on a locked
//!   device to say who is signed in.
//! - `google.json` - the tokens, through `secret_store.rs`, so the device
//!   passphrase seals them like the Dropbox ones. The refresh token is a
//!   standing grant to the app's Drive folder.
//!
//! `valid_access_token` refreshes ahead of expiry, so a sync pass never
//! has to unwind halfway through on a 401.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{Error, Result};
use crate::google_auth::{self, GoogleTokens};
use crate::secret_store;
use crate::sync_dropbox_oauth::OauthTransport;
use crate::sync_gdrive::DriveUser;

const TOKENS_FILE: &str = "google.json";
const ACCOUNT_FILE: &str = "google-account.json";

/// Refresh this long before the token actually expires.
const EXPIRY_SKEW_SECS: i64 = 300;

/// Every file `secret_store` seals when the lock is turned on.
pub const SECRET_FILES: &[&str] = &[TOKENS_FILE];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct StoredTokens {
    refresh_token: String,
    access_token: String,
    expires_at_unix: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Account {
    pub email: String,
    pub name: String,
    pub permission_id: String,
}

/// What Settings shows about the Google sign-in.
#[derive(Debug, Clone, Serialize, TS, PartialEq, Eq)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct GoogleStatus {
    /// This build can sign in at all: the desktop client secret was
    /// compiled in, and the platform has a sign-in flow.
    pub available: bool,
    pub signed_in: bool,
    pub email: Option<String>,
    pub name: Option<String>,
}

pub fn account(config_dir: &Path) -> Option<Account> {
    let text = fs::read_to_string(config_dir.join(ACCOUNT_FILE)).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn is_signed_in(config_dir: &Path) -> bool {
    account(config_dir).is_some()
}

pub fn status(config_dir: &Path, available: bool) -> GoogleStatus {
    let account = account(config_dir);
    GoogleStatus {
        available,
        signed_in: account.is_some(),
        email: account.as_ref().map(|a| a.email.clone()),
        name: account.map(|a| a.name),
    }
}

/// The sync space this account's manifest lives in on a vault
/// (`sync_bootstrap::set_space`): a different account is a different
/// remote and must start clean.
pub fn space_name(account: &Account) -> String {
    let id: String = account
        .permission_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(100)
        .collect();
    format!("gdrive-{id}")
}

/// Records a fresh sign-in.
pub fn store(
    config_dir: &Path,
    tokens: &GoogleTokens,
    user: &DriveUser,
    now_unix: i64,
) -> Result<Account> {
    let refresh_token = tokens
        .refresh_token
        .clone()
        .ok_or_else(|| Error::State("Google returned no refresh token - sign in again".into()))?;
    let stored = StoredTokens {
        refresh_token,
        access_token: tokens.access_token.clone(),
        expires_at_unix: now_unix + tokens.expires_in_secs,
    };
    save_tokens(config_dir, &stored)?;
    store_account(config_dir, user)
}

/// Records who is signed in. On its own on Android, where Play services
/// keeps the grant and this app stores no tokens at all.
pub fn store_account(config_dir: &Path, user: &DriveUser) -> Result<Account> {
    let account = Account {
        email: user.email.clone(),
        name: user.name.clone(),
        permission_id: user.permission_id.clone(),
    };
    let text = serde_json::to_string_pretty(&account)
        .map_err(|e| Error::State(format!("cannot serialize the Google account: {e}")))?;
    fs::create_dir_all(config_dir)?;
    fs::write(config_dir.join(ACCOUNT_FILE), text)?;
    Ok(account)
}

fn load_tokens(config_dir: &Path) -> Result<Option<StoredTokens>> {
    let Some(bytes) = secret_store::read_secret(config_dir, TOKENS_FILE)? else {
        return Ok(None);
    };
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|e| Error::State(format!("unreadable Google token file: {e}")))
}

fn save_tokens(config_dir: &Path, tokens: &StoredTokens) -> Result<()> {
    let text = serde_json::to_string_pretty(tokens)
        .map_err(|e| Error::State(format!("cannot serialize Google tokens: {e}")))?;
    secret_store::write_secret(config_dir, TOKENS_FILE, text.as_bytes())
}

/// The refresh token, for revoking it on sign-out.
pub fn refresh_token(config_dir: &Path) -> Option<String> {
    load_tokens(config_dir)
        .ok()
        .flatten()
        .map(|t| t.refresh_token)
}

/// Forgets the sign-in. Missing files are success.
pub fn clear(config_dir: &Path) -> Result<()> {
    for name in [TOKENS_FILE, ACCOUNT_FILE] {
        let path = config_dir.join(name);
        if path.is_file() {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}

/// An access token good to use right now, refreshed first when the stored
/// one is at or near expiry.
pub fn valid_access_token<T: OauthTransport>(
    config_dir: &Path,
    transport: &T,
    now_unix: i64,
) -> Result<String> {
    let stored = load_tokens(config_dir)?
        .ok_or_else(|| Error::State("this device is not signed in to Google".into()))?;
    if now_unix < stored.expires_at_unix - EXPIRY_SKEW_SECS {
        return Ok(stored.access_token);
    }
    let refreshed = google_auth::refresh_access_token(transport, &stored.refresh_token)?;
    let updated = StoredTokens {
        // Google keeps the refresh token valid across refreshes; a new
        // one only arrives if it was rotated.
        refresh_token: refreshed
            .refresh_token
            .clone()
            .unwrap_or(stored.refresh_token),
        access_token: refreshed.access_token.clone(),
        expires_at_unix: now_unix + refreshed.expires_in_secs,
    };
    save_tokens(config_dir, &updated)?;
    Ok(refreshed.access_token)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::cell::RefCell;
    use std::path::PathBuf;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hypomnema-google-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    struct NeverCalled;
    impl OauthTransport for NeverCalled {
        fn post_form(&self, _url: &str, _form: &[(&str, &str)]) -> Result<Value> {
            panic!("no token request expected");
        }
    }

    struct Calls(RefCell<usize>);
    impl OauthTransport for Calls {
        fn post_form(&self, _url: &str, _form: &[(&str, &str)]) -> Result<Value> {
            *self.0.borrow_mut() += 1;
            Ok(serde_json::json!({ "access_token": "fresh", "expires_in": 3600 }))
        }
    }

    fn user() -> DriveUser {
        DriveUser {
            email: "a@x.com".into(),
            name: "A".into(),
            permission_id: "07/12".into(),
        }
    }

    fn tokens() -> GoogleTokens {
        GoogleTokens {
            access_token: "at".into(),
            refresh_token: Some("rt".into()),
            expires_in_secs: 3600,
        }
    }

    #[test]
    fn a_sign_in_is_remembered_and_forgotten() {
        let dir = temp_dir("roundtrip");
        assert!(!status(&dir, true).signed_in);

        store(&dir, &tokens(), &user(), 1000).unwrap();
        let shown = status(&dir, true);
        assert!(shown.signed_in);
        assert_eq!(shown.email.as_deref(), Some("a@x.com"));
        assert_eq!(refresh_token(&dir).as_deref(), Some("rt"));

        clear(&dir).unwrap();
        assert!(!is_signed_in(&dir));
        assert!(refresh_token(&dir).is_none());
    }

    #[test]
    fn a_sign_in_without_a_refresh_token_is_refused() {
        let dir = temp_dir("no-refresh");
        let mut t = tokens();
        t.refresh_token = None;
        assert!(store(&dir, &t, &user(), 0).is_err());
        assert!(!is_signed_in(&dir));
    }

    #[test]
    fn a_fresh_token_is_used_as_is() {
        let dir = temp_dir("fresh");
        store(&dir, &tokens(), &user(), 1000).unwrap();
        assert_eq!(
            valid_access_token(&dir, &NeverCalled, 1000 + 60).unwrap(),
            "at"
        );
    }

    #[test]
    fn the_space_name_keeps_only_safe_characters() {
        let account = Account {
            email: String::new(),
            name: String::new(),
            permission_id: "07/12..x".into(),
        };
        assert_eq!(space_name(&account), "gdrive-0712x");
    }

    #[test]
    fn an_expiring_token_is_refreshed_and_saved() {
        // Only reachable with a client secret compiled in; without one
        // the refresh is refused before any request, which is the other
        // half of this behavior.
        let dir = temp_dir("refresh");
        store(&dir, &tokens(), &user(), 1000).unwrap();
        let transport = Calls(RefCell::new(0));
        let result = valid_access_token(&dir, &transport, 1000 + 3500);
        match google_auth::client_secret() {
            Some(_) => {
                assert_eq!(result.unwrap(), "fresh");
                assert_eq!(*transport.0.borrow(), 1);
                assert_eq!(
                    valid_access_token(&dir, &NeverCalled, 1000 + 3500).unwrap(),
                    "fresh"
                );
            }
            None => {
                assert!(result.unwrap_err().to_string().contains("client secret"));
                assert_eq!(*transport.0.borrow(), 0);
            }
        }
    }
}
