# Dogfood log — desktop and phone on one vault

ROADMAP.md Phase 3's last item is the one that cannot be closed by
writing code: run both clients against the same real vault for a stretch
and see what the merge actually does. Everything above it in Phase 3 —
the merge, the conflict log, deletions, offline queueing — is built and
unit-tested; this file is where the evidence that it holds up goes.

## Why a log and not just "use it"

The failure mode this guards against is silent. A merge that drops a
field looks exactly like a task you forgot to write down, a week later.
The conflict log makes each decision visible at the moment it is made,
and this file is where each of those entries gets a verdict: **expected**
(the merge did the right thing) or **bug** (it did not, and here is what
should have happened). An entry with no verdict is an unanswered
question, not a clean run.

## Setup

1. Desktop and phone are signed in to the same Google account (Settings >
   Sync on both) and sync the same vault through its Drive app folder
   (`Sync now`, or leave `sync_auto` on). The desktop vault must not sit
   inside a Dropbox / OneDrive folder - Settings > Sync warns if it does.
2. Confirm both ends agree before starting: phone Settings should say
   "Nothing waiting to go up", and a `Sync now` should report `0 in, 0
   out`. A dogfood run that starts out of step tests the catch-up, not
   the merge.
3. Note the starting date below and keep the phone's conflict log
   uncleared for the duration — clearing it is how evidence is lost.

## What to exercise deliberately

Everyday use finds the common cases on its own. These are the ones it
will not reach often enough, and each is a row in the table:

| Scenario | Expected |
| --- | --- |
| Same task edited on both, phone last | Phone's value kept, desktop's in the conflict log |
| Same task edited on both, desktop last | Desktop's value kept, phone's in the log |
| Different fields of one task, one per device | Both survive, no conflict logged |
| Task added on each device while offline | Both present after the next pass |
| Task deleted on the phone, untouched on the desktop | Gone on both |
| Task deleted on one end, edited on the other | Edit survives, deletion logged |
| Same journal day written on both | Other device's text at the path, this device's as `(conflicted copy …)`, both synced |
| Note deleted on the desktop, untouched on the phone | Gone on both after a pass |
| Phone edits with aeroplane mode on, then reconnects | Pass fires on reconnect; pending count returns to 0 |
| Both devices run the engine on the same day | One copy of each generated task, not two |
| Config YAML edited on both | Conflicted copy, and neither device's rules are lost |

The engine one matters most: it is the case `rule_runs`' set union
exists for, and a duplicate there means the dedup ledger did not merge.

## Log

Add a row per conflict-log entry (and per surprise that produced no
entry, which is worse). Keep it terse.

| Date | What happened | Conflict-log entry | Verdict | Follow-up |
| --- | --- | --- | --- | --- |
| | | | | |

## Battery and scheduling notes

Worth recording alongside the merges, since Phase 3 also claims sync
survives real phone conditions:

- Did a pass ever fire while the app was backgrounded? (Expected: no —
  automatic sync runs on resume, on leaving, on a heartbeat while open,
  and on reconnect. Real OS-scheduled background work is the open item
  at the end of ROADMAP.md.)
- Did leaving the app reliably push the last edit? Check the pending
  count on the next launch: a non-zero one that predates the last
  session means the on-leave pass did not complete before Android froze
  the app.
- Anything the battery-usage screen has to say after a week.
