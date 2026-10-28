"use client";
import { useTranslation } from "@/components/language-provider";

import {
  diagnosticOutcomeLabel,
  diagnosticTitle,
  diagnosticTickLabel,
} from "@/lib/diagnostics/presentation";
import { useState } from "react";
import { JsonInspectButton, JsonViewer, type JsonInspection } from "./JsonDetails";
import type { DiagnosticEntry } from "@/lib/diagnostics/store";
export function EndpointActivity({ entries }: { entries: ReadonlyArray<DiagnosticEntry> }) {
  const { t } = useTranslation();
  const [selection, setSelection] = useState<JsonInspection | null>(null);
  return (
    <section className="mt-8" aria-labelledby="activity-title">
      <h2 id="activity-title" className="text-xl font-semibold tracking-tight">
        {t("Recent activity")}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("Inspect a simulation tick’s ")}
        <code>{t("signal_phases")}</code>
        {t(
          " for vehicle and pedestrian colors. Each entry identifies its signal and controlled road approach;",
        )}
        {t(" ")}
        <code>{t("is_route_movement")}</code>
        {t(
          "marks the vehicle’s direction. These are simulated approaches, not individual lane data.",
        )}
      </p>
      <ol className="activity-log mt-4" aria-label={t("Observed activity")}>
        {entries.slice(-30).map((e, i) => (
          <li key={i}>
            {t(e.transport === "mock" ? "Synthetic" : "Backend")}
            {t(" · ")}
            {t(e.operation)}
            {t(" ·")}
            {t(" ")}
            <strong className={e.outcome === "success" ? "text-go" : "text-caution"}>
              {t(diagnosticOutcomeLabel(e))}
            </strong>
            {t(diagnosticTickLabel(e.tick))}
            {t((e.count ?? 0) > 1 ? ` · ${e.count} sampled ticks · latest payload` : "")}
            {e.capture && (
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                <span className="json-activity-endpoint text-xs text-muted-foreground">
                  {t(e.capture.method)} {t(e.capture.path)}
                  {t(e.capture.status === undefined ? "" : ` · ${e.capture.status}`)}
                </span>
                <JsonInspectButton
                  title={t(diagnosticTitle(e))}
                  onClick={() =>
                    setSelection({
                      capture: { ...e.capture! },
                      title: diagnosticTitle(e),
                    })
                  }
                />
              </div>
            )}
          </li>
        ))}
        {!entries.length && <li className="text-muted-foreground">{t("Not observed")}</li>}
      </ol>
      <JsonViewer selection={selection} onClose={() => setSelection(null)} />
    </section>
  );
}
