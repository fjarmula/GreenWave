"use client";
import { useTranslation } from "@/components/language-provider";

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
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="json-inspect-button"
      aria-label={t(`View JSON for ${title}`)}
      onClick={onClick}
    >
      <Braces size={14} aria-hidden />
      {t("View JSON")}
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
  const { t } = useTranslation();
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
              <p className="text-xs text-muted-foreground">
                {t("Simulation payload · frozen snapshot")}
              </p>
              <h2 id={id} className="mt-1 text-lg font-semibold">
                {t(title)}
              </h2>
            </div>
            <button
              type="button"
              className="workspace-button shrink-0"
              aria-label={t("Close JSON viewer")}
              onClick={() => dialog.current?.close()}
            >
              <X size={18} aria-hidden />
            </button>
          </header>
          <div className="json-dialog-content">
            <p className="json-endpoint font-mono text-sm">
              {t(snapshot.method)} {t(snapshot.path)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(snapshot.status !== undefined && `HTTP ${snapshot.status}`)}
              {t(snapshot.eventType && ` · ${snapshot.eventType}`)}
              {t(
                snapshot.validation &&
                  ` · ${snapshot.validation === "accepted" ? "Payload format valid" : "Payload format invalid"}`,
              )}
            </p>
            {snapshot.eventType === "ITS_DISPATCH" && snapshot.validation !== "rejected" && (
              <p className="mt-3 text-sm text-muted-foreground">
                {t(
                  "Priority request submitted; awaiting controller feedback at this event’s simulated time.",
                )}
              </p>
            )}
            {snapshot.eventType === "ITS_FEEDBACK" && snapshot.validation !== "rejected" && (
              <p className="mt-3 text-sm text-muted-foreground">
                {t(
                  "The request outcome is in the status field. Signal colours are reported separately in SIMULATION_TICK.",
                )}
              </p>
            )}
            <p className="mt-3 text-sm text-muted-foreground">{t(description)}</p>
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
                {t("Copy ")}
                {t(kind.toLowerCase())}
              </button>
            </div>
            <p className="text-sm" role="status">
              {t(copied)}
            </p>
            {omitted ? (
              <p className="json-body-note">
                {t(
                  "Body unavailable: it exceeded the 2 MiB capture limit or could not be read. It has not been truncated or reconstructed.",
                )}
              </p>
            ) : body === undefined || body === "" ? (
              <p className="json-body-note">
                {t("No response body captured for this observation.")}
              </p>
            ) : (
              <pre className="json-body" tabIndex={0} aria-label={t(`${kind} body`)}>
                <code>{formatted}</code>
              </pre>
            )}
          </div>
        </>
      )}
    </dialog>
  );
}
