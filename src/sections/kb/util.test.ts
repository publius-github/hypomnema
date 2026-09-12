import { describe, expect, it } from "vitest";
import { noteBodyOffset, rebaseStamp } from "./util";

const header = (created: string, edited: string) =>
  `Created: ${created}\nLast edited: ${edited}\n\n`;

describe("rebaseStamp", () => {
  it("takes the written text when nothing was typed meanwhile", () => {
    const written = header("2026-09-12 10:00", "2026-09-12 10:00") + "hi";
    expect(rebaseStamp("hi", written, "hi")).toBe(written);
  });

  it("keeps what was typed while the save ran", () => {
    const sent = header("2026-09-12 10:00", "2026-09-12 10:00") + "body";
    const written = header("2026-09-12 10:00", "2026-09-12 10:05") + "body";
    expect(rebaseStamp(sent, written, sent + " and more")).toBe(
      written + " and more",
    );
  });

  it("carries a header moved back to the top", () => {
    const stamp = header("2026-09-01 09:00", "2026-09-01 09:00");
    const sent = `# Title\n${stamp}body`;
    const written = header("2026-09-01 09:00", "2026-09-12 10:05") + "# Title\nbody";
    expect(rebaseStamp(sent, written, sent + "!")).toBe(written + "!");
  });

  it("gives up when the head itself changed meanwhile", () => {
    const sent = header("2026-09-12 10:00", "2026-09-12 10:00") + "body";
    const written = header("2026-09-12 10:00", "2026-09-12 10:05") + "body";
    expect(rebaseStamp(sent, written, "x" + sent)).toBeNull();
  });
});

describe("noteBodyOffset", () => {
  it("points past the header and its blank line", () => {
    const stamp = header("2026-09-12 10:00", "2026-09-12 10:00");
    expect(noteBodyOffset(stamp + "body")).toBe(stamp.length);
    expect(noteBodyOffset("no header")).toBe(0);
  });
});
