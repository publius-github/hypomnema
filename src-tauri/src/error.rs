use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("config error: {0}")]
    Yaml(#[from] serde_yaml::Error),
    #[error("{0}")]
    State(String),
    /// A command that needs the vault ran before one was selected (or
    /// while it is closed for a rebuild). Its own variant because the
    /// frontend treats it differently from a real failure: nothing is
    /// broken, the vault picker is simply still open.
    #[error("no vault selected")]
    NoVault,
    // Raised by sync_provider.rs's mock and sync_dropbox.rs's real
    // DropboxApiSyncProvider on a stale-marker write (docs/android/
    // ROADMAP.md Phase 1). Not yet raised from any command reachable by
    // the frontend - that lands with the vault-sync wiring above these.
    #[error("write rejected, remote changed: {path}")]
    SyncConflict { path: String },
    /// A pass found most of what this device had synced gone from the
    /// remote at once - the remote's data wiped, or a different account
    /// behind the same link. Applying that as deletions would empty the
    /// vault here too, so the pass stops before touching anything and
    /// the user decides (sync_cycle.rs, the mass-deletion guard).
    #[error(
        "{gone} of the {known} synced files are gone from the remote at once; \
         nothing was deleted here. Upload this vault again, or unlink"
    )]
    RemoteWiped { known: usize, gone: usize },
    /// Google no longer accepts this device's grant: revoked from the
    /// Google account page, expired, or (on Android) Play services wants
    /// the user to confirm again. Only signing in again fixes it, so the
    /// UI offers exactly that instead of a bare error.
    #[error("{0}")]
    SignInExpired(String),
}

impl Error {
    /// The stable machine-readable half of the serialized error; the
    /// frontend's `IpcError["kind"]` in `src/lib/ipc.ts` lists the same
    /// names.
    pub fn kind(&self) -> &'static str {
        match self {
            Error::Io(_) => "io",
            Error::Db(_) => "db",
            Error::Yaml(_) => "config",
            Error::State(_) => "state",
            Error::NoVault => "no_vault",
            Error::SyncConflict { .. } => "sync_conflict",
            Error::RemoteWiped { .. } => "remote_wiped",
            Error::SignInExpired(_) => "sign_in_expired",
        }
    }
}

/// What a rejected command hands the frontend. Serialized as an object
/// rather than the bare message so the UI can branch on `kind` instead
/// of matching on English text.
#[derive(Serialize)]
struct Wire<'a> {
    kind: &'static str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<&'a str>,
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        let path = match self {
            Error::SyncConflict { path } => Some(path.as_str()),
            _ => None,
        };
        Wire {
            kind: self.kind(),
            message: self.to_string(),
            path,
        }
        .serialize(serializer)
    }
}

pub type Result<T> = std::result::Result<T, Error>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_serialize_as_kind_and_message() {
        let v = serde_json::to_value(Error::NoVault).unwrap();
        assert_eq!(v["kind"], "no_vault");
        assert_eq!(v["message"], "no vault selected");
        assert!(v.get("path").is_none());

        let v = serde_json::to_value(Error::State("boom".into())).unwrap();
        assert_eq!(v["kind"], "state");
        assert_eq!(v["message"], "boom");

        let v = serde_json::to_value(Error::SyncConflict {
            path: "notes/a.md".into(),
        })
        .unwrap();
        assert_eq!(v["kind"], "sync_conflict");
        assert_eq!(v["path"], "notes/a.md");
    }
}
