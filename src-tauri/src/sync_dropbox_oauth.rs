//! Dropbox OAuth2 with PKCE - how `sync_dropbox.rs` gets the bearer token
//! it takes as a given. docs/android/ROADMAP.md Phase 1.
//!
//! PKCE (RFC 7636) rather than the classic authorization-code flow because
//! this is an *installed* app: anything shipped inside the APK is readable
//! by whoever holds the APK, so there is no client secret here - the
//! per-authorization `code_verifier` takes its place. `APP_KEY` below is a
//! public client identifier, not a credential, which is why it's a
//! hardcoded constant rather than a setting (CLAUDE.md "Settings over
//! hardcode" carves out exactly this: protocol values with no sane
//! alternative).
//!
//! The pure parts (challenge derivation, URL and form shaping, response
//! parsing) are unit-tested here against a mock transport and an RFC 7636
//! test vector - no network, no Dropbox account needed for `cargo test`.
//!
//! **Not this module's job:** opening a browser and getting the resulting
//! `code` back from it. That's platform work - on Android the first cut is
//! the no-`redirect_uri` variant, where Dropbox shows the code on screen
//! and the user pastes it into the app (no intent-filter plumbing in the
//! regenerated `gen/android` project); a real redirect can replace it
//! later without touching anything in this module but the argument.
#![allow(dead_code)]

use crate::error::{Error, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde_json::Value;
use sha2::{Digest, Sha256};

/// Dropbox app key for the registered "Hypomnema" app (App folder access,
/// registered 2026-09-08). Public by design under PKCE - see the module
/// docs before "moving it somewhere safer".
pub const APP_KEY: &str = "v775pphfltppmmv";

const AUTHORIZE_ENDPOINT: &str = "https://www.dropbox.com/oauth2/authorize";
const TOKEN_ENDPOINT: &str = "https://api.dropboxapi.com/oauth2/token";

/// A verifier/challenge pair for one authorization attempt. The verifier
/// never leaves the device until the token exchange; the challenge is what
/// goes out in the authorize URL.
#[derive(Debug, Clone)]
pub struct PkceChallenge {
    pub verifier: String,
    pub challenge: String,
}

/// Fresh 32-byte verifier, base64url-encoded (43 chars, all inside RFC
/// 7636's unreserved set) plus its S256 challenge.
pub fn new_pkce_challenge() -> Result<PkceChallenge> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes)
        .map_err(|e| Error::State(format!("no system randomness for PKCE verifier: {e}")))?;
    let verifier = URL_SAFE_NO_PAD.encode(bytes);
    let challenge = challenge_for(&verifier);
    Ok(PkceChallenge {
        verifier,
        challenge,
    })
}

/// S256 transformation from RFC 7636 §4.2:
/// `BASE64URL-ENCODE(SHA256(ASCII(code_verifier)))`, no padding.
fn challenge_for(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// The URL to open in a browser for the user to approve access.
///
/// `redirect_uri: None` is deliberate and supported: Dropbox then displays
/// the authorization code for the user to copy manually, which is what the
/// first Android cut uses instead of registering a redirect intent.
/// Whatever is passed here must be passed identically to `exchange_code`.
pub fn authorize_url(challenge: &str, redirect_uri: Option<&str>) -> String {
    let mut url = format!(
        "{AUTHORIZE_ENDPOINT}?client_id={APP_KEY}\
         &response_type=code\
         &code_challenge={challenge}\
         &code_challenge_method=S256\
         &token_access_type=offline"
    );
    if let Some(redirect) = redirect_uri {
        url.push_str("&redirect_uri=");
        url.push_str(redirect);
    }
    url
}

/// What Dropbox hands back from the token endpoint.
///
/// `token_access_type=offline` in the authorize URL is what makes
/// `refresh_token` show up on the initial exchange: Dropbox access tokens
/// are short-lived (hours), so without the refresh token the user would be
/// re-approving access constantly.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DropboxTokens {
    pub access_token: String,
    /// Present on the initial code exchange, absent when refreshing (the
    /// existing refresh token stays valid).
    pub refresh_token: Option<String>,
    pub expires_in_secs: i64,
}

