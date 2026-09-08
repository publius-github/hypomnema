//! Linking one device to a Dropbox App folder: where the tokens live, and
//! keeping a usable access token in hand. docs/android/ROADMAP.md Phase 1.
//!
//! The token file lives in the app's **private config dir**, never in the
//! vault and never in anything synced - on Android that's app-private
//! storage no other app can read. That placement is also why the tokens
//! are plain JSON for now rather than encrypted: keystore-backed
//! encryption is Phase 4, and it protects against a rooted/stolen device,
//! not against other apps.
//!
//! Access tokens from Dropbox are short-lived (hours); the refresh token
//! is the long-lived one. `valid_access_token` hides that: it refreshes
//! slightly *before* expiry rather than waiting for a 401, so a sync pass
//! never has to unwind halfway through.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{Error, Result};
use crate::sync_dropbox_oauth::{self, DropboxTokens, OauthTransport};

/// Refresh this long before the token actually expires, so a request
/// started just under the wire doesn't land just over it.
const EXPIRY_SKEW_SECS: i64 = 300;

const TOKENS_FILE: &str = "dropbox.json";

/// Tokens as persisted between app launches.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredTokens {
    /// The long-lived one; only ever obtained on the initial code
    /// exchange, and only when the authorize URL asked for offline access.
    pub refresh_token: String,
    pub access_token: String,
    /// Unix seconds.
    pub expires_at_unix: i64,
}

/// What the vault-linking screen shows about this device's link.
#[derive(Debug, Clone, Serialize, TS, PartialEq, Eq)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct DropboxStatus {
    pub connected: bool,
    /// Seconds until the current access token needs refreshing; 0 when
    /// not connected. Shown mostly so a first-run test can see that the
    /// refresh path is real and not a stub.
    #[ts(type = "number")]
    pub expires_in_secs: i64,
}

/// What the link screen's smoke test found in the App folder. The counts
/// matter as much as the list: an empty `files` with a non-zero `folders`
/// says the directory tree arrived but its contents did not, which is a
/// different problem from an empty app folder.
#[derive(Debug, Clone, Serialize, TS, PartialEq, Eq)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct DropboxListing {
    pub files: Vec<String>,
    #[ts(type = "number")]
    pub folders: usize,
    #[ts(type = "number")]
    pub deleted: usize,
}

pub fn tokens_file(config_dir: &Path) -> PathBuf {
    config_dir.join(TOKENS_FILE)
}

pub fn load(config_dir: &Path) -> Result<Option<StoredTokens>> {
    let path = tokens_file(config_dir);
    if !path.is_file() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path)?;
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|e| Error::State(format!("unreadable Dropbox token file: {e}")))
}

pub fn save(config_dir: &Path, tokens: &StoredTokens) -> Result<()> {
    fs::create_dir_all(config_dir)?;
    let text = serde_json::to_string_pretty(tokens)
        .map_err(|e| Error::State(format!("cannot serialize Dropbox tokens: {e}")))?;
    fs::write(tokens_file(config_dir), text)?;
    Ok(())
}

/// Unlink this device. Missing file is success - the caller asked for
/// "not linked", and that's the state either way.
pub fn clear(config_dir: &Path) -> Result<()> {
    let path = tokens_file(config_dir);
    if path.is_file() {
        fs::remove_file(path)?;
    }
    Ok(())
}

/// Persist what the initial code exchange returned.
pub fn store_initial(
    config_dir: &Path,
    tokens: &DropboxTokens,
    now_unix: i64,
) -> Result<StoredTokens> {
    let refresh_token = tokens.refresh_token.clone().ok_or_else(|| {
        Error::State(
            "Dropbox returned no refresh token - the authorize URL must ask for \
             token_access_type=offline"
                .into(),
        )
    })?;
    let stored = StoredTokens {
        refresh_token,
        access_token: tokens.access_token.clone(),
        expires_at_unix: now_unix + tokens.expires_in_secs,
    };
    save(config_dir, &stored)?;
    Ok(stored)
}

pub fn status(config_dir: &Path, now_unix: i64) -> Result<DropboxStatus> {
    Ok(match load(config_dir)? {
        None => DropboxStatus {
            connected: false,
            expires_in_secs: 0,
        },
        Some(tokens) => DropboxStatus {
            connected: true,
            expires_in_secs: (tokens.expires_at_unix - now_unix).max(0),
        },
    })
}

