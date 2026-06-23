// The CodeMirror 6 surface (AGE-634). This module is the ONLY place the
// `@codemirror/*` packages are imported, and it is reached exclusively through
// `React.lazy` in `FileEditor` — so the whole editor (core + language grammars)
// is code-split into its own async chunk and stays out of the initial renderer
// bundle. The editor chrome and syntax colors are painted from the app's CSS
// custom properties (the same channels Tailwind's tokens use), so it follows
// light/dark with the rest of the shell rather than shipping a second palette.

import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { useEffect, useRef } from "react";

/** Editor chrome painted from the shell's CSS variables (light/dark aware). */
const ompTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
    color: "rgb(var(--c-ink))",
    backgroundColor: "rgb(var(--c-bg-raised))",
  },
  ".cm-scroller": {
    fontFamily:
      "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
    lineHeight: "1.6",
  },
  ".cm-content": { caretColor: "rgb(var(--c-accent))" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "rgb(var(--c-accent))" },
  "&.cm-focused": { outline: "none" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "rgb(var(--c-accent) / 0.25)" },
  ".cm-gutters": {
    backgroundColor: "rgb(var(--c-bg-raised))",
    color: "rgb(var(--c-ink-faint))",
    border: "none",
  },
  ".cm-activeLine": { backgroundColor: "rgb(var(--c-bg-hover) / 0.45)" },
  ".cm-activeLineGutter": {
    backgroundColor: "rgb(var(--c-bg-hover) / 0.45)",
    color: "rgb(var(--c-ink-muted))",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "rgb(var(--c-bg-panel))",
    border: "1px solid rgb(var(--c-border))",
    color: "rgb(var(--c-ink-muted))",
  },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "rgb(var(--c-accent) / 0.2)",
    outline: "1px solid rgb(var(--c-accent) / 0.4)",
  },
});

/** Syntax colors reusing the app's `--hljs-*` code-block tokens (light/dark). */
const ompHighlight = HighlightStyle.define([
  {
    tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword],
    color: "var(--hljs-keyword)",
  },
  { tag: [t.moduleKeyword, t.definitionKeyword], color: "var(--hljs-keyword)" },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName],
    color: "var(--hljs-entity)",
  },
  { tag: [t.propertyName, t.attributeName], color: "var(--hljs-variable)" },
  {
    tag: [t.string, t.special(t.string), t.regexp, t.escape],
    color: "var(--hljs-string)",
  },
  {
    tag: [t.number, t.bool, t.null, t.atom, t.character],
    color: "var(--hljs-constant)",
  },
  {
    tag: [t.className, t.typeName, t.namespace, t.tagName],
    color: "var(--hljs-tag)",
  },
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.meta],
    color: "var(--hljs-comment)",
    fontStyle: "italic",
  },
  { tag: [t.heading], color: "var(--hljs-heading)", fontWeight: "bold" },
  { tag: [t.strong], fontWeight: "bold" },
  { tag: [t.emphasis], fontStyle: "italic" },
  {
    tag: [t.link, t.url],
    color: "var(--hljs-constant)",
    textDecoration: "underline",
  },
  { tag: [t.invalid], color: "rgb(var(--c-danger))" },
]);

/** Resolve a CodeMirror language extension from a path's extension; null = plain. */
function languageExtension(path: string): Extension | null {
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
  switch (ext) {
    case "ts":
    case "mts":
    case "cts":
      return javascript({ typescript: true });
    case "tsx":
      return javascript({ typescript: true, jsx: true });
    case "js":
    case "mjs":
    case "cjs":
      return javascript();
    case "jsx":
      return javascript({ jsx: true });
    case "json":
    case "jsonc":
      return json();
    case "md":
    case "markdown":
      return markdown();
    case "css":
    case "scss":
    case "less":
      return css();
    case "html":
    case "htm":
      return html();
    case "py":
    case "pyi":
      return python();
    case "rs":
      return rust();
    case "go":
      return go();
    default:
      return null;
  }
}

export interface CodeMirrorEditorProps {
  /** Tab key; the view is recreated when it changes (one EditorView per file). */
  path: string;
  /** Seed document; the editor owns the buffer thereafter (edits flow out). */
  initialDoc: string;
  /** Emitted on every document change (drives the store's dirty buffer). */
  onChange: (text: string) => void;
  /** Invoked by the in-editor Cmd/Ctrl+S binding (drives the store's save). */
  onSave: () => void;
}

export default function CodeMirrorEditor({
  path,
  initialDoc,
  onChange,
  onSave,
}: CodeMirrorEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  // Hold the latest callbacks so the (path-keyed) view never goes stale, without
  // tearing down and rebuilding the editor when only an identity moves.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  // One EditorView per file: recreated only when `path` changes so each tab's
  // cursor, scroll, and undo history are preserved while it stays open. The seed
  // doc is read once here; live edits propagate via onChange, never prop resets.
  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const language = languageExtension(path);
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      foldGutter(),
      indentOnInput(),
      bracketMatching(),
      syntaxHighlighting(ompHighlight),
      highlightActiveLine(),
      EditorView.lineWrapping,
      keymap.of([
        // Save wins over any default binding; preventDefault stops the browser's
        // own save dialog. Wired ahead of defaultKeymap so it always fires.
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            onSaveRef.current();
            return true;
          },
        },
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
        indentWithTab,
      ]),
      ompTheme,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current(update.state.doc.toString());
      }),
    ];
    if (language) extensions.push(language);
    const view = new EditorView({
      state: EditorState.create({ doc: initialDoc, extensions }),
      parent,
    });
    return () => view.destroy();
  }, [path]);

  return (
    <div
      ref={host}
      className="h-full min-h-0 overflow-hidden"
      data-testid="cm-editor"
    />
  );
}
