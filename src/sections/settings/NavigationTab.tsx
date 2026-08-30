const SECTION_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  lists: "Lists",
  days: "Days",
  upcoming: "Upcoming",
  calendar: "Calendar",
  history: "History",
  journal: "Journal",
  kb: "Notes",
};

import { useAppStore } from "../../store";

export default function NavigationTab() {
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const move = (
    key: "section_order" | "cadence_group_order",
    index: number,
    delta: number,
  ) => {
    if (!config) return;
    const order = [...config[key]];
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    void updateConfig({ [key]: order });
  };
  const moveSection = (index: number, delta: number) =>
    move("section_order", index, delta);
  if (!config) return null;

  return (
    <>

        <span className="text-xs text-content-muted">
          Order of the sections in the left bar.
        </span>
        <div className="flex flex-col gap-1">
          {config.section_order.map((id, i) => (
            <div
              key={id}
              className="flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm"
            >
              <span className="min-w-0 flex-1">
                {SECTION_LABELS[id] ?? id}
              </span>
              <button
                className="btn-ghost px-2 py-0.5 text-xs disabled:opacity-30"
                disabled={i === 0}
                title="Move up"
                onClick={() => moveSection(i, -1)}
              >
                ↑
              </button>
              <button
                className="btn-ghost px-2 py-0.5 text-xs disabled:opacity-30"
                disabled={i === config.section_order.length - 1}
                title="Move down"
                onClick={() => moveSection(i, 1)}
              >
                ↓
              </button>
            </div>
          ))}
        </div>
    </>
  );
}
