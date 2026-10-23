import { ArrowDownRight, TimerReset } from "lucide-react";

import { formatMinutesSeconds } from "@/lib/format-duration";
import { estimateMockRoute } from "@/lib/mock-route-metrics";
import type { Position } from "@/types/telemetry";

type PreflightEstimateProps = {
  isMockTransport: boolean;
  trafficDensity: number;
  origin: Position | null;
  incident: Position | null;
};

export function PreflightEstimate({
  isMockTransport,
  trafficDensity,
  origin,
  incident,
}: PreflightEstimateProps) {
  const metrics =
    isMockTransport && origin && incident
      ? estimateMockRoute(origin, incident, trafficDensity)
      : null;
  const hasEstimate = metrics !== null && metrics.distanceMeters > 0;
  const normalSeconds = metrics?.normalSeconds ?? 0;
  const greenwaveSeconds = metrics?.greenwaveSeconds ?? 0;
  const savedSeconds = normalSeconds - greenwaveSeconds;

  return (
    <div className="mt-5 rounded-xl border border-border bg-muted/40 p-4">
      <div className="flex items-center gap-2 text-2xs font-medium">
        <TimerReset className="size-4 text-beacon" aria-hidden />
        <span>{isMockTransport ? "Mock pre-flight estimation" : "Pre-flight estimation"}</span>
        <span className="hud-value ml-auto text-2xs font-semibold text-muted-foreground">
          {isMockTransport ? (hasEstimate ? "READY" : "SELECT INCIDENT") : "AFTER START"}
        </span>
      </div>
      {/* Backend estimates exist only once the route is planned; never show mock numbers as real. */}
      {!isMockTransport ? (
        <p className="mt-3 text-2xs text-muted-foreground">
          Standard and GreenWave travel times are computed by the simulation backend when the route
          is initialized.
        </p>
      ) : !hasEstimate ? (
        <p className="mt-3 text-2xs text-muted-foreground">
          Select an incident and wait for a station selection to see approximate mock estimates.
        </p>
      ) : (
        <>
          <p className="mt-3 text-2xs text-muted-foreground">
            Approximate (mock) · straight line, not a drivable route or a real response-time
            prediction.
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
          <div className="flex items-center gap-2 border-t border-border pt-3 text-go">
            <ArrowDownRight className="size-4" aria-hidden />
            <strong className="text-xs font-semibold">
              {Math.round((savedSeconds / normalSeconds) * 100)}% TIME SAVED
            </strong>
            <span className="hud-value ml-auto text-2xs text-muted-foreground">
              −{formatMinutesSeconds(Math.round(savedSeconds))}
            </span>
          </div>
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
