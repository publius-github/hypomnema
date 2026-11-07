import { describe, expect, it } from "vitest";
import {
  checklistProgress,
  layout,
  type SectionInput,
} from "./useColumnSections";
import type { List } from "../types";
import { LIST_GAP_STRIPES } from "../lib/tasks";
import { makeTask } from "../test/fixtures";

const section = (
  key: string,
  stripes: number,
  closed = false,
  tasks = [makeTask({ title: key })],
): SectionInput => ({ key, label: key, color: null, tone: null, stripes, tasks, closed });

describe("layout breaks", () => {
  it("opens the closed blocks with the wide break and spaces them like sections", () => {
    const sections = layout(
      [
        section("daily", 0),
        section("weekly", LIST_GAP_STRIPES.section),
        section("postponed", LIST_GAP_STRIPES.closed, true),
        section("waiting", LIST_GAP_STRIPES.closed, true, []),
        section("done", LIST_GAP_STRIPES.closed, true),
        section("dropped", LIST_GAP_STRIPES.closed, true),
      ],
      () => null,
    );
    expect(sections.map((s) => [s.key, s.stripes])).toEqual([
      ["daily", 0],
      ["weekly", 2],
      ["postponed", 3],
      // the empty waiting block is skipped, Done still follows a closed one
      ["done", 2],
      ["dropped", 2],
    ]);
  });

  it("gives the first closed block the wide break whichever one it is", () => {
    const sections = layout(
      [
        section("daily", 0),
        section("postponed", LIST_GAP_STRIPES.closed, true, []),
        section("done", LIST_GAP_STRIPES.closed, true),
      ],
      () => null,
    );
    expect(sections.map((s) => s.stripes)).toEqual([0, 3]);
  });
});

describe("layout headers", () => {
  it("names the uncategorized block of a section with a blank header", () => {
    const tasks = [
      makeTask({ id: 1, title: "stretch" }),
      makeTask({ id: 2, title: "{Home} dishes" }),
    ];
    const labelOf = (t: { title: string }) =>
      t.title.startsWith("{Home}") ? "Home" : null;
    const input = {
      key: "recurring",
      label: "Recurring",
      color: null,
      tone: null,
      stripes: 0,
      tasks,
    };
    const [named] = layout([{ ...input, blankHeader: "No category" }], labelOf);
    expect(named.rows.map((r) => [r.header, r.headerBlank, r.label])).toEqual([
      ["No category", true, null],
      ["Home", false, "Home"],
    ]);
    // without one the uncategorized block stays unheaded
    const [plain] = layout([input], labelOf);
    expect(plain.rows.map((r) => r.header)).toEqual([null, "Home"]);
  });
});

describe("checklistProgress", () => {
  const list: List = {
    id: 9,
    name: "Packing",
    sort_order: 0,
    color: null,
    archived: false,
    auto: false,
    favorite: false,
    description: "",
    kind: "checklist",
    group_id: null,
  };

  it("counts the column's top-level items, a dropped one left out", () => {
    const docs = makeTask({ list_id: 9, status: "done" });
    const tasks = [
      docs,
      makeTask({ parent_task_id: docs.id, status: "done" }),
      makeTask({ list_id: 9 }),
      makeTask({ list_id: 9, status: "dropped" }),
      makeTask({ list_id: 8, status: "done" }),
    ];
    expect(checklistProgress(tasks, list)).toEqual({ done: 1, total: 2 });
  });
});
