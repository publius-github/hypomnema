//! The provider-neutral half of OAuth2 for an installed app: PKCE
//! (RFC 7636) and the one HTTP shape a token endpoint needs. The Google
//! flow on top of it is `google_auth.rs`.
//!
//! PKCE because anything shipped inside an installer is readable by
//! whoever holds it: the per-authorization `code_verifier` is what proves
//! the code exchange comes from the device that started the flow.

use crate::error::{Error, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde_json::Value;
use sha2::{Digest, Sha256};

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

/// The one HTTP shape the token endpoint needs: a form POST returning
/// JSON. A seam, so the flows are unit-tested without a network.
pub trait OauthTransport {
    fn post_form(&self, url: &str, form: &[(&str, &str)]) -> Result<Value>;
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
