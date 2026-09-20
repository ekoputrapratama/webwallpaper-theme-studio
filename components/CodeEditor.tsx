"use client";

import ReactCodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { dracula } from "@uiw/codemirror-theme-dracula";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";

function createExtensions(name: string) {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  switch (ext) {
    case ".html":
    case ".htm":
      return [html()];
    case ".css":
      return [css()];
    case ".js":
    case ".mjs":
    case ".cjs":
    case ".jsx":
      return [javascript()];
    case ".json":
      return [json()];
    default:
      return [];
  }
}

export default function CodeEditor({
  value,
  onChange,
  activeFileName,
}: {
  value: string;
  onChange: (value: string) => void;
  activeFileName: string;
}) {
  return (
    <ReactCodeMirror
      value={value}
      onChange={(v) => onChange(v)}
      theme={dracula}
      height="100%"
      style={{ height: "100%" }}
      basicSetup={{ lineNumbers: true, foldGutter: false }}
      extensions={[EditorView.lineWrapping, EditorState.tabSize.of(2), ...createExtensions(activeFileName)]}
    />
  );
}