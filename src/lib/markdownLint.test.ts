import { describe, expect, it } from "vitest";
import { lintMarkdown } from "./markdownLint";

const messages = (text: string) => lintMarkdown(text).map((i) => i.message);

describe("lintMarkdown", () => {
  it("passes clean markdown", () => {
    expect(
      lintMarkdown("# Title\n\nSome text.\n\n- item one\n- item two\n"),
    ).toEqual([]);
  });

  it("flags a heading marker glued to its text", () => {
    expect(messages("#Title\n")).toContainEqual(
      expect.stringContaining("Heading marker needs a space"),
    );
  });

  it("flags a heading without a blank line above", () => {
    expect(messages("text\n## Section\n")).toContainEqual(
      expect.stringContaining("preceded by a blank line"),
    );
    expect(messages("text\n\n## Section\n")).toEqual([]);
  });

  it("flags a glued list marker but not a horizontal rule", () => {
    expect(messages("-item\n")).toContainEqual(
      expect.stringContaining("List marker needs a space"),
    );
    expect(messages("---\n")).toEqual([]);
  });

  it("flags trailing whitespace except the two-space hard break", () => {
    expect(messages("text \n")).toContainEqual(
      expect.stringContaining("Trailing whitespace"),
    );
    expect(messages("hard break  \nnext\n")).toEqual([]);
  });

  it("flags an unclosed code fence and skips rules inside fences", () => {
    expect(messages("```\n#not a heading\n")).toEqual([
      "Unclosed code fence",
    ]);
    expect(messages("```\n#code\n-code\n```\n")).toEqual([]);
  });
});
