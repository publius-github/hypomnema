import { useEffect, useRef } from "react";
import {
  EditorState,
  Prec,
  RangeSetBuilder,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
  type Command,
  type DecorationSet,
  type ViewUpdate,
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
  syntaxTree,
} from "@codemirror/language";
import { linter, type Diagnostic } from "@codemirror/lint";
import { tags } from "@lezer/highlight";
import { parseDocument } from "yaml";
import { lintMarkdown } from "../lib/markdownLint";
import { formatTableBlock, isTableLine } from "../lib/markdownTable";
import { wikiTargetAt } from "../lib/wiki";

export type EditorMode = "markdown" | "yaml" | "plain";

// Live-preview-lite: markdown syntax rendered in place (headings sized,
// emphasis styled, code monospaced) while the source stays editable.
// Token colors follow the VS Code Dark+/Light+ specs (dark_vs.json /
// light_vs.json markup rules) via the --md-* theme vars in styles.css.
const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.5em", fontWeight: "700", color: "var(--md-heading)" },
  { tag: tags.heading2, fontSize: "1.3em", fontWeight: "700", color: "var(--md-heading)" },
  { tag: tags.heading3, fontSize: "1.15em", fontWeight: "600", color: "var(--md-heading)" },
  { tag: tags.heading4, fontWeight: "600", color: "var(--md-heading)" },
  { tag: tags.heading, fontWeight: "600", color: "var(--md-heading)" },
  { tag: tags.strong, fontWeight: "700", color: "var(--md-bold)" },
  { tag: tags.emphasis, fontStyle: "italic", color: "var(--md-italic)" },
  { tag: tags.strikethrough, textDecoration: "line-through", color: "rgb(var(--color-content-muted))" },
  // link/checkbox text takes the string color per the VS Code spec;
  // the URL itself has no color rule there, only the underline
  { tag: tags.link, color: "var(--md-link)" },
  { tag: tags.url, textDecoration: "underline", opacity: "0.8" },
  {
    tag: tags.monospace,
    fontFamily: "var(--editor-font)",
    fontSize: "0.9em",
    color: "var(--md-code)",
  },
  { tag: tags.labelName, color: "var(--md-code)" },
  { tag: tags.processingInstruction, color: "var(--md-marker)" },
  { tag: tags.contentSeparator, color: "var(--md-marker)" },
  { tag: tags.quote, color: "var(--md-quote)", fontStyle: "italic" },
  // tags.list covers whole list items in lezer-markdown, so it stays
  // uncolored - only the marks (processingInstruction) get the list
  // punctuation color. Task markers ([x] checkboxes) are atoms and take
  // the string color, matching VS Code.
  { tag: tags.atom, color: "var(--md-link)" },
  { tag: tags.comment, color: "var(--md-quote)", fontStyle: "italic" },
  { tag: tags.escape, color: "var(--md-code)" },
]);

// Square brackets (links, wiki links, checkboxes) stay in the default
// text color - only the content between them takes the token color.
// Decorating just the LinkMark/TaskMarker nodes made the color jump
// while typing: a half-typed link is not a Link node yet, so its
// brackets briefly wore the token color of whatever the parser guessed.
// Instead EVERY literal [ and ] outside code gets the plain color -
// parse-independent, so nothing flickers.
// Overlapping mark decorations do NOT merge into one span: the view
// nests one <span> per mark, and "nesting order is determined by
// precedence of the facet, with the higher-precedence decorations
// creating the inner DOM nodes" (CM docs). syntaxHighlighting() ships
// as Prec.high, so at default precedence this mark rendered OUTSIDE
// the token span and the token class (link/marker/atom - the orange
// and blue) recolored the bracket from within, overriding the
// inherited style. The plugin is therefore mounted with Prec.highest
// (see modeExtensions), which puts this span innermost - the inline
// style then sits on the element that directly holds the character
// and nothing can restyle it. Guarded by markdownBrackets.test.ts.
const bracketMark = Decoration.mark({
  class: "cm-md-bracket",
  attributes: { style: "color: rgb(var(--color-content))" },
});

function bracketDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    // inside code spans/blocks the brackets keep their code color
    const code: { from: number; to: number }[] = [];
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name.includes("Code")) {
          code.push({ from: node.from, to: node.to });
          return false;
        }
      },
    });
    const text = view.state.doc.sliceString(from, to);
    let c = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch !== "[" && ch !== "]") continue;
      const pos = from + i;
      while (c < code.length && code[c].to <= pos) c++;
      if (c < code.length && code[c].from <= pos) continue;
      builder.add(pos, pos + 1, bracketMark);
    }
  }
  return builder.finish();
}

