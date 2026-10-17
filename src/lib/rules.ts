import type { RecurringRule, RecurringRuleView } from "../types";

/** The rule a Recurring row shows, in the shape `recurring.yml` holds
 *  it: what an edit sends back as `original`, so the core can refuse
 *  the write when the file changed under the open editor. */
export function ruleOf(view: RecurringRuleView): RecurringRule {
  return {
    schedule: view.schedule,
    description: view.description,
    items: view.items,
    // the view spells "no threshold" as null, the rule as an absent key
    ...(view.threshold != null ? { threshold: view.threshold } : {}),
  };
}

/** What deleting a rule - or editing its schedule, description or an
 *  item, which re-keys it - does to its tasks (engine
 *  `reconcile_recurring`). */
export const RULE_HISTORY_NOTE =
  "All of its tasks go with it, completed ones from past days included - History, streaks and completion rates start over. A task already done today stays.";