/// The one HTTP shape the token endpoint needs: a form POST returning JSON.
pub trait OauthTransport {
    fn post_form(&self, url: &str, form: &[(&str, &str)]) -> Result<Value>;
}

/// Trade the authorization code the user just approved for tokens.
pub fn exchange_code<T: OauthTransport>(
    transport: &T,
    code: &str,
    verifier: &str,
    redirect_uri: Option<&str>,
) -> Result<DropboxTokens> {
    let mut form = vec![
        ("code", code),
        ("grant_type", "authorization_code"),
        ("client_id", APP_KEY),
        ("code_verifier", verifier),
    ];
    if let Some(redirect) = redirect_uri {
        form.push(("redirect_uri", redirect));
    }
    let response = transport.post_form(TOKEN_ENDPOINT, &form)?;
    tokens_from(&response)
}

/// Swap a stored refresh token for a fresh access token.
pub fn refresh_access_token<T: OauthTransport>(
    transport: &T,
    refresh_token: &str,
) -> Result<DropboxTokens> {
    let form = [
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", APP_KEY),
    ];
    let response = transport.post_form(TOKEN_ENDPOINT, &form)?;
    tokens_from(&response)
}

fn tokens_from(response: &Value) -> Result<DropboxTokens> {
    let access_token = response
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            Error::State(format!(
                "Dropbox token response missing \"access_token\": {response}"
            ))
        })?
        .to_string();
    Ok(DropboxTokens {
        access_token,
        refresh_token: response
            .get("refresh_token")
            .and_then(Value::as_str)
            .map(str::to_string),
        expires_in_secs: response
            .get("expires_in")
            .and_then(Value::as_i64)
            .unwrap_or(0),
    })
}

/// Real transport, sharing `sync_dropbox.rs`'s reasoning for `ureq`:
/// rustls-backed, so no native OpenSSL to cross-compile for Android.
pub struct HttpOauthTransport {
    agent: ureq::Agent,
}

impl Default for HttpOauthTransport {
    fn default() -> Self {
        Self::new()
    }
}

impl HttpOauthTransport {
    pub fn new() -> Self {
        Self {
            agent: ureq::Agent::new(),
        }
    }
}

