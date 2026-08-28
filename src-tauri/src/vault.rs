use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::config::AppConfig;
use crate::db;
use crate::error::{Error, Result};

const DEFAULT_JOURNAL_TEMPLATE: &str = "\
# {{date}}

## What I did today

## What was hard

## What I am grateful for

## Focus for tomorrow
";

pub struct Vault {
    pub root: PathBuf,
    pub config: AppConfig,
    pub conn: Connection,
}

impl Vault {
    /// Opens (or initializes) the vault: folder layout, app.yml with
    /// defaults, SQLite DB with migrations, and the settings mirror.
    pub fn open(root: &Path) -> Result<Self> {
        if !root.is_dir() {
            return Err(Error::State(format!(
                "vault folder does not exist: {}",
                root.display()
            )));
        }

        fs::create_dir_all(root.join("config"))?;
        fs::create_dir_all(root.join("journal").join("templates"))?;

        let template = root.join("journal").join("templates").join("daily.md");
        if !template.exists() {
            fs::write(&template, DEFAULT_JOURNAL_TEMPLATE)?;
        }

        let config = AppConfig::load_or_create(&root.join("config").join("app.yml"))?;

        let conn = db::open(&root.join("app.db"))?;
        db::migrate(&conn)?;
        db::mirror_settings(&conn, &config)?;

        Ok(Self {
            root: root.to_path_buf(),
            config,
            conn,
        })
    }

    pub fn save_config(&mut self, config: AppConfig) -> Result<()> {
        config.save(&self.root.join("config").join("app.yml"))?;
        db::mirror_settings(&self.conn, &config)?;
        self.config = config;
        Ok(())
    }
}

/// The vault path is the only state kept outside the vault, in the OS
/// app-config dir, so the app can find the vault on startup.
pub fn read_vault_path(app_config_dir: &Path) -> Option<PathBuf> {
    let marker = app_config_dir.join("vault-path.txt");
    let raw = fs::read_to_string(marker).ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(PathBuf::from(trimmed))
    }
}

pub fn write_vault_path(app_config_dir: &Path, vault: &Path) -> Result<()> {
    fs::create_dir_all(app_config_dir)?;
    fs::write(
        app_config_dir.join("vault-path.txt"),
        vault.to_string_lossy().as_bytes(),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("app-pkb-test-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn open_initializes_layout_and_is_reentrant() {
        let root = temp_dir("vault-open");

        let vault = Vault::open(&root).unwrap();
        assert!(root.join("config").join("app.yml").exists());
        assert!(root
            .join("journal")
            .join("templates")
            .join("daily.md")
            .exists());
        assert!(root.join("app.db").exists());
        assert_eq!(vault.config, AppConfig::default());
        drop(vault);

        let reopened = Vault::open(&root).unwrap();
        assert_eq!(reopened.config, AppConfig::default());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn save_config_round_trips_to_yaml_and_mirror() {
        let root = temp_dir("vault-save");
        let mut vault = Vault::open(&root).unwrap();

        let mut config = vault.config.clone();
        config.grid_columns = 10;
        vault.save_config(config).unwrap();

        let reloaded = AppConfig::load_or_create(&root.join("config").join("app.yml")).unwrap();
        assert_eq!(reloaded.grid_columns, 10);

        let mirrored: String = vault
            .conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'grid_columns'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(mirrored, "10");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn vault_path_marker_round_trip() {
        let dir = temp_dir("marker");
        assert_eq!(read_vault_path(&dir), None);

        write_vault_path(&dir, Path::new("/data/pkb")).unwrap();
        assert_eq!(read_vault_path(&dir), Some(PathBuf::from("/data/pkb")));
        let _ = fs::remove_dir_all(&dir);
    }
}
