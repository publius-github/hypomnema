use super::*;
use std::fs;

fn conn() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    crate::db::migrate(&conn).unwrap();
    crate::db::set_device_id(&conn, "dev-a").unwrap();
    conn
}

fn def(id: &str, rollup: &str) -> MetricDef {
    MetricDef {
        id: id.into(),
        name: None,
        unit: None,
        decimals: None,
        goal: None,
        better: None,
        rollup: Some(rollup.into()),
        line: None,
    }
}

fn date(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}

#[test]
fn a_day_holds_one_value_and_a_delete_leaves_a_stamped_tombstone() {
    let conn = conn();
    set(&conn, "weight", "2026-11-01", 82.4).unwrap();
    set(&conn, "weight", "2026-11-01", 82.1).unwrap();
    assert_eq!(value_on(&conn, "weight", "2026-11-01"), Some(82.1));
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM measurements", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 1);

    let stamp = |c: &Connection| -> (Option<String>, Option<String>) {
        c.query_row(
            "SELECT updated_at, updated_by FROM measurements WHERE metric = 'weight'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap()
    };
    let (before, by) = stamp(&conn);
    assert_eq!(by.as_deref(), Some("dev-a"));
    std::thread::sleep(std::time::Duration::from_millis(5));
    delete(&conn, "weight", "2026-11-01").unwrap();
    let (after, _) = stamp(&conn);
    assert!(after > before, "a delete must restamp the row");
    assert_eq!(value_on(&conn, "weight", "2026-11-01"), None);
    assert!(since(&conn, "2026-01-01").unwrap().is_empty());
    // and a value can come back on the same day
    set(&conn, "weight", "2026-11-01", 81.9).unwrap();
    assert_eq!(recent(&conn, "weight", 5).unwrap()[0].value, 81.9);
}

#[test]
fn bad_input_is_refused() {
    let conn = conn();
    assert!(set(&conn, "Weight!", "2026-11-01", 1.0).is_err());
    assert!(set(&conn, "weight", "2026-13-01", 1.0).is_err());
    assert!(set(&conn, "weight", "2026-11-01", f64::NAN).is_err());
    // an unpadded date is stored padded, so it cannot become a second day
    set(&conn, "weight", "2026-11-1", 1.0).unwrap();
    assert_eq!(value_on(&conn, "weight", "2026-11-01"), Some(1.0));
}

#[test]
fn the_day_view_lists_measured_days_with_a_seven_day_mean() {
    let conn = conn();
    // 10-26 is outside a 7-day range ending 11-01 but inside the first
    // point's averaging window
    for (d, v) in [
        ("2026-10-25", 90.0),
        ("2026-10-26", 80.0),
        ("2026-10-30", 82.0),
        ("2026-11-01", 84.0),
    ] {
        set(&conn, "weight", d, v).unwrap();
    }
    let s = series(
        &conn,
        &def("weight", "avg"),
        TrendUnit::Day,
        7,
        date("2026-11-01"),
    )
    .unwrap();
    assert_eq!(
        (s.start.as_str(), s.end.as_str()),
        ("2026-10-26", "2026-11-01")
    );
    let got: Vec<(&str, Option<f64>, Option<f64>)> = s
        .points
        .iter()
        .map(|p| (p.date.as_str(), p.value, p.avg))
        .collect();
    assert_eq!(
        got,
        vec![
            // 10-20..10-26: 90 and 80
            ("2026-10-26", Some(80.0), Some(85.0)),
            // 10-24..10-30: 90, 80, 82
            ("2026-10-30", Some(82.0), Some(84.0)),
            // 10-26..11-01: 80, 82, 84
            ("2026-11-01", Some(84.0), Some(82.0)),
        ]
    );
}

#[test]
fn week_and_month_views_fold_each_period_by_the_rollup() {
    let conn = conn();
    // Monday 2026-10-19 and 2026-10-26 weeks
    for (d, v) in [
        ("2026-10-19", 10.0),
        ("2026-10-21", 30.0),
        ("2026-10-26", 5.0),
    ] {
        set(&conn, "m", d, v).unwrap();
    }
    // a Monday: the three weeks start 10-19, 10-26 and 11-02
    let today = date("2026-11-02");
    let values = |rollup: &str, unit: TrendUnit, count: u32| -> Vec<Option<f64>> {
        series(&conn, &def("m", rollup), unit, count, today)
            .unwrap()
            .points
            .iter()
            .map(|p| p.value)
            .collect()
    };
    assert_eq!(
        values("avg", TrendUnit::Week, 3),
        vec![Some(20.0), Some(5.0), None]
    );
    assert_eq!(
        values("sum", TrendUnit::Week, 3),
        vec![Some(40.0), Some(5.0), None]
    );
    assert_eq!(
        values("last", TrendUnit::Week, 3),
        vec![Some(30.0), Some(5.0), None]
    );
    assert_eq!(values("last", TrendUnit::Month, 2), vec![Some(5.0), None]);
    let s = series(&conn, &def("m", "avg"), TrendUnit::Week, 3, today).unwrap();
    assert_eq!(
        (s.start.as_str(), s.end.as_str()),
        ("2026-10-19", "2026-11-02")
    );
}

#[test]
fn definitions_are_checked_one_by_one() {
    let dir = std::env::temp_dir().join("hypomnema-metrics-defs");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join(FILE),
        "metrics:\n  - id: weight\n    unit: kg\n    goal: 75\n    better: down\n  - id: Bad Id\n  - id: weight\n  - id: pushups\n    rollup: median\n  - id: followers\n    rollup: last\n",
    )
    .unwrap();
    let (defs, errors) = load(&dir);
    let ids: Vec<&str> = defs.iter().map(|d| d.id.as_str()).collect();
    assert_eq!(ids, vec!["weight", "followers"]);
    assert_eq!(errors.len(), 3, "{errors:?}");
    assert!(errors[1].message.contains("already used"));
    assert_eq!(validate("metrics:\n  - id: ok\n").len(), 0);
    assert_eq!(validate("metrics: [").len(), 1);

    // adding splices into the file and refuses a taken id
    add(
        &dir,
        MetricDef {
            name: Some(" Steps ".into()),
            unit: Some("".into()),
            ..def("steps", "sum")
        },
    )
    .unwrap();
    assert!(add(&dir, def("steps", "sum")).is_err());
    assert!(add(&dir, def("No Good", "sum")).is_err());
    let text = fs::read_to_string(dir.join(FILE)).unwrap();
    assert!(
        text.contains("- id: steps\n    name: Steps\n    rollup: sum\n"),
        "{text}"
    );
    let (defs, _) = load(&dir);
    assert_eq!(defs.last().unwrap().id, "steps");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn the_overview_shows_the_two_newest_values() {
    let dir = std::env::temp_dir().join("hypomnema-metrics-overview");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(FILE), "metrics:\n  - id: weight\n  - id: empty\n").unwrap();
    let conn = conn();
    for (d, v) in [
        ("2026-10-30", 82.0),
        ("2026-11-01", 81.5),
        ("2026-10-01", 85.0),
    ] {
        set(&conn, "weight", d, v).unwrap();
    }
    let o = overview(&conn, &dir).unwrap();
    assert_eq!(o.metrics.len(), 2);
    assert_eq!(o.metrics[0].latest.as_ref().unwrap().value, 81.5);
    assert_eq!(o.metrics[0].previous.as_ref().unwrap().date, "2026-10-30");
    assert!(o.metrics[1].latest.is_none());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rule_items_with_metrics_are_linked_by_rule_key_and_a_typo_reported() {
    let dir = std::env::temp_dir().join("hypomnema-metrics-links");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(FILE), "metrics:\n  - id: weight\n  - id: waist\n").unwrap();
    fs::write(
        dir.join("recurring.yml"),
        "tasks:\n  - schedule: \"0 8 * * *\"\n    metrics: [weight, waist, wieght]\n    items:\n      - \"{Health} Weigh in\"\n  - schedule: \"0 9 * * *\"\n    items:\n      - \"no metric\"\n",
    )
    .unwrap();
    let o = overview(&conn(), &dir).unwrap();
    let rule = crate::config_files::RecurringRule {
        schedule: "0 8 * * *".into(),
        description: String::new(),
        items: vec![],
        threshold: None,
        id: None,
        metrics: vec![],
    };
    assert_eq!(
        o.links,
        vec![MetricLink {
            rule_key: crate::engine::recurring_rule_key(&rule, "{Health} Weigh in"),
            metrics: vec!["weight".into(), "waist".into()],
        }]
    );
    assert_eq!(o.errors.len(), 1);
    assert!(o.errors[0].message.contains("'wieght'"), "{:?}", o.errors);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_metric_is_rewritten_in_place_and_removed_by_its_id() {
    let dir = std::env::temp_dir().join("hypomnema-metrics-update");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join(FILE),
        "# my metrics\nmetrics:\n  - id: weight\n    unit: kg\n  - id: steps\n    rollup: sum\n",
    )
    .unwrap();
    update(
        &dir,
        "weight",
        Some(MetricDef {
            goal: Some(90.0),
            line: Some("mean".into()),
            unit: Some(" kg ".into()),
            ..def("weight", "avg")
        }),
    )
    .unwrap();
    let (defs, errors) = load(&dir);
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(defs[0].goal, Some(90.0));
    assert_eq!(defs[0].line.as_deref(), Some("mean"));
    assert_eq!(defs[0].unit.as_deref(), Some("kg"));
    assert_eq!(defs[1].id, "steps");
    assert!(fs::read_to_string(dir.join(FILE))
        .unwrap()
        .starts_with("# my metrics\n"));

    // the id cannot change, a bad line is refused, an unknown id too
    assert!(update(&dir, "weight", Some(def("mass", "avg"))).is_err());
    let wavy = MetricDef {
        line: Some("wavy".into()),
        ..def("weight", "avg")
    };
    assert!(update(&dir, "weight", Some(wavy)).is_err());
    assert!(update(&dir, "nope", None).is_err());

    update(&dir, "weight", None).unwrap();
    let (defs, _) = load(&dir);
    let ids: Vec<&str> = defs.iter().map(|d| d.id.as_str()).collect();
    assert_eq!(ids, vec!["steps"]);
    let _ = fs::remove_dir_all(&dir);
}
