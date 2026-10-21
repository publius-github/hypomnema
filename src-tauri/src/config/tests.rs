use super::*;

#[test]
fn defaults_created_when_file_missing() {
    let dir = std::env::temp_dir().join("hypomnema-test-config");
    let _ = fs::remove_dir_all(&dir);
    let path = dir.join("app.yml");

    let (config, error) = AppConfig::load_or_default(&path, &dir);
    assert!(error.is_none());
    assert_eq!(config, AppConfig::default());
    assert!(path.exists());

    let (reloaded, _) = AppConfig::load_or_default(&path, &dir);
    assert_eq!(reloaded, config);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn broken_app_yml_falls_back_to_defaults_with_error() {
    let dir = std::env::temp_dir().join("hypomnema-test-config-broken");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("app.yml");
    fs::write(&path, "theme: [broken\n").unwrap();

    let (config, error) = AppConfig::load_or_default(&path, &dir);
    assert_eq!(config, AppConfig::default());
    assert!(error.is_some());
    // the broken file is left untouched for the user to fix
    assert_eq!(fs::read_to_string(&path).unwrap(), "theme: [broken\n");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn colors_live_in_their_own_file() {
    let dir = std::env::temp_dir().join("hypomnema-test-config-colors");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let (settings, colors) = (dir.join("app.yml"), dir.join("colors.yml"));
    let config = AppConfig {
        grid_columns: 5,
        cadence_color_weekly: "#123456".into(),
        ..AppConfig::default()
    };
    config.save(&settings).unwrap();
    config.save_part(SyncedPart::Colors, &colors).unwrap();
    let app_yml = fs::read_to_string(&settings).unwrap();
    assert!(app_yml.contains("grid_columns: 5"));
    assert!(!app_yml.contains("cadence_color_weekly"));
    let colors_yml = fs::read_to_string(&colors).unwrap();
    assert!(colors_yml.contains("cadence_color_weekly: '#123456'"));
    assert!(!colors_yml.contains("grid_columns"));

    let (loaded, error) = AppConfig::load_or_default(&settings, &dir);
    assert!(error.is_none());
    assert_eq!(loaded, config);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn stale_keys_are_dropped_from_app_yml_on_load() {
    let dir = std::env::temp_dir().join("hypomnema-test-config-stale");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let settings = dir.join("app.yml");
    fs::write(
        &settings,
        "grid_columns: 5\ndone_color: '#123456'\nsection_cards: true\n",
    )
    .unwrap();
    let (loaded, _) = AppConfig::load_or_default(&settings, &dir);
    assert_eq!(loaded.grid_columns, 5);
    let raw = fs::read_to_string(&settings).unwrap();
    assert!(raw.contains("grid_columns: 5"));
    assert!(!raw.contains("done_color"));
    assert!(!raw.contains("section_cards"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn colors_left_in_app_yml_are_ignored() {
    let dir = std::env::temp_dir().join("hypomnema-test-config-legacy-colors");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let settings = dir.join("app.yml");
    fs::write(
        &settings,
        "grid_columns: 5\ncadence_color_weekly: '#123456'\n",
    )
    .unwrap();
    // no colors.yml yet: the defaults, not the stale per-device copy
    let (loaded, error) = AppConfig::load_or_default(&settings, &dir);
    assert!(error.is_none());
    assert_eq!(loaded.grid_columns, 5);
    assert_eq!(
        loaded.cadence_color_weekly,
        AppConfig::default().cadence_color_weekly
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn broken_colors_yml_costs_only_the_colors() {
    let dir = std::env::temp_dir().join("hypomnema-test-config-broken-colors");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let (settings, colors) = (dir.join("app.yml"), dir.join("colors.yml"));
    fs::write(&settings, "grid_columns: 5\n").unwrap();
    fs::write(&colors, "cadence_colors: [not a bool\n").unwrap();
    let (loaded, error) = AppConfig::load_or_default(&settings, &dir);
    assert_eq!(loaded.grid_columns, 5);
    assert_eq!(loaded.cadence_colors, AppConfig::default().cadence_colors);
    assert!(error.unwrap().contains("colors.yml"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn colors_yml_ignores_keys_that_are_not_colors() {
    let colors: serde_yaml::Mapping =
        serde_yaml::from_str("grid_columns: 9\ndone_color: '#00ff00'\n").unwrap();
    let config = AppConfig::default()
        .with_part(SyncedPart::Colors, &colors)
        .unwrap();
    assert_eq!(config.grid_columns, AppConfig::default().grid_columns);
    assert_eq!(config.done_color, "#00ff00");
}

#[test]
fn shared_rules_are_seeded_once_from_an_old_app_yml() {
    let dir = std::env::temp_dir().join("hypomnema-test-config-seed-shared");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let settings = dir.join("app.yml");
    fs::write(
        &settings,
        "grid_columns: 5\nretention_days: 365\ncatchup_days: 30\n",
    )
    .unwrap();
    let (loaded, error) = AppConfig::load_or_default(&settings, &dir);
    assert!(error.is_none());
    assert_eq!((loaded.retention_days, loaded.catchup_days), (365, 30));
    let shared = fs::read_to_string(dir.join("shared.yml")).unwrap();
    assert!(shared.contains("retention_days: 365"));
    assert!(!shared.contains("grid_columns"));
    // and app.yml no longer carries them
    let app_yml = fs::read_to_string(&settings).unwrap();
    assert!(!app_yml.contains("retention_days"));
    assert!(app_yml.contains("grid_columns: 5"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_device_at_the_defaults_does_not_seed_shared_yml() {
    let dir = std::env::temp_dir().join("hypomnema-test-config-no-seed");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let settings = dir.join("app.yml");
    fs::write(&settings, "grid_columns: 5\n").unwrap();
    let _ = AppConfig::load_or_default(&settings, &dir);
    assert!(!dir.join("shared.yml").exists());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn shared_yml_wins_over_an_old_app_yml() {
    let dir = std::env::temp_dir().join("hypomnema-test-config-shared-wins");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let settings = dir.join("app.yml");
    fs::write(&settings, "retention_days: 7\n").unwrap();
    fs::write(dir.join("shared.yml"), "retention_days: 365\n").unwrap();
    let (loaded, _) = AppConfig::load_or_default(&settings, &dir);
    assert_eq!(loaded.retention_days, 365);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn synced_keys_are_real_fields_and_owned_once() {
    let yaml = serde_yaml::to_value(AppConfig::default()).unwrap();
    let mapping = yaml.as_mapping().unwrap();
    for key in SHARED_KEYS {
        assert!(mapping.contains_key(*key), "unknown shared key '{key}'");
        assert!(!COLOR_KEYS.contains(key), "'{key}' is in both files");
    }
}

#[test]
fn color_keys_are_real_fields() {
    let yaml = serde_yaml::to_value(AppConfig::default()).unwrap();
    let mapping = yaml.as_mapping().unwrap();
    for key in COLOR_KEYS {
        assert!(mapping.contains_key(*key), "unknown color key '{key}'");
    }
}

#[test]
fn sanitize_clamps_dangerous_values() {
    let config = AppConfig {
        grid_columns: 0,
        catchup_days: 99_999_999,
        theme: "solarized".into(),
        done_display: "weird".into(),
        dashboard_split: 99,
        section_order: vec!["kb".into(), "typo".into(), "kb".into()],
        section_hidden: vec!["kb".into(), "typo".into(), "kb".into()],
        lists_group_display: "sideways".into(),
        ..AppConfig::default()
    }
    .sanitized();
    assert_eq!(config.section_hidden, vec!["kb"]);
    assert_eq!(config.lists_group_display, "folded");
    assert_eq!(config.grid_columns, 1);
    assert_eq!(config.catchup_days, 365);
    assert_eq!(config.theme, "dark");
    assert_eq!(config.done_display, "inline");
    assert_eq!(config.dashboard_split, 80);
    assert_eq!(
        config.section_order,
        vec![
            "kb",
            "dashboard",
            "lists",
            "days",
            "upcoming",
            "reminders",
            "calendar",
            "history",
            "review",
            "journal"
        ]
    );
}

/// AppConfig fields must be mirrored in settings_pairs by hand;
/// this pins the two together so a new field cannot silently skip
/// the settings mirror.
#[test]
fn settings_pairs_covers_every_field() {
    let config = AppConfig::default();
    let yaml = serde_yaml::to_value(&config).unwrap();
    let mapping = yaml.as_mapping().unwrap();
    let pairs = config.settings_pairs();
    for key in mapping.keys() {
        let key = key.as_str().unwrap();
        assert!(
            pairs.iter().any(|(k, _)| *k == key),
            "settings_pairs is missing '{key}'"
        );
    }
    assert_eq!(pairs.len(), mapping.len());
}

#[test]
fn horizon_follows_the_widest_day_grid() {
    let mut config = AppConfig {
        grid_columns: 3,
        days_page_columns: 10,
        ..Default::default()
    };
    assert_eq!(config.horizon_days(), 10);
    config.days_page_columns = 1;
    assert_eq!(config.horizon_days(), 3);
}

#[test]
fn partial_yaml_falls_back_to_defaults() {
    let config: AppConfig = serde_yaml::from_str("theme: light\n").unwrap();
    assert_eq!(config.theme, "light");
    assert_eq!(config.grid_columns, 3);
}
