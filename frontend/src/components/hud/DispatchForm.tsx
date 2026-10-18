"use client";

import { ArrowUpRight, Gauge, Radio, ShieldCheck, Target, TriangleAlert, Zap } from "lucide-react";
import { useState } from "react";

import { CascadeToggle } from "@/components/hud/dispatch/CascadeToggle";
import { NodeSelect } from "@/components/hud/dispatch/NodeSelect";
import {
  PlaybackSpeedSelector,
  type PlaybackSpeed,
} from "@/components/hud/dispatch/PlaybackSpeedSelector";
import { PreflightEstimate } from "@/components/hud/dispatch/PreflightEstimate";
import { TrafficDensityControl } from "@/components/hud/dispatch/TrafficDensityControl";
import {
  DESTINATION_ENDPOINTS,
  ORIGIN_ENDPOINTS,
  type DestinationEndpointId,
  type OriginEndpointId,
} from "@/components/map/dispatch-endpoints";
import { getFrontendConfig } from "@/lib/config";
import { DEFAULT_TRAFFIC_DENSITY_MULTIPLIER } from "@/lib/mock-simulation-config";
import type { DispatchSettings } from "@/lib/start-request";

type DispatchFormProps = {
  onInitialize: (settings: DispatchSettings) => void;
  /** True while the start request is in flight (STARTING). */
  pending: boolean;
  /** Readable reason the last initialization failed, if any. */
  errorMessage: string | null;
  originId: OriginEndpointId;
  destinationId: DestinationEndpointId;
  onOriginChange: (originId: OriginEndpointId) => void;
  onDestinationChange: (destinationId: DestinationEndpointId) => void;
  onFocusNodes: () => void;
};

export function DispatchForm({
  onInitialize,
  pending,
  errorMessage,
  originId,
  destinationId,
  onOriginChange,
  onDestinationChange,
  onFocusNodes,
}: DispatchFormProps) {
  const [trafficDensity, setTrafficDensity] = useState(DEFAULT_TRAFFIC_DENSITY_MULTIPLIER);
  const [cascadeEnabled, setCascadeEnabled] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const isMockTransport = getFrontendConfig().transport === "mock";

  return (
    <aside className="border-border/80 bg-card/95 p-5 shadow-2xl backdrop-blur-xl sm:p-6 lg:h-full lg:overflow-y-auto lg:border-r">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="dashboard-eyebrow">Dispatch console / 01</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">Route initialization</h2>
        </div>
        <Radio className="size-5 text-emerald-500" aria-hidden />
      </div>

      <div className="mt-6 space-y-5">
        <NodeSelect
          id="origin"
          label="Origin node"
          value={originId}
          onChange={onOriginChange}
          options={ORIGIN_ENDPOINTS.map(({ id, label }) => [id, label] as const)}
        />
        <NodeSelect
          id="destination"
          label="Destination node"
          value={destinationId}
          onChange={onDestinationChange}
          options={DESTINATION_ENDPOINTS.map(({ id, label }) => [id, label] as const)}
        />
      </div>

      <button
        type="button"
        onClick={onFocusNodes}
        className="mt-4 flex w-full items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/8 px-3 py-2.5 text-left text-xs font-semibold text-cyan-700 transition hover:bg-cyan-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 dark:text-cyan-300"
      >
        <Target className="size-4" aria-hidden />
        View selected nodes
        <kbd className="ml-auto font-mono text-[10px] text-muted-foreground">⌘ K</kbd>
      </button>

      <div className="my-6 h-px bg-border" />

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="dashboard-eyebrow">Simulation parameters</p>
          <h3 className="mt-1 text-sm font-semibold">Traffic model</h3>
        </div>
        <Gauge className="size-5 text-emerald-500" aria-hidden />
      </div>

      <TrafficDensityControl value={trafficDensity} onChange={setTrafficDensity} />
      <CascadeToggle
        enabled={cascadeEnabled}
        onToggle={() => setCascadeEnabled((enabled) => !enabled)}
      />
      <PlaybackSpeedSelector value={playbackSpeed} onChange={setPlaybackSpeed} />

      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={() => onInitialize({ trafficDensity, cascadeEnabled, playbackSpeed })}
        className="mt-7 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 text-xs font-extrabold tracking-[0.08em] text-emerald-950 uppercase shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70 disabled:hover:bg-emerald-500"
      >
        <Zap className="size-4" aria-hidden />
        {pending ? "Computing route…" : "Initialize green corridor"}
        <ArrowUpRight className="ml-auto size-4" aria-hidden />
      </button>

      {errorMessage && (
        <p
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/8 px-3 py-2.5 text-xs font-medium text-red-700 dark:text-red-300"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {errorMessage}
        </p>
      )}

      <PreflightEstimate isMockTransport={isMockTransport} trafficDensity={trafficDensity} />

      <p className="mt-5 flex items-center gap-2 text-[10px] leading-relaxed text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0 text-emerald-500" aria-hidden />
        {isMockTransport
          ? "Demo uses synthetic route estimates and sample signal telemetry."
          : "Route estimates come from the simulation backend after initialization. All signal states are simulated."}
      </p>
    </aside>
  );
}