const plainBrackets = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = bracketDecorations(view);
    }
    update(update: ViewUpdate) {
      // the tree comparison keeps the code-span exclusion in sync with
      // the asynchronously finishing parse
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      ) {
        this.decorations = bracketDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// Table rows are aligned by character count (lib/markdownTable), which
// only lines up visually in a monospace font - with a proportional
// editor font the columns drift no matter how well the source is
// padded. Table lines therefore always render monospace.
const tableLineDeco = Decoration.line({ class: "cm-md-table" });

function tableDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      if (isTableLine(line.text)) {
        builder.add(line.from, line.from, tableLineDeco);
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const tableLines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = tableDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = tableDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

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
    fontSize: "var(--editor-font-size, 14px)",
    backgroundColor: "transparent",
    color: "rgb(var(--color-content))",
  },
  ".cm-content": {
    fontFamily: "var(--editor-font)",
    caretColor: "rgb(var(--color-accent))",
    padding: "12px 0",
  },
  ".cm-cursor": { borderLeftColor: "rgb(var(--color-accent))" },
  // the two-class selector outweighs the single-class token color the
  // highlighter puts on the same span
  ".cm-content .cm-md-bracket": { color: "rgb(var(--color-content))" },
  ".cm-content .cm-md-table": {
    fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace',
  },
  // inline tokens inside a table row (code spans, bold, links) must not
  // change font or size - one cell with `code` at 0.9em breaks the
  // character-count alignment of the whole column
  ".cm-content .cm-md-table span": {
    fontFamily: "inherit",
    fontSize: "inherit",
    letterSpacing: "inherit",
  },
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
    color: "rgb(var(--color-content-muted) / 0.7)",
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
  ".cm-panels input": {
    backgroundColor: "rgb(var(--color-surface))",
    color: "rgb(var(--color-content))",
    border: "1px solid rgb(var(--color-line))",
    borderRadius: "4px",
  },
  // CodeMirror's stock buttons use a light gradient that turns
  // unreadable next to light text on the dark theme
  ".cm-panels button": {
    backgroundImage: "none",
    backgroundColor: "rgb(var(--color-line) / 0.35)",
    color: "rgb(var(--color-content))",
    border: "1px solid rgb(var(--color-line))",
    borderRadius: "4px",
  },
  ".cm-panels button:hover": {
    backgroundColor: "rgb(var(--color-line) / 0.6)",
  },
  ".cm-panels label": {
    color: "rgb(var(--color-content-muted))",
  },
});

const monoTheme = EditorView.theme({
  ".cm-content": {
    fontFamily: "var(--editor-font)",
    // config files read a hair smaller than prose
    fontSize: "calc(var(--editor-font-size, 14px) - 1px)",
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
// formatting mistakes that visibly break or degrade rendering: unclosed
// code fences, glued heading/list markers, a heading without a blank
// line above it, stray trailing whitespace (rules in lib/markdownLint).
function markdownLinter() {
  return linter(
    (view): Diagnostic[] => lintMarkdown(view.state.doc.toString()),
  );
}

/**
 * Reformats the whole markdown table around the cursor (all contiguous
 * table lines) via lib/markdownTable. Returns false when the cursor is
 * not inside a table.
 */
function formatTableAt(view: EditorView): boolean {
  const { state } = view;
  const doc = state.doc;
  const cursorLine = doc.lineAt(state.selection.main.head);
  if (!isTableLine(cursorLine.text)) return false;

  let first = cursorLine.number;
  while (first > 1 && isTableLine(doc.line(first - 1).text)) first -= 1;
  let last = cursorLine.number;
  while (last < doc.lines && isTableLine(doc.line(last + 1).text)) last += 1;

  const lines: string[] = [];
  for (let i = first; i <= last; i++) lines.push(doc.line(i).text);
  const formatted = formatTableBlock(lines).join("\n");

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

// exported for the DOM regression test (bracket span nesting)
export function modeExtensions(mode: EditorMode): Extension[] {
  switch (mode) {
    case "markdown":
      return [
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        syntaxHighlighting(markdownHighlight),
        // must outrank the Prec.high tree highlighter so the bracket
        // span nests inside the token span, not around it
        Prec.highest(plainBrackets),
        tableLines,
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
  onWikiLink,
}: {
  /** Identity of the document; changing it resets the editor state. */
  docKey: string;
  value: string;
  onChange: (content: string) => void;
  showLineNumbers?: boolean;
  mode?: EditorMode;
  /** Ctrl/Cmd+click on a [[wiki link]] calls this with the link name. */
  onWikiLink?: (name: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onWikiLinkRef = useRef(onWikiLink);
  onWikiLinkRef.current = onWikiLink;
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
        // Ctrl/Cmd+click on [[note name]] jumps to that note
        EditorView.domEventHandlers({
          mousedown: (event, view) => {
            if (!(event.ctrlKey || event.metaKey) || !onWikiLinkRef.current) {
              return false;
            }
            const pos = view.posAtCoords({
              x: event.clientX,
              y: event.clientY,
            });
            if (pos === null) return false;
            const line = view.state.doc.lineAt(pos);
            const target = wikiTargetAt(line.text, pos - line.from);
            if (!target) return false;
            event.preventDefault();
            onWikiLinkRef.current(target);
            return true;
          },
        }),
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
