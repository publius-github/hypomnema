# Vault, configuration and engine rules

Where the app keeps its files, what each config file holds and how the task engine behaves. The module-level map is in [ARCHITECTURE.md](ARCHITECTURE.md); everyday use is in [USAGE.md](USAGE.md).

## Your data: the vault

The app keeps its working files in a hidden `.hypomnema` folder inside the vault (like `.git` in a repository); your own content sits at the top level:

```
<vault>/
  journal/                # journal entries
  <notes>                 # knowledge base (unless another folder is set)
  .hypomnemaignore        # hides paths from the notes tree
  .hypomnemasyncignore    # paths sync leaves on this device (same syntax)
  .trash/                 # deleted notes, and files deleted on another device
  .hypomnema/
    app.db                # SQLite: tasks, lists, state (a cache, rebuilt from state/)
    state/                # text snapshot of the database, the copy that syncs
    settings/app.yml      # this device's app settings
    config/               # your YAML config files (see below), synced
    tasks/                # Markdown mirror of manual tasks (editable both ways)
    backups/              # daily database snapshot + copies of configs before overwrite
```

The `tasks/` mirror (enabled in Settings) holds one file per list plus `scheduled.md`: edit tasks in bulk in any text editor and the changes are imported back.

## Configuration

One file per rule type in `.hypomnema/config/`; subfolders work as "packs": any `*.yml` in them is merged into recurring/scheduled/birthdays by its top-level key. Edits are picked up live by a file watcher; a broken file never touches your data, the last valid state stays in effect and a banner shows the error with its file and line.

```yaml
# recurring.yml - repeating tasks
tasks:
  - schedule: "0 0 1 * *"        # cron
    description: "Monthly"
    items:
      - "{05 Finance} pay bills for apartment"   # {List} task text

# scheduled.yml - one-off dated events
events:
  - date: 2026-09-14
    title: "{02 Personal} dentist appointment"
    time: "10:30"                # optional

# birthdays.yml - birthdays
birthdays:
  - name: "John Smith"
    date: "03-14"                # MM-DD
    year: 1985                   # optional, to show the age
```

| File | What it holds | Synced |
|---|---|---|
| `recurring.yml` | Repeating tasks: a cron schedule, a description, the task items | yes |
| `scheduled.yml` | One-off dated events, with an optional time | yes |
| `birthdays.yml` | Birthdays as MM-DD, with an optional year for the age | yes |
| `weekly-focus.yml` | The week's focus phrase, rotated by ISO week | yes |
| `day-reminders.yml` | Reminders by day type: workday, weekend, weekday | yes |
| `day-schedule.yml` | Blocks of the daily schedule | yes |
| `templates/journal.md` | The journal template, supports `{{date}}` | yes |
| `colors.yml` | The color scheme, edited in Notes > Config; absent means the defaults | yes |
| `shared.yml` | Retention, catch-up and the other task rules, written by their Settings controls | yes |
| `cards.yml` | Settings > Tasks (how tasks show), used only while Sync task card settings is on for that device | yes |
| `../settings/app.yml` | This device's app settings and fine-tuning without a Settings control | no |

## Engine rules

- Generation runs at startup, on Sync, when the day changes and when configs change. Duplicates are impossible: the `rule_runs` ledger remembers every generated (rule, period) pair, so restarts and config edits never repeat a task.
- Your edits and statuses are never overwritten: regeneration only creates what is missing. Deleting an instance a later firing has already replaced removes it for good; deleting the rule's current one (today's, or the latest still-due weekly or monthly firing) brings it back on the next run. To stop a rule, edit or remove it in its file.
- Overdue open tasks move to today marked overdue (at most one open copy per rule); daily tasks never count as overdue.
- Missed occurrences within the catch-up window collapse into one (a week away gives one task, not seven).
- Removing a rule removes all of its tasks, completed ones from past days included, so History, streaks and completion rates start over for it; only a task already done today stays. A rule is identified by its schedule, description and item text, so changing any of them counts as removing the old rule and adding a new one (the rule editor says so); the alert threshold can change freely. Completed tasks are otherwise cleaned up by the retention setting.
