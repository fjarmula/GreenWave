"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Braces, X } from "lucide-react";
import type { DiagnosticCapture } from "@/lib/diagnostics/store";

export function formatJsonBody(body: string) {
  try {
    JSON.parse(body);
  } catch {
    return body;
  }
  // Preserve the original numeric/string tokens, including integers beyond JS precision.
  const tokens = body.match(/"(?:\\.|[^"\\])*"|[{}\[\],:]|[^\s{}\[\],:]+/g) ?? [];
  let depth = 0;
  let formatted = "";
  for (const [index, token] of tokens.entries()) {
    if (depth > 64 || formatted.length > 4 * 1024 * 1024) return body;
    if (token === "{" || token === "[") {
      depth++;
      formatted += token;
      if (tokens[index + 1] !== "}" && tokens[index + 1] !== "]")
        formatted += "\n" + "  ".repeat(depth);
    } else if (token === "}" || token === "]") {
      depth--;
      if (tokens[index - 1] !== "{" && tokens[index - 1] !== "[")
        formatted += "\n" + "  ".repeat(depth);
      formatted += token;
    } else if (token === ",") formatted += ",\n" + "  ".repeat(depth);
    else if (token === ":") formatted += ": ";
    else formatted += token;
  }
  return formatted;
}

export type JsonInspection = { capture: DiagnosticCapture; title: string; description?: string };

export function JsonInspectButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="json-inspect-button"
      aria-label={`View JSON for ${title}`}
      onClick={onClick}
    >
      <Braces size={14} aria-hidden />
      View JSON
    </button>
  );
}

export function JsonViewer({
  selection,
  onClose,
}: {
  selection: JsonInspection | null;
  onClose: () => void;
}) {
  return selection ? <OpenJsonViewer selection={selection} onClose={onClose} /> : null;
}

function OpenJsonViewer({
  selection,
  onClose,
}: {
  selection: JsonInspection;
  onClose: () => void;
}) {
  const {
    capture: snapshot,
    title,
    description = "Captured in this browser session. Display formatting adds indentation; Copy preserves the original body.",
  } = selection;
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [copied, setCopied] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const body = snapshot.responseBody;
  const omitted = snapshot.responseOmitted;
  const kind = snapshot.eventType ? "Event" : "Response";
  const formatted = useMemo(() => (body === undefined ? "" : formatJsonBody(body)), [body]);
  return (
    <dialog ref={dialog} className="json-dialog" aria-labelledby={id} onClose={onClose}>
      {snapshot && (
        <>
          <header className="json-dialog-header">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Simulation payload · frozen snapshot</p>
              <h2 id={id} className="mt-1 text-lg font-semibold">
                {title}
              </h2>
            </div>
            <button
              type="button"
              className="workspace-button shrink-0"
              aria-label="Close JSON viewer"
              onClick={() => dialog.current?.close()}
            >
              <X size={18} aria-hidden />
            </button>
          </header>
          <div className="json-dialog-content">
            <p className="json-endpoint font-mono text-sm">
              {snapshot.method} {snapshot.path}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {snapshot.status !== undefined && `HTTP ${snapshot.status}`}
              {snapshot.eventType && ` · ${snapshot.eventType}`}
              {snapshot.validation &&
                ` · ${snapshot.validation === "accepted" ? "Accepted by validation" : "Rejected by validation"}`}
            </p>
            <p className="mt-3 text-sm text-muted-foreground">{description}</p>
            <div className="json-dialog-actions">
              <button
                type="button"
                className="workspace-button"
                disabled={body === undefined || omitted || body === ""}
                onClick={async () => {
                  if (body === undefined) return;
                  try {
                    await navigator.clipboard.writeText(body);
                    setCopied("Copied");
                  } catch {
                    setCopied("Copy unavailable. Select the text to copy manually.");
                  }
                }}
              >
                Copy {kind.toLowerCase()}
              </button>
            </div>
            <p className="text-sm" role="status">
              {copied}
            </p>
            {omitted ? (
              <p className="json-body-note">
                Body unavailable: it exceeded the 2 MiB capture limit or could not be read. It has
                not been truncated or reconstructed.
              </p>
            ) : body === undefined || body === "" ? (
              <p className="json-body-note">No response body captured for this observation.</p>
            ) : (
              <pre className="json-body" tabIndex={0} aria-label={`${kind} body`}>
                <code>{formatted}</code>
              </pre>
            )}
          </div>
        </>
      )}
    </dialog>
  );
}
