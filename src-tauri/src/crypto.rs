//! Passphrase-derived encryption for the few things on a device that are
//! genuinely secret. docs/android/ROADMAP.md Phase 4.
//!
//! Argon2id for the key derivation and AES-256-GCM for the box, both pure
//! Rust so they cross-compile for `aarch64-linux-android` with no native
//! dependency - the same constraint that picked `ureq`/rustls over a
//! native-TLS client in `sync_dropbox.rs`.
//!
//! **What this is for, and what it is not.** It protects a secret at rest
//! on a device someone else has picked up: the Dropbox refresh token,
//! which is a standing grant to the whole app folder and outlives any
//! access token. It is *not* vault encryption. The vault is plain files
//! that a desktop reads directly and Dropbox syncs as-is; encrypting the
//! phone's copy would break both, and encrypting what goes to Dropbox
//! would leave the desktop unable to read its own vault. That trade-off
//! belongs to a whole-product decision, not to this module - see
//! ROADMAP.md Phase 4 for what is and is not covered.
//!
//! The envelope carries its own salt and nonce, so a file encrypted by an
//! older build stays readable and no separate parameter store has to be
//! kept in step with it.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::Argon2;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// Argon2id output length, and AES-256's key length.
pub const KEY_LEN: usize = 32;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;

/// A key derived from a passphrase. Deliberately not `Serialize`: this
/// belongs in memory for as long as the app is unlocked and nowhere
/// else. Writing it next to the thing it protects would be theatre.
#[derive(Clone, PartialEq, Eq)]
pub struct Key(pub [u8; KEY_LEN]);

impl std::fmt::Debug for Key {
    /// Never print the bytes: a key in a log or a panic message is a key
    /// on disk.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Key(<redacted>)")
    }
}

/// One encrypted value, self-describing so it can be decrypted years
/// later without a parameter file to keep in step.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Envelope {
    /// Format version. Bumped only if the primitives change; a reader
    /// that does not know a version must refuse rather than guess.
    pub v: u8,
    pub salt: String,
    pub nonce: String,
    pub ct: String,
}

const CURRENT_VERSION: u8 = 1;

fn random_bytes(len: usize) -> Result<Vec<u8>> {
    let mut bytes = vec![0u8; len];
    getrandom::getrandom(&mut bytes)
        .map_err(|e| Error::State(format!("no randomness available: {e}")))?;
    Ok(bytes)
}

/// Argon2id with the crate's default parameters (19 MiB, 2 passes).
///
/// Chosen over a higher cost on purpose: this runs on a phone, at app
/// start, in front of someone waiting to see their day. A parameter set
/// that takes two seconds on a desktop takes noticeably longer on a
/// mid-range Android device, and a lock people turn off is worth less
/// than a slightly cheaper one they keep.
pub fn derive_key(passphrase: &str, salt: &[u8]) -> Result<Key> {
    let mut key = [0u8; KEY_LEN];
    Argon2::default()
        .hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .map_err(|e| Error::State(format!("cannot derive a key: {e}")))?;
    Ok(Key(key))
}

/// Encrypts `plaintext` under a fresh salt and nonce.
pub fn seal(passphrase: &str, plaintext: &[u8]) -> Result<Envelope> {
    let salt = random_bytes(SALT_LEN)?;
    let nonce_bytes = random_bytes(NONCE_LEN)?;
    let key = derive_key(passphrase, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key.0)
        .map_err(|e| Error::State(format!("cannot build the cipher: {e}")))?;
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext)
        .map_err(|_| Error::State("encryption failed".into()))?;
    Ok(Envelope {
        v: CURRENT_VERSION,
        salt: BASE64.encode(salt),
        nonce: BASE64.encode(nonce_bytes),
        ct: BASE64.encode(ct),
    })
}

/// Decrypts an envelope. A wrong passphrase and a tampered file are the
/// same answer here - GCM's tag cannot tell them apart, and neither
/// should the caller act differently.
pub fn open(passphrase: &str, envelope: &Envelope) -> Result<Vec<u8>> {
    if envelope.v != CURRENT_VERSION {
        return Err(Error::State(format!(
            "this encrypted file was written by a newer version of the app \
             (format {}, this build knows {CURRENT_VERSION})",
            envelope.v
        )));
    }
    let decode = |field: &str, value: &str| {
        BASE64
            .decode(value)
            .map_err(|e| Error::State(format!("corrupt encrypted file ({field}): {e}")))
    };
    let salt = decode("salt", &envelope.salt)?;
    let nonce = decode("nonce", &envelope.nonce)?;
    let ct = decode("ct", &envelope.ct)?;
    if nonce.len() != NONCE_LEN {
        return Err(Error::State("corrupt encrypted file (nonce length)".into()));
    }
    let key = derive_key(passphrase, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key.0)
        .map_err(|e| Error::State(format!("cannot build the cipher: {e}")))?;
    cipher
        .decrypt(Nonce::from_slice(&nonce), ct.as_slice())
        .map_err(|_| Error::State("wrong passphrase".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_sealed_value_comes_back_under_the_same_passphrase() {
        let sealed = seal("correct horse", b"refresh-token-here").unwrap();
        assert_eq!(
            open("correct horse", &sealed).unwrap(),
            b"refresh-token-here"
        );
    }

    #[test]
    fn a_wrong_passphrase_does_not_return_plausible_bytes() {
        let sealed = seal("correct horse", b"refresh-token-here").unwrap();
        let err = open("incorrect horse", &sealed).unwrap_err();
        assert!(matches!(err, Error::State(m) if m.contains("wrong passphrase")));
    }

    #[test]
    fn a_tampered_ciphertext_is_refused_rather_than_half_decrypted() {
        let mut sealed = seal("passphrase", b"refresh-token-here").unwrap();
        let mut ct = BASE64.decode(&sealed.ct).unwrap();
        ct[0] ^= 0xff;
        sealed.ct = BASE64.encode(ct);
        assert!(open("passphrase", &sealed).is_err());
    }

    #[test]
    fn two_seals_of_the_same_text_differ() {
        // A fresh salt and nonce every time: identical files would leak
        // that the secret had not changed between two backups.
        let a = seal("passphrase", b"same").unwrap();
        let b = seal("passphrase", b"same").unwrap();
        assert_ne!(a.ct, b.ct);
        assert_ne!(a.salt, b.salt);
    }

    #[test]
    fn a_future_format_is_refused_instead_of_guessed_at() {
        let mut sealed = seal("passphrase", b"x").unwrap();
        sealed.v = CURRENT_VERSION + 1;
        let err = open("passphrase", &sealed).unwrap_err();
        assert!(matches!(err, Error::State(m) if m.contains("newer version")));
    }

    #[test]
    fn the_key_never_prints_itself() {
        let key = derive_key("passphrase", b"0123456789abcdef").unwrap();
        assert_eq!(format!("{key:?}"), "Key(<redacted>)");
    }
}
