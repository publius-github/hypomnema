import { useEffect, useRef } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
  type Command,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
} from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { languages } from "@codemirror/language-data";
import {
  HighlightStyle,
  bracketMatching,
  syntaxHighlighting,
} from "@codemirror/language";
import { linter, type Diagnostic } from "@codemirror/lint";
import { tags } from "@lezer/highlight";
import { parseDocument } from "yaml";

export type EditorMode = "markdown" | "yaml" | "plain";

// Live-preview-lite: markdown syntax rendered in place (headings sized,
// emphasis styled, code monospaced) while the source stays editable.
const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.5em", fontWeight: "700" },
  { tag: tags.heading2, fontSize: "1.3em", fontWeight: "700" },
  { tag: tags.heading3, fontSize: "1.15em", fontWeight: "600" },
  { tag: tags.heading4, fontWeight: "600" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "rgb(var(--color-accent))" },
  { tag: tags.url, color: "rgb(var(--color-accent))", opacity: "0.8" },
  {
    tag: tags.monospace,
    fontFamily: "var(--editor-font)",
    fontSize: "0.9em",
  },
  { tag: tags.processingInstruction, color: "rgb(var(--color-content-muted))" },
  { tag: tags.quote, color: "rgb(var(--color-content-muted))", fontStyle: "italic" },
  { tag: tags.list, color: "rgb(var(--color-content))" },
]);

// IDE-style YAML colors; fixed mid-tone hues stay readable on both the
// dark and the light background
const yamlHighlight = HighlightStyle.define([
  { tag: tags.definition(tags.propertyName), color: "rgb(var(--color-accent))" },
  { tag: tags.propertyName, color: "rgb(var(--color-accent))" },
  { tag: tags.string, color: "#4d9375" },
  { tag: tags.number, color: "#d19a66" },
  { tag: tags.bool, color: "#c678dd" },
  { tag: tags.null, color: "#c678dd" },
  { tag: tags.keyword, color: "#c678dd" },
  { tag: tags.comment, color: "rgb(var(--color-content-muted))", fontStyle: "italic" },
  { tag: tags.punctuation, color: "rgb(var(--color-content-muted))" },
]);

// the editor font is config-driven (Settings > Appearance) and arrives
// through the --editor-font CSS variable set in the store
const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "14px",
    backgroundColor: "transparent",
    color: "rgb(var(--color-content))",
  },
  ".cm-content": {
    fontFamily: "var(--editor-font)",
    caretColor: "rgb(var(--color-accent))",
    padding: "12px 0",
  },
  ".cm-cursor": { borderLeftColor: "rgb(var(--color-accent))" },
  "&.cm-focused": { outline: "none" },
  ".cm-line": { padding: "0 12px" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "rgb(var(--color-accent) / 0.25) !important",
  },
  ".cm-selectionMatch": {
    backgroundColor: "rgb(var(--color-accent) / 0.15)",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "rgb(var(--color-content-muted) / 0.5)",
    border: "none",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "rgb(var(--color-content))",
  },
  ".cm-tooltip": {
    backgroundColor: "rgb(var(--color-surface-alt))",
    color: "rgb(var(--color-content))",
    border: "1px solid rgb(var(--color-line))",
  },
  ".cm-panels": {
    backgroundColor: "rgb(var(--color-surface-alt))",
    color: "rgb(var(--color-content))",
    borderColor: "rgb(var(--color-line))",
  },
  ".cm-panels input, .cm-panels button": {
    backgroundColor: "transparent",
    color: "rgb(var(--color-content))",
    border: "1px solid rgb(var(--color-line))",
    borderRadius: "4px",
  },
});

const monoTheme = EditorView.theme({
  ".cm-content": {
    fontFamily: "var(--editor-font)",
    fontSize: "13px",
  },
});

function yamlLinter() {
  return linter((view): Diagnostic[] => {
    const text = view.state.doc.toString();
    if (!text.trim()) return [];
    const doc = parseDocument(text);
    return doc.errors.map((err) => {
      const [from, to] = err.pos;
      return {
        from: Math.min(from, text.length),
        to: Math.min(Math.max(to, from + 1), text.length),
        severity: "error",
        message: err.message.split("\n")[0],
      };
    });
  });
}

