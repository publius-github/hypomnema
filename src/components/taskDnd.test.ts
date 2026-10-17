import { describe, expect, it } from "vitest";
import { describeDndId, dndAnnouncements, type DndNames } from "./taskDnd";

const names: DndNames = {
  task: (id) => (id === 42 ? "Plan the week" : undefined),
  list: (id) => (id === 3 ? "Home" : undefined),
  group: (id) => (id === 2 ? "Chores" : undefined),
};

describe("describeDndId", () => {
  it("names tasks, lists, groups and days instead of reading the ids", () => {
    expect(describeDndId("task:42", names)).toBe('task "Plan the week"');
    expect(describeDndId("caltask:42", names)).toBe('task "Plan the week"');
    expect(describeDndId("list:3", names)).toBe('list "Home"');
    expect(describeDndId("listmove:3", names)).toBe('list "Home"');
    expect(describeDndId("group:2", names)).toBe('group "Chores"');
    expect(describeDndId("group:none", names)).toBe("out of its group");
    expect(describeDndId("day:2026-10-15", names)).toBe("Thursday 2026-10-15");
    expect(describeDndId("calday:2026-10-14", names)).toBe("Wednesday 2026-10-14");
  });

  it("falls back to the kind when the name is not loaded", () => {
    expect(describeDndId("task:7", names)).toBe("task");
    expect(describeDndId("list:9", names)).toBe("list");
  });
});

describe("dndAnnouncements", () => {
  const say = dndAnnouncements(names);
  const active = { id: "task:42" };

  it("speaks the pickup, the move, the drop and the cancel in words", () => {
    expect(say.onDragStart({ active })).toBe('Picked up task "Plan the week".');
    expect(say.onDragOver({ active, over: { id: "day:2026-10-15" } })).toBe(
      'Task "Plan the week" is over Thursday 2026-10-15.',
    );
    expect(say.onDragEnd({ active, over: { id: "list:3" } })).toBe(
      'Task "Plan the week" was dropped on list "Home".',
    );
    expect(say.onDragEnd({ active, over: null })).toBe('Task "Plan the week" was put back.');
    expect(say.onDragCancel({ active })).toContain("put back");
  });

  it("never reads a raw id", () => {
    const all = [
      say.onDragStart({ active }),
      say.onDragOver({ active, over: { id: "day:2026-10-15" } }),
      say.onDragEnd({ active, over: { id: "listmove:3" } }),
    ].join(" ");
    expect(all).not.toMatch(/task:|day:|list:|listmove:/);
  });
});
