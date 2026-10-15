import { describe, expect, it } from "vitest";
import { noteBodyOffset, rebaseStamp, serialSaves, settleSave } from "./util";

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

describe("settleSave", () => {
  it("keeps the shown text when the save wrote it as sent", () => {
    expect(settleSave("a", "a", "ab")).toEqual({ content: "ab", base: "a" });
  });

  it("takes a merged result when nothing was typed meanwhile", () => {
    expect(settleSave("a\nb\n", "a\nX\nb\n", "a\nb\n")).toEqual({
      content: "a\nX\nb\n",
      base: "a\nX\nb\n",
    });
  });

  it("carries typing at the end over a change merged in above it", () => {
    expect(settleSave("a\nb", "X\na\nb", "a\nb!")).toEqual({
      content: "X\na\nb!",
      base: "X\na\nb",
    });
  });

  it("keeps typing it cannot rebase, measured against what was sent", () => {
    expect(settleSave("a\nb", "a\nX", "A\nb")).toEqual({
      content: "A\nb",
      base: "a\nb",
    });
  });
});

describe("serialSaves", () => {
  it("runs a save only after the one before it settled, failures included", async () => {
    const queue = serialSaves();
    const log: string[] = [];
    let release!: () => void;
    const first = queue(
      () =>
        new Promise<void>((resolve) => {
          log.push("first start");
          release = () => {
            log.push("first end");
            resolve();
          };
        }),
    );
    const second = queue(async () => {
      log.push("second");
      throw new Error("disk full");
    });
    const third = queue(async () => {
      log.push("third");
    });
    await Promise.resolve();
    expect(log).toEqual(["first start"]);
    release();
    await first;
    await expect(second).rejects.toThrow("disk full");
    await third;
    expect(log).toEqual(["first start", "first end", "second", "third"]);
  });
});