// Markdown cannot really be "invalid", so the linter flags the
// formatting mistakes that visibly break or degrade rendering:
// unclosed code fences, glued heading/list markers, a heading without
// a blank line above it, and stray trailing whitespace.
function markdownLinter() {
  return linter((view): Diagnostic[] => {
    const diagnostics: Diagnostic[] = [];
    const doc = view.state.doc;
    let lastFenceLine: { from: number; to: number } | null = null;
    let openFences = 0;
    let prevText = "";
    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i);
      if (/^\s*(```|~~~)/.test(line.text)) {
        openFences += 1;
        lastFenceLine = { from: line.from, to: line.to };
        prevText = line.text;
        continue;
      }
      if (openFences % 2 === 1) {
        prevText = line.text;
        continue; // inside a code fence: anything goes
      }
      const badHeading = line.text.match(/^(#{1,6})(?=[^#\s])/);
      if (badHeading) {
        diagnostics.push({
          from: line.from,
          to: line.from + badHeading[1].length + 1,
          severity: "warning",
          message: "Heading marker needs a space: '# Title', not '#Title'",
        });
      }
      if (/^#{1,6}\s/.test(line.text) && i > 1 && prevText.trim() !== "") {
        diagnostics.push({
          from: line.from,
          to: Math.min(line.from + line.text.length, line.to),
          severity: "warning",
          message: "Heading should be preceded by a blank line",
        });
      }
      const badList = line.text.match(/^(\s*)-(?=[^\s-])/);
      if (badList) {
        diagnostics.push({
          from: line.from + badList[1].length,
          to: line.from + badList[1].length + 2,
          severity: "warning",
          message: "List marker needs a space: '- item', not '-item'",
        });
      }
      const trailing = line.text.match(/([ \t]+)$/);
      // exactly two trailing spaces are a markdown hard line break
      if (trailing && trailing[1] !== "  " && line.text.trim() !== "") {
        diagnostics.push({
          from: line.to - trailing[1].length,
          to: line.to,
          severity: "warning",
          message: "Trailing whitespace (two spaces = hard break, anything else is noise)",
        });
      }
      prevText = line.text;
    }
    if (openFences % 2 === 1 && lastFenceLine) {
      diagnostics.push({
        from: lastFenceLine.from,
        to: lastFenceLine.to,
        severity: "warning",
        message: "Unclosed code fence",
      });
    }
    return diagnostics;
  });
}

/**
 * Reformats the markdown table around the cursor: every column padded
 * to its widest cell, separator rows rebuilt keeping their alignment
 * colons. Returns false when the cursor is not inside a table.
 */
function formatTableAt(view: EditorView): boolean {
  const { state } = view;
  const doc = state.doc;
  const cursorLine = doc.lineAt(state.selection.main.head);
  const isTableLine = (text: string) => /^\s*\|/.test(text);
  if (!isTableLine(cursorLine.text)) return false;

  let first = cursorLine.number;
  while (first > 1 && isTableLine(doc.line(first - 1).text)) first -= 1;
  let last = cursorLine.number;
  while (last < doc.lines && isTableLine(doc.line(last + 1).text)) last += 1;

  const rows: string[][] = [];
  for (let i = first; i <= last; i++) {
    const text = doc.line(i).text.trim();
    const inner = text.replace(/^\|/, "").replace(/\|$/, "");
    rows.push(inner.split("|").map((c) => c.trim()));
  }
  const isSeparator = (cells: string[]) =>
    cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
  const columns = Math.max(...rows.map((r) => r.length));
  const widths = Array.from({ length: columns }, (_, col) =>
    Math.max(
      3,
      ...rows
        .filter((r) => !isSeparator(r))
        .map((r) => (r[col] ?? "").length),
    ),
  );
  const formatted = rows
    .map((cells) => {
      const padded = Array.from({ length: columns }, (_, col) => {
        const cell = cells[col] ?? "";
        if (isSeparator(cells)) {
          const left = cell.startsWith(":");
          const right = cell.endsWith(":");
          const dashes = "-".repeat(
            Math.max(1, widths[col] - (left ? 1 : 0) - (right ? 1 : 0)),
          );
          return `${left ? ":" : ""}${dashes}${right ? ":" : ""}`.padEnd(
            widths[col],
            "-",
          );
        }
        return cell.padEnd(widths[col]);
      });
      return `| ${padded.join(" | ")} |`;
    })
    .join("\n");

  const from = doc.line(first).from;
  const to = doc.line(last).to;
  const current = doc.sliceString(from, to);
  if (current === formatted) return true; // already aligned; swallow Tab
  view.dispatch({ changes: { from, to, insert: formatted } });
  return true;
}

// Tab aligns the table under the cursor, otherwise indents (IDE
// behavior); Escape stays free so keyboard users can leave the editor
const tabTableOrIndent: Command = (view) =>
  formatTableAt(view) || indentMore(view);

function modeExtensions(mode: EditorMode): Extension[] {
  switch (mode) {
    case "markdown":
      return [
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        syntaxHighlighting(markdownHighlight),
        markdownLinter(),
      ];
    case "yaml":
      return [
        yaml(),
        syntaxHighlighting(yamlHighlight),
        yamlLinter(),
        monoTheme,
      ];
    case "plain":
      return [monoTheme];
  }
}

export default function MarkdownEditor({
  docKey,
  value,
  onChange,
  showLineNumbers = false,
  mode = "markdown",
}: {
  /** Identity of the document; changing it resets the editor state. */
  docKey: string;
  value: string;
  onChange: (content: string) => void;
  showLineNumbers?: boolean;
  mode?: EditorMode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // last content the editor itself reported; anything else arriving via
  // the value prop is an external change that must reach the document
  const lastEmittedRef = useRef(value);

  useEffect(() => {
    if (!containerRef.current) return;
    lastEmittedRef.current = value;
    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        // IDE-grade editing: multiple cursors (Alt-click), rectangular
        // selection (Alt-drag), bracket pairs, search panel (Ctrl-F),
        // line moves (Alt-Up/Down from defaultKeymap)
        EditorState.allowMultipleSelections.of(true),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        crosshairCursor(),
        bracketMatching(),
        closeBrackets(),
        highlightSelectionMatches(),
        keymap.of([
          { key: "Tab", run: tabTableOrIndent, shift: indentLess },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
        ]),
        EditorView.lineWrapping,
        editorTheme,
        ...modeExtensions(mode),
        ...(showLineNumbers
          ? [lineNumbers(), highlightActiveLineGutter()]
          : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const content = update.state.doc.toString();
            lastEmittedRef.current = content;
            onChangeRef.current(content);
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // recreate the editor only when the document identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  // External reload of the same document (e.g. the file changed on
  // disk): replace the doc in place - the editor is only rebuilt on
  // docKey changes and would otherwise silently ignore the new value.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === lastEmittedRef.current) return;
    const current = view.state.doc.toString();
    if (value !== current) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
    lastEmittedRef.current = value;
  }, [value]);

  return <div ref={containerRef} className="h-full min-h-0 select-text overflow-auto" />;
}
