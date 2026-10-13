//! Named settings profiles: snapshots of the visual subset of
//! AppConfig (config::PROFILE_KEYS) as flat YAML mappings under
//! `.hypomnema/settings/profiles/<name>.yml`. The format is forward
//! compatible in both directions: a profile written before a field
//! existed simply lacks the key (the default fills in on apply), and
//! unknown or out-of-scope keys in a hand-edited file are ignored -
//! including smuggled behavioral keys like `kb_path`, which must never
//! ride in through a profile.
//!
//! "Default" is the reserved built-in profile: the empty overlay, so
//! applying it resets every profile-scope field to its default.

use std::fs;
use std::path::{Path, PathBuf};

use crate::config::{AppConfig, PROFILE_KEYS};
use crate::error::{Error, Result};
use crate::vault;

pub const DEFAULT_PROFILE: &str = "Default";

fn validate_name(name: &str) -> Result<&str> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::State("profile name cannot be empty".into()));
    }
    if name.chars().count() > 64 {
        return Err(Error::State("profile name is too long (max 64)".into()));
    }
    if name.starts_with('.') {
        return Err(Error::State("profile name cannot start with a dot".into()));
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '_' | '-' | '.'))
    {
        return Err(Error::State(
            "profile name may only use letters, digits, space, _ - .".into(),
        ));
    }
    if name.eq_ignore_ascii_case(DEFAULT_PROFILE) {
        return Err(Error::State(
            "\"Default\" is the built-in profile and cannot be replaced".into(),
        ));
    }
    Ok(name)
}

fn profile_path(root: &Path, name: &str) -> PathBuf {
    vault::profiles_dir(root).join(format!("{name}.yml"))
}

/// Saved profile names, sorted case-insensitively. The built-in Default
/// is not listed - the UI renders it as its own fixed row.
pub fn list(root: &Path) -> Result<Vec<String>> {
    let mut names = Vec::new();
    if let Ok(entries) = fs::read_dir(vault::profiles_dir(root)) {
        for entry in entries.flatten() {
            let file = entry.file_name().to_string_lossy().into_owned();
            if let Some(stem) = file.strip_suffix(".yml") {
                if !stem.starts_with('.') && !stem.is_empty() {
                    names.push(stem.to_string());
                }
            }
        }
    }
    names.sort_by_key(|n| n.to_lowercase());
    Ok(names)
}

/// Snapshots the config's profile-scope subset under the given name
/// (overwriting an existing profile of that name).
pub fn save(root: &Path, config: &AppConfig, name: &str) -> Result<()> {
    let name = validate_name(name)?;
    let dir = vault::profiles_dir(root);
    fs::create_dir_all(&dir)?;
    let subset = config.profile_subset()?;
    vault::write_atomic(&profile_path(root, name), &serde_yaml::to_string(&subset)?)
}

/// The current config with every profile-scope key reset to its default
/// and the profile's values overlaid. Only PROFILE_KEYS entries of the
/// file apply; everything else in the config stays as it is. Any
/// failure leaves the caller's config untouched - this only computes
/// the result, saving it is the caller's move.
pub fn apply(root: &Path, current: &AppConfig, name: &str) -> Result<AppConfig> {
    let overlay: serde_yaml::Mapping = if name.trim().eq_ignore_ascii_case(DEFAULT_PROFILE) {
        serde_yaml::Mapping::new()
    } else {
        let name = validate_name(name)?;
        let path = profile_path(root, name);
        let raw = fs::read_to_string(&path)
            .map_err(|_| Error::State(format!("profile not found: {name}")))?;
        serde_yaml::from_str(&raw)
            .map_err(|e| Error::State(format!("invalid profile file {name}.yml: {e}")))?
    };
    let mut value = serde_yaml::to_value(current)?;
    let mapping = value
        .as_mapping_mut()
        .ok_or_else(|| Error::State("config did not serialize to a mapping".into()))?;
    let defaults = serde_yaml::to_value(AppConfig::default())?;
    let defaults = defaults
        .as_mapping()
        .ok_or_else(|| Error::State("defaults did not serialize to a mapping".into()))?;
    for key in PROFILE_KEYS {
        let key = serde_yaml::Value::from(*key);
        if let Some(default) = defaults.get(&key) {
            mapping.insert(key, default.clone());
        }
    }
    for (key, val) in overlay {
        let in_scope = key
            .as_str()
            .map(|k| PROFILE_KEYS.contains(&k))
            .unwrap_or(false);
        if in_scope {
            mapping.insert(key, val);
        }
    }
    let config: AppConfig = serde_yaml::from_value(value)
        .map_err(|e| Error::State(format!("profile does not apply: {e}")))?;
    // reuses every clamp and hex validation: a malformed color in a
    // hand-edited profile falls back instead of reaching the DOM
    Ok(config.sanitized())
}