impl OauthTransport for HttpOauthTransport {
    fn post_form(&self, url: &str, form: &[(&str, &str)]) -> Result<Value> {
        match self.agent.post(url).send_form(form) {
            Ok(response) => response
                .into_json::<Value>()
                .map_err(|e| Error::State(format!("bad Dropbox token response: {e}"))),
            Err(ureq::Error::Status(code, response)) => {
                // Bodies here carry things like {"error": "invalid_grant"}
                // (expired/reused code) - surface them verbatim, they're
                // the only clue for what went wrong in a browser flow.
                let body = response.into_string().unwrap_or_default();
                Err(Error::State(format!(
                    "Dropbox OAuth error ({code}): {body}"
                )))
            }
            Err(e) => Err(Error::State(format!("Dropbox OAuth request failed: {e}"))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::RefCell;

    /// One recorded `post_form` call: the URL, plus its form fields.
    type FormCall = (String, Vec<(String, String)>);

    #[derive(Default)]
    struct MockTransport {
        response: RefCell<Option<Result<Value>>>,
        calls: RefCell<Vec<FormCall>>,
    }

    impl MockTransport {
        fn returning(response: Value) -> Self {
            Self {
                response: RefCell::new(Some(Ok(response))),
                calls: RefCell::new(Vec::new()),
            }
        }

        /// The form fields of the single call made, for assertions.
        fn form(&self) -> Vec<(String, String)> {
            self.calls.borrow()[0].1.clone()
        }
    }

    impl OauthTransport for MockTransport {
        fn post_form(&self, url: &str, form: &[(&str, &str)]) -> Result<Value> {
            self.calls.borrow_mut().push((
                url.to_string(),
                form.iter()
                    .map(|(k, v)| (k.to_string(), v.to_string()))
                    .collect(),
            ));
            self.response
                .borrow_mut()
                .take()
                .expect("unexpected extra post_form() call in test")
        }
    }

    /// RFC 7636 Appendix B's worked example - if this passes, our S256
    /// derivation matches every other implementation's.
    #[test]
    fn challenge_matches_rfc_7636_test_vector() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            challenge_for(verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn generated_verifier_fits_rfc_7636_charset_and_length() {
        let pkce = new_pkce_challenge().unwrap();
        assert_eq!(pkce.verifier.len(), 43); // 32 bytes base64url, unpadded
        assert!(pkce
            .verifier
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-._~".contains(c)));
        assert_eq!(pkce.challenge, challenge_for(&pkce.verifier));
    }

    #[test]
    fn each_authorization_gets_a_fresh_verifier() {
        let a = new_pkce_challenge().unwrap();
        let b = new_pkce_challenge().unwrap();
        assert_ne!(a.verifier, b.verifier);
    }

    #[test]
    fn authorize_url_carries_pkce_and_offline_access() {
        let url = authorize_url("CHALLENGE", None);
        assert!(url.starts_with("https://www.dropbox.com/oauth2/authorize?"));
        assert!(url.contains(&format!("client_id={APP_KEY}")));
        assert!(url.contains("response_type=code"));
        assert!(url.contains("code_challenge=CHALLENGE"));
        assert!(url.contains("code_challenge_method=S256"));
        // Without this there's no refresh token, and the user re-approves
        // access every few hours.
        assert!(url.contains("token_access_type=offline"));
        // No redirect asked for: Dropbox shows the code for manual entry.
        assert!(!url.contains("redirect_uri"));
    }

    #[test]
    fn authorize_url_includes_redirect_when_given() {
        let url = authorize_url("CHALLENGE", Some("hypomnema://oauth"));
        assert!(url.contains("redirect_uri=hypomnema://oauth"));
    }

    #[test]
    fn exchange_code_posts_verifier_and_parses_tokens() {
        let transport = MockTransport::returning(json!({
            "access_token": "sl.access",
            "refresh_token": "refresh-1",
            "expires_in": 14400,
            "token_type": "bearer",
        }));
        let tokens = exchange_code(&transport, "code-1", "verifier-1", None).unwrap();

        assert_eq!(
            tokens,
            DropboxTokens {
                access_token: "sl.access".into(),
                refresh_token: Some("refresh-1".into()),
                expires_in_secs: 14400,
            }
        );
        let form = transport.form();
        assert!(form.contains(&("code".into(), "code-1".into())));
        assert!(form.contains(&("grant_type".into(), "authorization_code".into())));
        assert!(form.contains(&("code_verifier".into(), "verifier-1".into())));
        assert!(form.contains(&("client_id".into(), APP_KEY.into())));
        // Not sent unless one was used in the authorize step - Dropbox
        // rejects the exchange if the two calls disagree.
        assert!(!form.iter().any(|(k, _)| k == "redirect_uri"));
    }

    #[test]
    fn exchange_code_echoes_the_redirect_uri_when_one_was_used() {
        let transport = MockTransport::returning(json!({ "access_token": "sl.access" }));
        exchange_code(
            &transport,
            "code-1",
            "verifier-1",
            Some("hypomnema://oauth"),
        )
        .unwrap();
        assert!(transport
            .form()
            .contains(&("redirect_uri".into(), "hypomnema://oauth".into())));
    }

    #[test]
    fn refresh_returns_a_new_access_token_without_a_new_refresh_token() {
        let transport = MockTransport::returning(json!({
            "access_token": "sl.access-2",
            "expires_in": 14400,
        }));
        let tokens = refresh_access_token(&transport, "refresh-1").unwrap();

        assert_eq!(tokens.access_token, "sl.access-2");
        assert_eq!(tokens.refresh_token, None);
        let form = transport.form();
        assert!(form.contains(&("grant_type".into(), "refresh_token".into())));
        assert!(form.contains(&("refresh_token".into(), "refresh-1".into())));
    }

    #[test]
    fn a_response_without_an_access_token_is_an_error() {
        let transport = MockTransport::returning(json!({ "error": "invalid_grant" }));
        let err = exchange_code(&transport, "stale-code", "verifier-1", None).unwrap_err();
        assert!(matches!(err, Error::State(_)));
    }
}
