import { describe, expect, it } from "vitest";
import { isExternalUrl, urlAt } from "./links";

describe("urlAt", () => {
  it("finds a bare url around the click position", () => {
    const line = "see https://example.com/docs for details";
    expect(urlAt(line, 0)).toBe(null);
    expect(urlAt(line, 10)).toBe("https://example.com/docs");
    expect(urlAt(line, 35)).toBe(null);
  });

  it("drops sentence punctuation glued to the url", () => {
    expect(urlAt("read https://example.com/a.", 12)).toBe(
      "https://example.com/a",
    );
  });

  it("takes the target of a markdown link from anywhere in it", () => {
    const line = "the [docs](https://example.com/docs) explain it";
    expect(urlAt(line, 6)).toBe("https://example.com/docs");
    expect(urlAt(line, 20)).toBe("https://example.com/docs");
    expect(urlAt(line, 40)).toBe(null);
  });

  it("ignores note-local and wiki targets", () => {
    expect(urlAt("[note](other/note.md)", 3)).toBe(null);
    expect(urlAt("[note](#wiki:Other%20Note)", 3)).toBe(null);
    expect(urlAt("a [[Wiki Note]] link", 5)).toBe(null);
  });

  it("handles mailto links", () => {
    expect(urlAt("write to mailto:me@example.com now", 20)).toBe(
      "mailto:me@example.com",
    );
  });

  it("returns null on lines without links", () => {
    expect(urlAt("plain text", 4)).toBe(null);
    expect(urlAt("", 0)).toBe(null);
  });
});

describe("isExternalUrl", () => {
  it("accepts only web and mail schemes", () => {
    expect(isExternalUrl("https://example.com")).toBe(true);
    expect(isExternalUrl("HTTP://example.com")).toBe(true);
    expect(isExternalUrl("mailto:me@example.com")).toBe(true);
    expect(isExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isExternalUrl("./note.md")).toBe(false);
  });
});
