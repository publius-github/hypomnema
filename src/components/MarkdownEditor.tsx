import { useEffect, useRef } from "react";
import { Compartment, EditorState, Prec, RangeSetBuilder, type Extension, Transaction } from "@codemirror/state";
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
import { lintGutter, linter, type Diagnostic } from "@codemirror/lint";
import { tags } from "@lezer/highlight";
import { parseDocument } from "yaml";
import { lintMarkdown } from "../lib/markdownLint";
import { formatTableBlock, isTableLine } from "../lib/markdownTable";
import { urlAt } from "../lib/links";
import { wikiTargetAt } from "../lib/wiki";
import { useAppStore } from "../store";

export type EditorMode = "markdown" | "yaml" | "plain";

// Word wrap, toggled with Alt+Z as in VS Code: off, a long line (a wide
// Markdown table above all) stays on one row and scrolls sideways
// instead of folding into a ragged block. The choice holds for the
// session across documents - every editor reads it when it is built.
let wrapLines = true;
const wrapCompartment = new Compartment();

const toggleWrap: Command = (view) => {
  wrapLines = !wrapLines;
  view.dispatch({
    effects: wrapCompartment.reconfigure(
      wrapLines ? EditorView.lineWrapping : [],
    ),
  });
  return true;
};

// Live-preview-lite: markdown syntax rendered in place (headings bold
// but at the text size - a note reads as one even column, no line
// jumps in height - emphasis styled, code monospaced) while the source stays editable.
// Token colors follow the VS Code Dark+/Light+ specs (dark_vs.json /
// light_vs.json markup rules) via the --md-* theme vars in styles.css.
const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "700", color: "var(--md-heading)" },
  { tag: tags.strong, fontWeight: "700", color: "var(--md-bold)" },
  { tag: tags.emphasis, fontStyle: "italic", color: "var(--md-italic)" },
  { tag: tags.strikethrough, textDecoration: "line-through", color: "rgb(var(--rgb-content-muted))" },
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
  attributes: { style: "color: rgb(var(--rgb-content))" },
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

// YAML colors per the VS Code Dark+/Light+ specs via the --yaml-* theme
// vars in styles.css (keys like entity.name.tag, green comments, blue
// keywords - not the generic mid-tone scheme used before)
const yamlHighlight = HighlightStyle.define([
  { tag: tags.definition(tags.propertyName), color: "var(--yaml-key)" },
  { tag: tags.propertyName, color: "var(--yaml-key)" },
  { tag: tags.string, color: "var(--yaml-string)" },
  { tag: tags.number, color: "var(--yaml-number)" },
  { tag: tags.bool, color: "var(--yaml-keyword)" },
  { tag: tags.null, color: "var(--yaml-keyword)" },
  { tag: tags.keyword, color: "var(--yaml-keyword)" },
  { tag: tags.comment, color: "var(--yaml-comment)", fontStyle: "italic" },
  { tag: tags.punctuation, color: "rgb(var(--rgb-content-muted))" },
]);

