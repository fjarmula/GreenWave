import { ArrowDownRight, TimerReset } from "lucide-react";

import { formatMinutesSeconds } from "@/lib/format-duration";
import {
  estimateMockNormalTravelTimeSeconds,
  MOCK_GREENWAVE_TRAVEL_TIME_SECONDS,
} from "@/lib/mock-simulation-config";

type PreflightEstimateProps = {
  isMockTransport: boolean;
  trafficDensity: number;
};

export function PreflightEstimate({ isMockTransport, trafficDensity }: PreflightEstimateProps) {
  const normalSeconds = estimateMockNormalTravelTimeSeconds(trafficDensity);
  const greenwaveSeconds = MOCK_GREENWAVE_TRAVEL_TIME_SECONDS;
  const savedSeconds = normalSeconds - greenwaveSeconds;

  return (
    <div className="mt-5 rounded-xl border border-emerald-500/25 bg-emerald-500/7 p-4">
      <div className="flex items-center gap-2 text-[11px] font-medium">
        <TimerReset className="size-4 text-emerald-500" aria-hidden />
        <span>{isMockTransport ? "Mock pre-flight estimation" : "Pre-flight estimation"}</span>
        <span className="ml-auto font-mono text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
          {isMockTransport ? "READY" : "AFTER START"}
        </span>
      </div>
      {/* Backend estimates exist only once the route is planned; never show mock numbers as real. */}
      {!isMockTransport ? (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Standard and GreenWave travel times are computed by the simulation backend when the route
          is initialized.
        </p>
      ) : (
        <>
          <div className="my-4 grid grid-cols-2 gap-3">
            <Estimate label="Standard time" value={formatMinutesSeconds(normalSeconds)} />
            <Estimate
              label="GreenWave time"
              value={formatMinutesSeconds(greenwaveSeconds)}
              highlighted
            />
          </div>
          <div className="flex items-center gap-2 border-t border-emerald-500/20 pt-3 text-emerald-600 dark:text-emerald-400">
            <ArrowDownRight className="size-4" aria-hidden />
            <strong className="text-[11px]">
              {Math.round((savedSeconds / normalSeconds) * 100)}% TIME SAVED
            </strong>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              −{formatMinutesSeconds(savedSeconds)}
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