pub fn delete(root: &Path, name: &str) -> Result<()> {
    let name = validate_name(name)?;
    fs::remove_file(profile_path(root, name))
        .map_err(|_| Error::State(format!("profile not found: {name}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("app-pkb-profiles-{tag}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn customized() -> AppConfig {
        AppConfig {
            // profile scope
            theme: "light".into(),
            accent_color: "#112233".into(),
            grid_columns: 5,
            list_gap_stripe: 80,
            cron_weekday_labels: false,
            // out of scope
            kb_path: "/notes".into(),
            catchup_days: 30,
            tasks_mirror: false,
            undo_toast_seconds: 12,
            ..AppConfig::default()
        }
    }

    #[test]
    fn round_trip_restores_visuals_and_leaves_behavior_alone() {
        let root = root("roundtrip");
        let original = customized();
        save(&root, &original, "mine").unwrap();

        // drift the visuals and a non-scope field
        let drifted = AppConfig {
            theme: "dark".into(),
            accent_color: String::new(),
            grid_columns: 9,
            list_gap_stripe: 40,
            catchup_days: 60,
            ..original.clone()
        };
        let applied = apply(&root, &drifted, "mine").unwrap();
        assert_eq!(applied.theme, "light");
        assert_eq!(applied.accent_color, "#112233");
        assert_eq!(applied.grid_columns, 5);
        assert_eq!(applied.list_gap_stripe, 80);
        assert!(!applied.cron_weekday_labels);
        // non-scope fields keep the drifted (current) values
        assert_eq!(applied.catchup_days, 60);
        assert_eq!(applied.kb_path, "/notes");
        assert!(!applied.tasks_mirror);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn default_profile_resets_scope_to_defaults_only() {
        let root = root("default");
        let applied = apply(&root, &customized(), DEFAULT_PROFILE).unwrap();
        let defaults = AppConfig::default();
        assert_eq!(applied.theme, defaults.theme);
        assert_eq!(applied.accent_color, defaults.accent_color);
        assert_eq!(applied.grid_columns, defaults.grid_columns);
        // behavior survives a full visual reset
        assert_eq!(applied.kb_path, "/notes");
        assert_eq!(applied.catchup_days, 30);
        assert_eq!(applied.undo_toast_seconds, 12);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn partial_old_profile_fills_missing_keys_with_defaults() {
        let root = root("partial");
        fs::create_dir_all(vault::profiles_dir(&root)).unwrap();
        fs::write(profile_path(&root, "old"), "theme: light\n").unwrap();
        let applied = apply(&root, &customized(), "old").unwrap();
        assert_eq!(applied.theme, "light");
        // scope keys the old file never knew reset to defaults
        assert_eq!(applied.accent_color, "");
        assert_eq!(applied.grid_columns, AppConfig::default().grid_columns);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn out_of_scope_and_unknown_keys_in_a_profile_are_ignored() {
        let root = root("smuggle");
        fs::create_dir_all(vault::profiles_dir(&root)).unwrap();
        fs::write(
            profile_path(&root, "evil"),
            "theme: light\nkb_path: /evil\ntasks_mirror: true\nno_such_key: 1\n",
        )
        .unwrap();
        let applied = apply(&root, &customized(), "evil").unwrap();
        assert_eq!(applied.theme, "light");
        assert_eq!(applied.kb_path, "/notes");
        assert!(!applied.tasks_mirror);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn broken_profile_yaml_is_an_error() {
        let root = root("broken");
        fs::create_dir_all(vault::profiles_dir(&root)).unwrap();
        fs::write(profile_path(&root, "bad"), "theme: [broken\n").unwrap();
        assert!(apply(&root, &AppConfig::default(), "bad").is_err());
        assert!(apply(&root, &AppConfig::default(), "missing").is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn malformed_values_fall_back_through_sanitize() {
        let root = root("sanitize");
        fs::create_dir_all(vault::profiles_dir(&root)).unwrap();
        fs::write(
            profile_path(&root, "odd"),
            "accent_color: not-a-color\ngrid_columns: 99\n",
        )
        .unwrap();
        let applied = apply(&root, &AppConfig::default(), "odd").unwrap();
        assert_eq!(applied.accent_color, "");
        assert_eq!(applied.grid_columns, 31);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn name_validation_rejects_bad_and_reserved_names() {
        let root = root("names");
        let config = AppConfig::default();
        assert!(save(&root, &config, "").is_err());
        assert!(save(&root, &config, "../x").is_err());
        assert!(save(&root, &config, "a/b").is_err());
        assert!(save(&root, &config, ".hidden").is_err());
        assert!(save(&root, &config, "default").is_err());
        assert!(save(&root, &config, "Default").is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn list_and_delete_round_trip_sorted() {
        let root = root("list");
        let config = AppConfig::default();
        save(&root, &config, "beta").unwrap();
        save(&root, &config, "Alpha").unwrap();
        assert_eq!(list(&root).unwrap(), vec!["Alpha", "beta"]);
        delete(&root, "beta").unwrap();
        assert_eq!(list(&root).unwrap(), vec!["Alpha"]);
        assert!(delete(&root, "beta").is_err());
        let _ = fs::remove_dir_all(&root);
    }
}
