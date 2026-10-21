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
    <div className="mt-5 rounded-xl border border-emerald-500/25 bg-emerald-500/7 p-4">
      <div className="flex items-center gap-2 text-[11px] font-medium">
        <TimerReset className="size-4 text-emerald-500" aria-hidden />
        <span>{isMockTransport ? "Mock pre-flight estimation" : "Pre-flight estimation"}</span>
        <span className="ml-auto font-mono text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
          {isMockTransport ? (hasEstimate ? "READY" : "SELECT INCIDENT") : "AFTER START"}
        </span>
      </div>
      {/* Backend estimates exist only once the route is planned; never show mock numbers as real. */}
      {!isMockTransport ? (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Standard and GreenWave travel times are computed by the simulation backend when the route
          is initialized.
        </p>
      ) : !hasEstimate ? (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Select an incident and wait for a station selection to see approximate mock estimates.
        </p>
      ) : (
        <>
          <p className="mt-3 text-[11px] text-muted-foreground">
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
          <div className="flex items-center gap-2 border-t border-emerald-500/20 pt-3 text-emerald-600 dark:text-emerald-400">
            <ArrowDownRight className="size-4" aria-hidden />
            <strong className="text-[11px]">
              {Math.round((savedSeconds / normalSeconds) * 100)}% TIME SAVED
            </strong>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
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
      <span className="block text-[10px] text-muted-foreground">{label}</span>
      <strong
        className={`mt-1 block font-mono text-sm ${highlighted ? "text-emerald-600 dark:text-emerald-400" : ""}`}
      >
        {value}
      </strong>
    </div>
  );
}
