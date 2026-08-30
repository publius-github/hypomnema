// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { modeExtensions } from "./MarkdownEditor";

// Regression test for bracket coloring. Overlapping mark decorations
// render as NESTED spans, innermost = highest facet precedence; the
// syntax highlighter ships as Prec.high, so at default precedence the
// bracket mark wrapped AROUND the token span and the token class
// (link/marker/atom) recolored the character from within. The editor
// mounts the bracket plugin with Prec.highest, which must put the
// bracket span (with its inline color style) directly around the
// character, inside any token span.
describe("markdown bracket decorations", () => {
  it("every bracket outside code renders inside the plain-color span", () => {
    const doc = [
      "# head [ref]",
      "- [x] task",
      "[link](https://example.com)",
      "plain [alone] text",
    ].join("\n");
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: modeExtensions("markdown"),
      }),
      parent: document.body,
    });

    const walker = document.createTreeWalker(
      view.contentDOM,
      NodeFilter.SHOW_TEXT,
    );
    let brackets = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent ?? "";
      if (text === "[" || text === "]") {
        brackets++;
        const parent = n.parentElement as HTMLElement;
        expect(parent.className).toContain("cm-md-bracket");
        expect(parent.style.color).not.toBe("");
      } else {
        // a bracket inside a longer text run means it escaped the
        // decoration entirely
        expect(text).not.toMatch(/[[\]]/);
      }
    }
    expect(brackets).toBe(8);
    view.destroy();
  });
});
