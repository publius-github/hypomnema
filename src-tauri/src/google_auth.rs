//! Signing in with Google on the desktop: OAuth2 authorization code with
//! PKCE, the redirect caught on a loopback port (`127.0.0.1:<free port>`),
//! which is Google's flow for installed apps. The token endpoint, refresh
//! and revoke live here too; storing the result is `google_link.rs`.
//!
//! The client is Google's "Desktop app" type. Google treats its secret as
//! not confidential (it ships inside every installer), but secret
//! scanners flag it in a public repository, so it is compiled in from the
//! `HYPOMNEMA_GOOGLE_DESKTOP_CLIENT_SECRET` environment variable at build
//! time (`scripts/windows/build.ps1`). A build without it says so instead
//! of failing at Google's end.
//!
//! The pure parts - URL and form shaping, response parsing, reading the
//! redirect request - are unit-tested against a mock transport.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::error::{Error, Result};
use crate::oauth::OauthTransport;
use crate::sync_gdrive::percent_encode;

/// The "Desktop app" OAuth client of the Hypomnema Google Cloud project.
/// A public identifier, not a credential.
const DEFAULT_CLIENT_ID: &str =
    "901647150843-gni9t7lasuf143m1qbkn3hp8otr7r0ok.apps.googleusercontent.com";

/// The OAuth client this build signs in with: a fork or self-build that
/// registers its own client sets `HYPOMNEMA_GOOGLE_DESKTOP_CLIENT_ID` at
/// build time (paired with its own secret) instead of editing the source.
pub const CLIENT_ID: &str = match option_env!("HYPOMNEMA_GOOGLE_DESKTOP_CLIENT_ID") {
    Some(id) if !id.is_empty() => id,
    _ => DEFAULT_CLIENT_ID,
};

/// Only the app's own hidden folder in the user's Drive.
pub const SCOPE: &str = "https://www.googleapis.com/auth/drive.appdata";

const AUTHORIZE_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT: &str = "https://oauth2.googleapis.com/revoke";

/// How long the app waits for the browser to come back before giving up.
pub const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// The desktop client secret compiled into this build, if any.
pub fn client_secret() -> Option<&'static str> {
    option_env!("HYPOMNEMA_GOOGLE_DESKTOP_CLIENT_SECRET").filter(|s| !s.is_empty())
}

fn require_secret() -> Result<&'static str> {
    client_secret().ok_or_else(|| {
        Error::State(
            "this build has no Google client secret - rebuild with \
             HYPOMNEMA_GOOGLE_DESKTOP_CLIENT_SECRET set"
                .into(),
        )
    })
}

/// The URL to open in the browser. `access_type=offline` plus
/// `prompt=consent` is what makes Google hand out a refresh token every
/// time, including for an account that approved the app before.
pub fn authorize_url(challenge: &str, state: &str, redirect_uri: &str) -> String {
    format!(
        "{AUTHORIZE_ENDPOINT}?client_id={}&redirect_uri={}&response_type=code\
         &scope={}&code_challenge={challenge}&code_challenge_method=S256\
         &state={state}&access_type=offline&prompt=consent",
        percent_encode(CLIENT_ID),
        percent_encode(redirect_uri),
        percent_encode(SCOPE),
    )
}

/// What the token endpoint hands back.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GoogleTokens {
    pub access_token: String,
    /// Only on the initial exchange.
    pub refresh_token: Option<String>,
    pub expires_in_secs: i64,
}

