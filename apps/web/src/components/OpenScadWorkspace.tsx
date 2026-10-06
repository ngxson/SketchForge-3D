"use client";

import { indentWithTab } from "@codemirror/commands";
import { Compartment, EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { Decoration, EditorView, keymap, type DecorationSet } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useMemo, useRef, useState } from "react";
import { openScadLanguage } from "@/lib/openscadLanguage";

export type OpenScadRenderStatus = {
  state: "idle" | "rendering" | "done" | "error";
  message?: string;
  log: string[];
  durationMs?: number;
  triangleCount?: number;
};

type OpenScadWorkspaceProps = {
  source: string;
  onSourceChange: (source: string) => void;
  status: OpenScadRenderStatus;
  runtimeAvailable: boolean;
  resolvedTheme: "light" | "dark";
  /** Human-readable explanation of what Render will do to the scene. */
  targetDescription: string;
  selectionCount: number;
  showReplaceOption: boolean;
  replaceSources: boolean;
  onReplaceSourcesChange: (value: boolean) => void;
  onRender: () => void;
  onCancel: () => void;
  onGenerateFromScene: () => void;
  onGenerateFromSelection: () => void;
};

const setErrorLine = StateEffect.define<number | null>();
const errorLineDecoration = Decoration.line({ class: "cm-openscad-error-line" });

const errorLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setErrorLine)) continue;
      if (effect.value === null || effect.value < 1 || effect.value > transaction.state.doc.lines) {
        next = Decoration.none;
      } else {
        const line = transaction.state.doc.line(effect.value);
        next = Decoration.set([errorLineDecoration.range(line.from)]);
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** OpenSCAD reports parser/evaluation errors as "... in file /work/input.scad, line 12". */
export function errorLineFromLog(log: string[]) {
  for (const line of log) {
    if (!/^(ERROR|WARNING)/.test(line)) continue;
    const match = /line (\d+)/.exec(line);
    if (match) return Number(match[1]);
  }
  return null;
}

export function OpenScadWorkspace({
  source,
  onSourceChange,
  status,
  runtimeAvailable,
  resolvedTheme,
  targetDescription,
  selectionCount,
  showReplaceOption,
  replaceSources,
  onReplaceSourcesChange,
  onRender,
  onCancel,
  onGenerateFromScene,
  onGenerateFromSelection,
}: OpenScadWorkspaceProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onSourceChangeRef = useRef(onSourceChange);
  const onRenderRef = useRef(onRender);
  const themeCompartment = useMemo(() => new Compartment(), []);
  const [copied, setCopied] = useState(false);
  const logRef = useRef<HTMLPreElement | null>(null);

  onSourceChangeRef.current = onSourceChange;
  onRenderRef.current = onRender;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: source,
        extensions: [
          basicSetup,
          openScadLanguage,
          errorLineField,
          Prec.highest(
            keymap.of([
              {
                key: "Mod-Enter",
                run: () => {
                  onRenderRef.current();
                  return true;
                },
              },
              { key: "Ctrl-Enter", run: () => { onRenderRef.current(); return true; } },
              { key: "F5", run: () => { onRenderRef.current(); return true; } },
              { key: "F6", run: () => { onRenderRef.current(); return true; } },
              indentWithTab,
            ]),
          ),
          themeCompartment.of(resolvedTheme === "dark" ? oneDark : []),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onSourceChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
      parent: host,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor is created once; props are synced by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === source) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: source } });
  }, [source]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: themeCompartment.reconfigure(resolvedTheme === "dark" ? oneDark : []) });
  }, [resolvedTheme, themeCompartment]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const line = status.state === "error" ? errorLineFromLog(status.log) : null;
    view.dispatch({ effects: setErrorLine.of(line) });
  }, [status]);

  useEffect(() => {
    const element = logRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [status.log.length, status.state]);

  const copySource = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  const rendering = status.state === "rendering";
  const statusText = rendering
    ? "Rendering with OpenSCAD (Manifold backend)…"
    : status.state === "done"
      ? `Rendered ${status.triangleCount ?? 0} triangles in ${Math.round(status.durationMs ?? 0)} ms`
      : status.state === "error"
        ? status.message ?? "Render failed"
        : runtimeAvailable
          ? "Ready"
          : "OpenSCAD needs the app to be served over http(s)";

  return (
    <aside className="openscad-workspace" aria-label="OpenSCAD workspace">
      <div className="openscad-toolbar">
        <div className="openscad-toolbar-group">
          <button type="button" className="openscad-button" onClick={onGenerateFromScene} disabled={rendering} title="Replace the script with code generated from every visible shape">
            From scene
          </button>
          <button
            type="button"
            className="openscad-button"
            onClick={onGenerateFromSelection}
            disabled={rendering || selectionCount === 0}
            title="Replace the script with code generated from the selected shapes"
          >
            From selection{selectionCount ? ` (${selectionCount})` : ""}
          </button>
          <button type="button" className="openscad-button" onClick={copySource} title="Copy the script to the clipboard">
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="openscad-toolbar-group">
          {rendering ? (
            <button type="button" className="openscad-button" onClick={onCancel}>
              Cancel
            </button>
          ) : null}
          <button type="button" className="openscad-button primary" onClick={onRender} disabled={rendering || !runtimeAvailable} title="Render the script and put the result in the scene (Ctrl/Cmd+Enter)">
            Render
          </button>
        </div>
      </div>
      <div className="openscad-target">
        <span>{targetDescription}</span>
        {showReplaceOption ? (
          <label className="openscad-replace-option">
            <input type="checkbox" checked={replaceSources} onChange={(event) => onReplaceSourcesChange(event.target.checked)} />
            Replace source shapes
          </label>
        ) : null}
      </div>
      <div className="openscad-editor" ref={hostRef} />
      <div className={`openscad-status ${status.state}`} role="status">
        {statusText}
      </div>
      {status.log.length ? (
        <pre className="openscad-log" ref={logRef}>
          {status.log.join("\n")}
        </pre>
      ) : null}
    </aside>
  );
}
