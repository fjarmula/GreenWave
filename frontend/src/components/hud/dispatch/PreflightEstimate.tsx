import { ArrowDownRight, TimerReset } from "lucide-react";

import { formatSignalDistance } from "@/lib/driver-presentation";
import { formatMinutesSeconds } from "@/lib/format-duration";
import { estimateMockRoute } from "@/lib/mock-route-metrics";
import type { Position, RankedCandidate } from "@/types/telemetry";

type PreflightEstimateProps = {
  isMockTransport: boolean;
  trafficDensity: number;
  origin: Position | null;
  incident: Position | null;
  /** Backend: the selected candidate, whose times are the runs' own pre-run estimates. */
  candidate?: RankedCandidate | null;
};

export function PreflightEstimate({
  isMockTransport,
  trafficDensity,
  origin,
  incident,
  candidate = null,
}: PreflightEstimateProps) {
  const metrics =
    isMockTransport && origin && incident
      ? estimateMockRoute(origin, incident, trafficDensity)
      : null;
  const hasEstimate = isMockTransport
    ? metrics !== null && metrics.distanceMeters > 0
    : candidate !== null;
  const normalSeconds = isMockTransport
    ? (metrics?.normalSeconds ?? 0)
    : (candidate?.standard_seconds ?? 0);
  const greenwaveSeconds = isMockTransport
    ? (metrics?.greenwaveSeconds ?? 0)
    : (candidate?.greenwave_seconds ?? 0);
  const saved = Math.round(normalSeconds - greenwaveSeconds);
  const onFoot = isMockTransport ? null : (candidate?.on_foot ?? null);

  return (
    <div className="mt-5 rounded-xl border border-border bg-muted/40 p-4">
      <div className="flex items-center gap-2 text-2xs font-medium">
        <TimerReset className="size-4 text-beacon" aria-hidden />
        <span>{isMockTransport ? "Mock pre-flight estimation" : "Pre-flight estimation"}</span>
        <span className="hud-value ml-auto text-2xs font-semibold text-muted-foreground">
          {hasEstimate ? "READY" : "SELECT INCIDENT"}
        </span>
      </div>
      {/* Never show mock numbers as backend ones, or backend ones as measured times. */}
      {onFoot && candidate?.on_site ? (
        // On site (ADR 0012): no drive and no simulated run, only the walk.
        <p className="mt-3 text-2xs text-muted-foreground">
          {`On site · no drive · on foot about ${formatMinutesSeconds(Math.round(onFoot.seconds))} (${formatSignalDistance(onFoot.distance_m)}) · simulated estimate.`}
        </p>
      ) : !hasEstimate ? (
        <p className="mt-3 text-2xs text-muted-foreground">
          {isMockTransport
            ? "Select an incident and wait for a station selection to see approximate mock estimates."
            : "Select an incident and wait for a station selection to see the simulated run times."}
        </p>
      ) : (
        <>
          <p className="mt-3 text-2xs text-muted-foreground">
            {isMockTransport
              ? "Approximate (mock) · straight line, not a drivable route or a real response-time prediction."
              : `Simulated runs from the selected station, without and with ER Green Wave${
                  onFoot
                    ? ` · drive only, plus ${formatMinutesSeconds(Math.round(onFoot.seconds))} on foot`
                    : ""
                }.`}
          </p>
          <div className="my-4 grid grid-cols-2 gap-3">
            <Estimate
              label="Standard time"
              value={formatMinutesSeconds(Math.round(normalSeconds))}
            />
            <Estimate
              label="GreenWave time"
              value={formatMinutesSeconds(Math.round(greenwaveSeconds))}
              highlighted
            />
          </div>
          {/* Standard can be the shorter run (it spends no D_min); never claim a saving then. */}
          {saved > 0 ? (
            <div className="flex items-center gap-2 border-t border-border pt-3 text-go">
              <ArrowDownRight className="size-4" aria-hidden />
              <strong className="text-xs font-semibold">
                {Math.round((saved / normalSeconds) * 100)}% TIME SAVED
              </strong>
              <span className="hud-value ml-auto text-2xs text-muted-foreground">
                −{formatMinutesSeconds(saved)}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 border-t border-border pt-3 text-muted-foreground">
              <strong className="text-xs font-semibold">NO TIME SAVED</strong>
              <span className="hud-value ml-auto text-2xs">
                {saved === 0 ? formatMinutesSeconds(0) : `+${formatMinutesSeconds(-saved)}`}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Estimate({
  label,
  value,
  highlighted = false,
}: {
  label: string;
  value: string;
  highlighted?: boolean;
}) {
  return (
    <div>
      <span className="block text-2xs text-muted-foreground">{label}</span>
      <strong
        className={`hud-value mt-1 block text-base font-semibold ${highlighted ? "text-go" : ""}`}
      >
        {value}
      </strong>
    </div>
  );
}
