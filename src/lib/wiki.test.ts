import { describe, expect, it } from "vitest";
import {
  wikiTargetAt,
  wikiTargetFromHref,
  wikiToMarkdownLinks,
} from "./wiki";

describe("wikiToMarkdownLinks", () => {
  it("turns [[name]] into a #wiki markdown link", () => {
    expect(wikiToMarkdownLinks("see [[My Note]] for details")).toBe(
      "see [My Note](#wiki:My%20Note) for details",
    );
  });

  it("leaves text without links untouched", () => {
    expect(wikiToMarkdownLinks("plain [link](https://x) text")).toBe(
      "plain [link](https://x) text",
    );
  });
});

describe("wikiTargetFromHref", () => {
  it("round-trips the encoded name", () => {
    expect(wikiTargetFromHref("#wiki:My%20Note")).toBe("My Note");
    expect(wikiTargetFromHref("https://example.com")).toBe(null);
  });
});

describe("wikiTargetAt", () => {
  const text = "before [[Alpha]] middle [[Beta Note]] after";

  it("finds the link covering the position", () => {
    expect(wikiTargetAt(text, text.indexOf("Alpha"))).toBe("Alpha");
    expect(wikiTargetAt(text, text.indexOf("Beta") + 2)).toBe("Beta Note");
  });

  it("returns null outside any link", () => {
    expect(wikiTargetAt(text, 0)).toBe(null);
    expect(wikiTargetAt(text, text.length - 1)).toBe(null);
  });
});
