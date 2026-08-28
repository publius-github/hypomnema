import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

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
});

const plainTheme = EditorView.theme({
  ".cm-content": {
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
    fontSize: "13px",
  },
});

export default function MarkdownEditor({
  docKey,
  value,
  onChange,
  showLineNumbers = false,
  plain = false,
}: {
  /** Identity of the document; changing it resets the editor state. */
  docKey: string;
  value: string;
  onChange: (content: string) => void;
  showLineNumbers?: boolean;
  /** Monospace plain-text mode without markdown highlighting (YAML, txt). */
  plain?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        ...(plain
          ? []
          : [
              markdown({ base: markdownLanguage, codeLanguages: languages }),
              syntaxHighlighting(markdownHighlight),
            ]),
        EditorView.lineWrapping,
        editorTheme,
        // after editorTheme so its .cm-content font wins the CSS tie
        ...(plain ? [plainTheme] : []),
        ...(showLineNumbers ? [lineNumbers()] : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
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

  return <div ref={containerRef} className="h-full min-h-0 select-text overflow-auto" />;
}