pub fn exchange_code<T: OauthTransport>(
    transport: &T,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<GoogleTokens> {
    let secret = require_secret()?;
    let form = [
        ("code", code),
        ("grant_type", "authorization_code"),
        ("client_id", CLIENT_ID),
        ("client_secret", secret),
        ("code_verifier", verifier),
        ("redirect_uri", redirect_uri),
    ];
    tokens_from(&transport.post_form(TOKEN_ENDPOINT, &form)?)
}

pub fn refresh_access_token<T: OauthTransport>(
    transport: &T,
    refresh_token: &str,
) -> Result<GoogleTokens> {
    let secret = require_secret()?;
    let form = [
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", CLIENT_ID),
        ("client_secret", secret),
    ];
    tokens_from(&transport.post_form(TOKEN_ENDPOINT, &form)?)
}

/// Withdraws the app's access on Google's side. Revoking the refresh
/// token revokes the grant as a whole.
pub fn revoke<T: OauthTransport>(transport: &T, token: &str) -> Result<()> {
    transport.post_form(REVOKE_ENDPOINT, &[("token", token)])?;
    Ok(())
}

fn tokens_from(response: &Value) -> Result<GoogleTokens> {
    let access_token = response
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            Error::State(format!(
                "Google token response missing \"access_token\": {response}"
            ))
        })?
        .to_string();
    Ok(GoogleTokens {
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

/// Real token-endpoint transport over `ureq`.
pub struct GoogleOauthTransport {
    agent: ureq::Agent,
}

impl Default for GoogleOauthTransport {
    fn default() -> Self {
        Self::new()
    }
}

impl GoogleOauthTransport {
    pub fn new() -> Self {
        Self {
            agent: crate::sync_gdrive::http_agent(),
        }
    }
}

impl OauthTransport for GoogleOauthTransport {
    fn post_form(&self, url: &str, form: &[(&str, &str)]) -> Result<Value> {
        let request_failed =
            |e: ureq::Error| Error::State(format!("Google sign-in request failed: {e}"));
        let response = self
            .agent
            .post(url)
            .send_form(form.iter().copied())
            .map_err(request_failed)?;
        let code = response.status().as_u16();
        let body = crate::sync_gdrive::read_body(response).map_err(request_failed)?;
        if !(200..300).contains(&code) {
            return Err(oauth_error(code, &String::from_utf8_lossy(&body)));
        }
        // The revoke endpoint answers with an empty body.
        Ok(serde_json::from_slice(&body).unwrap_or(Value::Null))
    }
}

/// `invalid_grant` is the one a user can act on: the refresh token was
/// revoked (from the Google account page) or expired.
fn oauth_error(code: u16, body: &str) -> Error {
    if body.contains("invalid_grant") {
        return Error::SignInExpired(
            "Google access was revoked or has expired - sign in again".into(),
        );
    }
    Error::State(format!("Google OAuth error ({code}): {body}"))
}

/// A fresh random `state` value, so a redirect that this app did not
/// start is refused.
pub fn new_state() -> Result<String> {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes)
        .map_err(|e| Error::State(format!("no system randomness for OAuth state: {e}")))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// What one request to the loopback port carried.
#[derive(Debug, PartialEq, Eq)]
pub enum Redirect {
    Code(String),
    /// The user declined, or Google refused (`error=access_denied`).
    Denied(String),
    /// Not the redirect (a favicon request, a stray probe): keep waiting.
    Other,
}

/// Reads the request line (`GET /?code=...&state=... HTTP/1.1`) the
/// browser sent to the loopback port. A redirect whose `state` is not
/// ours is treated as noise, not as an answer.
pub fn parse_redirect(request_line: &str, expected_state: &str) -> Redirect {
    let Some(target) = request_line.split_whitespace().nth(1) else {
        return Redirect::Other;
    };
    let Some((path, query)) = target.split_once('?') else {
        return Redirect::Other;
    };
    if path != "/" {
        return Redirect::Other;
    }
    let mut code = None;
    let mut state = None;
    let mut error = None;
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        let value = percent_decode(value);
        match key {
            "code" => code = Some(value),
            "state" => state = Some(value),
            "error" => error = Some(value),
            _ => {}
        }
    }
    if state.as_deref() != Some(expected_state) {
        return Redirect::Other;
    }
    match (code, error) {
        (Some(code), _) => Redirect::Code(code),
        (None, Some(error)) => Redirect::Denied(error),
        (None, None) => Redirect::Other,
    }
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => {
                let hex = |b: u8| (b as char).to_digit(16);
                match (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                    (Some(high), Some(low)) => {
                        out.push((high * 16 + low) as u8);
                        i += 2;
                    }
                    _ => out.push(b'%'),
                }
            }
            byte => out.push(byte),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Hypomnema</title>\
<body style=\"font:16px system-ui;margin:3rem;max-width:32rem\">\
<h2>Signed in</h2><p>Hypomnema is connected to Google Drive. You can close this tab.</p>";

const DENIED_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Hypomnema</title>\
<body style=\"font:16px system-ui;margin:3rem;max-width:32rem\">\
<h2>Not signed in</h2><p>Access was not granted. You can close this tab and try again from Hypomnema.</p>";

fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.flush();
}

/// Waits on `listener` for the browser to arrive at the redirect URI and
/// returns the authorization code. Gives up after `timeout`, or as soon as
/// `cancel` is set (the user pressed Cancel in the app).
pub fn wait_for_redirect(
    listener: &TcpListener,
    expected_state: &str,
    timeout: Duration,
    cancel: &AtomicBool,
) -> Result<String> {
    listener.set_nonblocking(true)?;
    let deadline = Instant::now() + timeout;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err(Error::State("sign-in cancelled".into()));
        }
        if Instant::now() >= deadline {
            return Err(Error::State(
                "sign-in timed out waiting for the browser".into(),
            ));
        }
        let mut stream = match listener.accept() {
            Ok((stream, _)) => stream,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
            Err(e) => return Err(e.into()),
        };
        stream.set_nonblocking(false)?;
        stream.set_read_timeout(Some(Duration::from_secs(5)))?;
        let mut line = String::new();
        if BufReader::new(&stream).read_line(&mut line).is_err() {
            continue;
        }
        match parse_redirect(&line, expected_state) {
            Redirect::Code(code) => {
                respond(&mut stream, "200 OK", DONE_PAGE);
                return Ok(code);
            }
            Redirect::Denied(error) => {
                respond(&mut stream, "200 OK", DENIED_PAGE);
                return Err(Error::State(format!(
                    "Google sign-in was not granted ({error})"
                )));
            }
            Redirect::Other => respond(&mut stream, "404 Not Found", ""),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::RefCell;

    type FormCall = (String, Vec<(String, String)>);

    struct MockTransport {
        response: Value,
        calls: RefCell<Vec<FormCall>>,
    }

    impl OauthTransport for MockTransport {
        fn post_form(&self, url: &str, form: &[(&str, &str)]) -> Result<Value> {
            self.calls.borrow_mut().push((
                url.to_string(),
                form.iter()
                    .map(|(k, v)| (k.to_string(), v.to_string()))
                    .collect(),
            ));
            Ok(self.response.clone())
        }
    }

    #[test]
    fn the_authorize_url_asks_for_appdata_offline_with_pkce() {
        let url = authorize_url("CHAL", "STATE", "http://127.0.0.1:51234");
        assert!(url.starts_with("https://accounts.google.com/o/oauth2/v2/auth?"));
        assert!(url.contains("&redirect_uri=http%3A%2F%2F127.0.0.1%3A51234&"));
        assert!(url.contains("&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.appdata&"));
        assert!(url.contains("&code_challenge=CHAL&code_challenge_method=S256"));
        assert!(url.contains("&state=STATE&"));
        assert!(url.contains("&access_type=offline&prompt=consent"));
    }

    #[test]
    fn tokens_are_read_from_the_response() {
        let tokens = tokens_from(&json!({
            "access_token": "at", "refresh_token": "rt", "expires_in": 3599
        }))
        .unwrap();
        assert_eq!(tokens.access_token, "at");
        assert_eq!(tokens.refresh_token.as_deref(), Some("rt"));
        assert_eq!(tokens.expires_in_secs, 3599);
        assert!(tokens_from(&json!({ "error": "x" })).is_err());
    }

    #[test]
    fn revoke_posts_the_token() {
        let transport = MockTransport {
            response: Value::Null,
            calls: RefCell::new(Vec::new()),
        };
        revoke(&transport, "rt").unwrap();
        let calls = transport.calls.borrow();
        assert_eq!(calls[0].0, REVOKE_ENDPOINT);
        assert_eq!(calls[0].1, vec![("token".to_string(), "rt".to_string())]);
    }

    #[test]
    fn a_revoked_grant_reads_as_sign_in_again() {
        let err = oauth_error(400, r#"{"error":"invalid_grant"}"#);
        assert!(err.to_string().contains("sign in again"));
    }

    #[test]
    fn the_redirect_yields_its_code_only_with_our_state() {
        assert_eq!(
            parse_redirect("GET /?state=s1&code=4%2F0Ab-x&scope=a HTTP/1.1", "s1"),
            Redirect::Code("4/0Ab-x".into())
        );
        assert_eq!(
            parse_redirect("GET /?state=other&code=c HTTP/1.1", "s1"),
            Redirect::Other
        );
        assert_eq!(
            parse_redirect("GET /?error=access_denied&state=s1 HTTP/1.1", "s1"),
            Redirect::Denied("access_denied".into())
        );
        assert_eq!(
            parse_redirect("GET /favicon.ico HTTP/1.1", "s1"),
            Redirect::Other
        );
        assert_eq!(parse_redirect("", "s1"), Redirect::Other);
    }

    #[test]
    fn percent_decoding_survives_broken_escapes() {
        assert_eq!(percent_decode("a%2Fb+c"), "a/b c");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
    }

    #[test]
    fn the_loopback_listener_hands_back_the_code() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let browser = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
            write!(
                stream,
                "GET /?code=abc&state=st HTTP/1.1\r\nHost: x\r\n\r\n"
            )
            .unwrap();
            let mut reply = String::new();
            std::io::Read::read_to_string(&mut stream, &mut reply).unwrap();
            reply
        });
        let code = wait_for_redirect(
            &listener,
            "st",
            Duration::from_secs(5),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(code, "abc");
        assert!(browser.join().unwrap().contains("Signed in"));
    }

    #[test]
    fn a_cancelled_wait_returns_promptly() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let err = wait_for_redirect(
            &listener,
            "st",
            Duration::from_secs(60),
            &AtomicBool::new(true),
        )
        .unwrap_err();
        assert!(err.to_string().contains("cancelled"));
    }
}
