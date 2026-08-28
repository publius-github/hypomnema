import { useEffect, useRef } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { languages } from "@codemirror/language-data";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
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
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
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

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "14px",
    backgroundColor: "transparent",
    color: "rgb(var(--color-content))",
  },
  ".cm-content": {
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
    caretColor: "rgb(var(--color-accent))",
    padding: "12px 0",
  },
  ".cm-cursor": { borderLeftColor: "rgb(var(--color-accent))" },
  "&.cm-focused": { outline: "none" },
  ".cm-line": { padding: "0 12px" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "rgb(var(--color-accent) / 0.25) !important",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "rgb(var(--color-content-muted) / 0.5)",
    border: "none",
  },
  ".cm-tooltip": {
    backgroundColor: "rgb(var(--color-surface-alt))",
    color: "rgb(var(--color-content))",
    border: "1px solid rgb(var(--color-line))",
  },
});

const monoTheme = EditorView.theme({
  ".cm-content": {
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
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

// Markdown cannot really be "invalid", so the linter flags the two
// mistakes that visibly break rendering: an unclosed code fence and a
// heading marker glued to its text (#Title).
function markdownLinter() {
  return linter((view): Diagnostic[] => {
    const diagnostics: Diagnostic[] = [];
    const doc = view.state.doc;
    let lastFenceLine: { from: number; to: number } | null = null;
    let openFences = 0;
    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i);
      if (/^\s*(```|~~~)/.test(line.text)) {
        openFences += 1;
        lastFenceLine = { from: line.from, to: line.to };
        continue;
      }
      const badHeading = line.text.match(/^(#{1,6})(?=[^#\s])/);
      if (badHeading && openFences % 2 === 0) {
        diagnostics.push({
          from: line.from,
          to: line.from + badHeading[1].length + 1,
          severity: "warning",
          message: "Heading marker needs a space: '# Title', not '#Title'",
        });
      }
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
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        editorTheme,
        ...modeExtensions(mode),
        ...(showLineNumbers ? [lineNumbers()] : []),
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
