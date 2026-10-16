import { describe, expect, it } from "vitest";
import { layout, type SectionInput } from "./useColumnSections";
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
