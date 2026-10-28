"use client";
import { useTranslation } from "@/components/language-provider";

import { ArrowUpRight, Zap } from "lucide-react";
import type { DispatchSettings } from "@/lib/start-request";
import type { IncidentDispatch } from "@/lib/useIncidentDispatch";
import { canStart, isOnSite, pageCandidate, timeModeFor } from "@/lib/station-choice";

/** One start action, shared by the persistent workspace control and standalone setup forms. */
export function DispatchStartButton({
  dispatch,
  settings,
  pending,
  replacement = false,
  intent = "simulation",
  onInitialize,
  errorMessage = null,
  blockedReason,
}: {
  dispatch: IncidentDispatch;
  settings: DispatchSettings;
  pending: boolean;
  errorMessage?: string | null;
  replacement?: boolean;
  intent?: "simulation" | "comparison";
  onInitialize: (settings: DispatchSettings) => void;
  /** Why starting is not possible right now (another operation owns the run); the label. */
  blockedReason?: string;
}) {
  const { t } = useTranslation();
  const startable = canStart(dispatch);
  const timeMode = timeModeFor(settings.greenWaveMode, intent);
  const greenWaveMode = settings.greenWaveMode;
  return (
    <>
      <button
        type="button"
        data-testid="start-corridor"
        disabled={pending || !startable || blockedReason !== undefined}
        aria-busy={pending}
        onClick={() => onInitialize(settings)}
        className={`hud-primary pressable ${pending ? "disabled:cursor-wait" : "disabled:cursor-not-allowed"}`}
      >
        <Zap className="size-4" aria-hidden />
        {t(
          blockedReason !== undefined
            ? blockedReason
            : pending
              ? "Computing route…"
              : startable && isOnSite(pageCandidate(dispatch, timeMode))
                ? "Dispatch on foot"
                : intent === "comparison"
                  ? replacement
                    ? "Replace run & compare"
                    : "Start comparison"
                  : replacement
                    ? "Replace active simulation"
                    : greenWaveMode === "ENABLED"
                      ? "Initialize green corridor"
                      : "Start standard-traffic run",
        )}
        <ArrowUpRight className="ml-auto size-4" aria-hidden />
      </button>
      {errorMessage && (
        <p role="alert" className="hud-alert tone-emergency surface-glass mt-2 p-3">
          {t(errorMessage)}
        </p>
      )}
    </>
  );
}