/// An access token good to use right now, refreshing it first if the
/// stored one is at or near expiry. Errors if this device isn't linked.
pub fn valid_access_token<T: OauthTransport>(
    config_dir: &Path,
    transport: &T,
    now_unix: i64,
) -> Result<String> {
    let stored = load(config_dir)?
        .ok_or_else(|| Error::State("this device is not linked to Dropbox yet".into()))?;
    if now_unix < stored.expires_at_unix - EXPIRY_SKEW_SECS {
        return Ok(stored.access_token);
    }
    let refreshed = sync_dropbox_oauth::refresh_access_token(transport, &stored.refresh_token)?;
    let updated = StoredTokens {
        // A refresh response carries no new refresh token; the existing
        // one stays valid until the user revokes access.
        refresh_token: stored.refresh_token,
        access_token: refreshed.access_token.clone(),
        expires_at_unix: now_unix + refreshed.expires_in_secs,
    };
    save(config_dir, &updated)?;
    Ok(refreshed.access_token)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::cell::RefCell;

    struct MockOauth {
        response: RefCell<Option<Value>>,
        calls: RefCell<usize>,
    }

    impl MockOauth {
        fn returning(response: Value) -> Self {
            Self {
                response: RefCell::new(Some(response)),
                calls: RefCell::new(0),
            }
        }

        fn never_called() -> Self {
            Self {
                response: RefCell::new(None),
                calls: RefCell::new(0),
            }
        }
    }

    impl OauthTransport for MockOauth {
        fn post_form(&self, _url: &str, _form: &[(&str, &str)]) -> Result<Value> {
            *self.calls.borrow_mut() += 1;
            Ok(self
                .response
                .borrow_mut()
                .take()
                .expect("transport called when the test expected no refresh"))
        }
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hypomnema-dropbox-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn tokens(expires_at_unix: i64) -> StoredTokens {
        StoredTokens {
            refresh_token: "refresh-1".into(),
            access_token: "access-1".into(),
            expires_at_unix,
        }
    }

    #[test]
    fn unlinked_device_reports_not_connected() {
        let dir = temp_dir("unlinked");
        assert_eq!(
            status(&dir, 1_000).unwrap(),
            DropboxStatus {
                connected: false,
                expires_in_secs: 0,
            }
        );
    }

    #[test]
    fn tokens_round_trip_through_the_file() {
        let dir = temp_dir("round-trip");
        let stored = tokens(5_000);
        save(&dir, &stored).unwrap();
        assert_eq!(load(&dir).unwrap(), Some(stored));
        assert_eq!(
            status(&dir, 1_000).unwrap(),
            DropboxStatus {
                connected: true,
                expires_in_secs: 4_000,
            }
        );
    }

    #[test]
    fn initial_exchange_without_a_refresh_token_is_rejected() {
        let dir = temp_dir("no-refresh");
        let err = store_initial(
            &dir,
            &DropboxTokens {
                access_token: "access-1".into(),
                refresh_token: None,
                expires_in_secs: 14_400,
            },
            1_000,
        )
        .unwrap_err();

        assert!(matches!(err, Error::State(_)));
        // Nothing half-written: the device stays unlinked.
        assert_eq!(load(&dir).unwrap(), None);
    }

    #[test]
    fn initial_exchange_stores_an_absolute_expiry() {
        let dir = temp_dir("initial");
        let stored = store_initial(
            &dir,
            &DropboxTokens {
                access_token: "access-1".into(),
                refresh_token: Some("refresh-1".into()),
                expires_in_secs: 14_400,
            },
            1_000,
        )
        .unwrap();

        assert_eq!(stored.expires_at_unix, 15_400);
        assert_eq!(load(&dir).unwrap(), Some(stored));
    }

    #[test]
    fn a_live_token_is_returned_without_touching_the_network() {
        let dir = temp_dir("live");
        save(&dir, &tokens(10_000)).unwrap();
        let transport = MockOauth::never_called();

        let token = valid_access_token(&dir, &transport, 1_000).unwrap();

        assert_eq!(token, "access-1");
        assert_eq!(*transport.calls.borrow(), 0);
    }

    #[test]
    fn a_token_inside_the_skew_window_is_refreshed_early() {
        let dir = temp_dir("skew");
        save(&dir, &tokens(10_000)).unwrap();
        let transport = MockOauth::returning(json!({
            "access_token": "access-2",
            "expires_in": 14_400,
        }));

        // Still valid for another 200s, but inside EXPIRY_SKEW_SECS.
        let token = valid_access_token(&dir, &transport, 9_800).unwrap();

        assert_eq!(token, "access-2");
        assert_eq!(*transport.calls.borrow(), 1);
        let stored = load(&dir).unwrap().unwrap();
        assert_eq!(stored.access_token, "access-2");
        assert_eq!(stored.expires_at_unix, 9_800 + 14_400);
        // The refresh token survives a refresh that didn't return one.
        assert_eq!(stored.refresh_token, "refresh-1");
    }

    #[test]
    fn an_unlinked_device_cannot_produce_a_token() {
        let dir = temp_dir("no-tokens");
        let transport = MockOauth::never_called();
        let err = valid_access_token(&dir, &transport, 1_000).unwrap_err();
        assert!(matches!(err, Error::State(_)));
    }

    #[test]
    fn clearing_unlinks_and_is_safe_to_repeat() {
        let dir = temp_dir("clear");
        save(&dir, &tokens(5_000)).unwrap();
        clear(&dir).unwrap();
        assert_eq!(load(&dir).unwrap(), None);
        clear(&dir).unwrap();
    }
}