// the editor font is config-driven (Settings > Appearance) and arrives
// through the --editor-font CSS variable set in the store
const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "var(--editor-font-size, 14px)",
    backgroundColor: "transparent",
    color: "rgb(var(--rgb-content))",
  },
  ".cm-content": {
    fontFamily: "var(--editor-font)",
    caretColor: "rgb(var(--rgb-accent))",
    padding: "12px 0",
  },
  ".cm-cursor": { borderLeftColor: "rgb(var(--rgb-accent))" },
  // the two-class selector outweighs the single-class token color the
  // highlighter puts on the same span
  ".cm-content .cm-md-bracket": { color: "rgb(var(--rgb-content))" },
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
    backgroundColor: "rgb(var(--rgb-accent) / 0.25) !important",
  },
  ".cm-selectionMatch": {
    backgroundColor: "rgb(var(--rgb-accent) / 0.15)",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "rgb(var(--rgb-content-muted) / 0.7)",
    border: "none",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "rgb(var(--rgb-content))",
  },
  ".cm-tooltip": {
    backgroundColor: "rgb(var(--rgb-surface-alt))",
    color: "rgb(var(--rgb-content))",
    border: "1px solid rgb(var(--rgb-line))",
  },
  ".cm-panels": {
    backgroundColor: "rgb(var(--rgb-surface-alt))",
    color: "rgb(var(--rgb-content))",
    borderColor: "rgb(var(--rgb-line))",
  },
  // CodeMirror sizes the search panel's own controls at 70-80% of the
  // editor font, which at a comfortable editor size leaves buttons a
  // few pixels tall. Everything in the panel follows the editor text.
  ".cm-panel.cm-search": {
    fontSize: "var(--editor-font-size, 14px)",
    padding: "6px 8px 8px",
  },
  ".cm-panels input": {
    backgroundColor: "rgb(var(--rgb-surface))",
    color: "rgb(var(--rgb-content))",
    border: "1px solid rgb(var(--rgb-line))",
    borderRadius: "4px",
    fontSize: "inherit",
    padding: "3px 6px",
  },
  // CodeMirror's stock buttons use a light gradient that turns
  // unreadable next to light text on the dark theme
  ".cm-panels button": {
    backgroundImage: "none",
    backgroundColor: "rgb(var(--rgb-line) / 0.35)",
    color: "rgb(var(--rgb-content))",
    border: "1px solid rgb(var(--rgb-line))",
    borderRadius: "4px",
    fontSize: "inherit",
    padding: "3px 10px",
  },
  ".cm-panels button:hover": {
    backgroundColor: "rgb(var(--rgb-line) / 0.6)",
  },
  ".cm-panels label": {
    color: "rgb(var(--rgb-content-muted))",
  },
  // the stock rule is `.cm-panel.cm-search label { font-size: 80% }`,
  // which outweighs a plain `.cm-panels label`
  ".cm-panel.cm-search label": {
    fontSize: "inherit",
  },
  ".cm-panel.cm-search input[type=checkbox]": {
    width: "1em",
    height: "1em",
  },
  ".cm-panel.cm-search [name=close]": {
    fontSize: "1.4em",
    lineHeight: "1",
    padding: "0 4px",
    color: "rgb(var(--rgb-content-muted))",
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

// exported for the DOM regression test (bracket span nesting). A
// reading view leaves the linters out: squiggles under text that cannot
// be edited from there are noise.
export function modeExtensions(
  mode: EditorMode,
  { lint = true }: { lint?: boolean } = {},
): Extension[] {
  switch (mode) {
    case "markdown":
      return [
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        syntaxHighlighting(markdownHighlight),
        // must outrank the Prec.high tree highlighter so the bracket
        // span nests inside the token span, not around it
        Prec.highest(plainBrackets),
        tableLines,
        // squiggles only: a gutter marker on every glued list marker
        // turns a half-written journal entry into a wall of warnings
        ...(lint ? [markdownLinter()] : []),
      ];
    case "yaml":
      return [
        yaml(),
        syntaxHighlighting(yamlHighlight),
        ...(lint ? [yamlLinter(), lintGutter()] : []),
        monoTheme,
      ];
    case "plain":
      return [monoTheme];
  }
}

export default function MarkdownEditor({
  docKey,
  value,
  initialAnchor = 0,
  onChange,
  showLineNumbers = false,
  mode = "markdown",
  onWikiLink,
  label,
  readOnly = false,
}: {
  /** Identity of the document; changing it resets the editor state. */
  docKey: string;
  /** What screen readers call the text area ("Journal entry 2026-10-14"). */
  label: string;
  value: string;
  /** where the cursor starts when the document is (re)created */
  initialAnchor?: number;
  onChange: (content: string) => void;
  showLineNumbers?: boolean;
  mode?: EditorMode;
  /** Ctrl/Cmd+click on a [[wiki link]] calls this with the link name. */
  onWikiLink?: (name: string) => void;
  /**
   * A reading view (the phone's): the text cannot be changed, and a plain
   * click - a tap - follows a link, since there is no Ctrl to hold and no
   * cursor to place. Fixed for the editor's life, like `mode`.
   */
  readOnly?: boolean;
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
  // set while an external value is being put in place: that is not an
  // edit, and reporting it would schedule a save of what just arrived
  const applyingExternalRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;
    lastEmittedRef.current = value;
    const state = EditorState.create({
      doc: value,
      selection: { anchor: Math.min(initialAnchor, value.length) },
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
          { key: "Alt-z", run: toggleWrap, preventDefault: true },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
        ]),
        // Ctrl/Cmd+click follows a link: [[note name]] jumps to that
        // note, a web/mail URL (bare or a [label](url) target) opens in
        // the system browser
        EditorView.domEventHandlers({
          mousedown: (event, view) => {
            if (!(readOnly || event.ctrlKey || event.metaKey)) return false;
            const pos = view.posAtCoords({
              x: event.clientX,
              y: event.clientY,
            });
            if (pos === null) return false;
            const line = view.state.doc.lineAt(pos);
            const offset = pos - line.from;
            const note = onWikiLinkRef.current
              ? wikiTargetAt(line.text, offset)
              : null;
            if (note) {
              event.preventDefault();
              onWikiLinkRef.current?.(note);
              return true;
            }
            const url = urlAt(line.text, offset);
            if (!url) return false;
            event.preventDefault();
            void useAppStore.getState().openExternal(url);
            return true;
          },
        }),
        wrapCompartment.of(wrapLines ? EditorView.lineWrapping : []),
        EditorView.contentAttributes.of({ "aria-label": label }),
        editorTheme,
        ...modeExtensions(mode, { lint: !readOnly }),
        ...(readOnly
          ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
          : []),
        ...(showLineNumbers
          ? [lineNumbers(), highlightActiveLineGutter()]
          : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const content = update.state.doc.toString();
            lastEmittedRef.current = content;
            if (!applyingExternalRef.current) onChangeRef.current(content);
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
  // disk, or a save stamped the note's header): update the doc in place -
  // the editor is only rebuilt on docKey changes and would otherwise
  // silently ignore the new value. Only the span that differs is
  // replaced, so the cursor and scroll position survive, and it stays out
  // of the undo history (undo must not take a reload back).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === lastEmittedRef.current) return;
    const current = view.state.doc.toString();
    if (value !== current) {
      const max = Math.min(current.length, value.length);
      let from = 0;
      while (from < max && current[from] === value[from]) from++;
      let tail = 0;
      while (
        tail < max - from &&
        current[current.length - 1 - tail] === value[value.length - 1 - tail]
      ) {
        tail++;
      }
      applyingExternalRef.current = true;
      try {
        view.dispatch({
          changes: {
            from,
            to: current.length - tail,
            insert: value.slice(from, value.length - tail),
          },
          annotations: Transaction.addToHistory.of(false),
        });
      } finally {
        applyingExternalRef.current = false;
      }
    }
    lastEmittedRef.current = value;
  }, [value]);

  return <div ref={containerRef} className="h-full min-h-0 select-text overflow-auto" />;
}
