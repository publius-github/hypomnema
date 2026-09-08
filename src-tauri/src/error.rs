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
    // Raised by sync_provider.rs's mock and sync_dropbox.rs's real
    // DropboxApiSyncProvider on a stale-marker write (docs/android/
    // ROADMAP.md Phase 1). Not yet raised from any command reachable by
    // the frontend - that lands with the vault-sync wiring above these.
    #[error("write rejected, remote changed: {path}")]
    SyncConflict { path: String },
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
