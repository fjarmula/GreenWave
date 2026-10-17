"use client";

import {
  ArrowDownRight,
  ArrowUpRight,
  Gauge,
  MapPin,
  Radio,
  ShieldCheck,
  Target,
  TimerReset,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { useState } from "react";

import {
  DESTINATION_ENDPOINTS,
  ORIGIN_ENDPOINTS,
  type DestinationEndpointId,
  type OriginEndpointId,
} from "@/components/map/dispatch-endpoints";
import { getFrontendConfig } from "@/lib/config";
import {
  DEFAULT_TRAFFIC_DENSITY_MULTIPLIER,
  estimateMockNormalTravelTimeSeconds,
  MOCK_GREENWAVE_TRAVEL_TIME_SECONDS,
} from "@/lib/mock-simulation-config";

// D9: wall clock stays 1 Hz; each tick advances this many simulated seconds.
const PLAYBACK_SPEEDS = [1, 2, 5, 10] as const;
type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export type DispatchSettings = {
  trafficDensity: number;
  cascadeEnabled: boolean;
  playbackSpeed: PlaybackSpeed;
};

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
  const normalSeconds = estimateMockNormalTravelTimeSeconds(trafficDensity);
  const greenwaveSeconds = MOCK_GREENWAVE_TRAVEL_TIME_SECONDS;
  const savedSeconds = normalSeconds - greenwaveSeconds;
  const formatEstimate = (seconds: number) =>
    `${String(Math.floor(seconds / 60)).padStart(2, "0")}m ${String(seconds % 60).padStart(2, "0")}s`;

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

      <div className="mt-5 flex items-center justify-between gap-3">
        <label htmlFor="traffic-density" className="dashboard-label">
          Traffic density multiplier
        </label>
        <output
          htmlFor="traffic-density"
          className="font-mono text-base font-bold text-cyan-600 dark:text-cyan-300"
        >
          {trafficDensity.toFixed(1)}x
        </output>
      </div>
      <input
        id="traffic-density"
        type="range"
        min="1"
        max="3"
        step="0.1"
        value={trafficDensity}
        onChange={(event) => setTrafficDensity(Number(event.target.value))}
        className="mt-3 w-full accent-cyan-500"
      />
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>1.0x normal</span>
        <span>3.0x peak</span>
      </div>

      <div className="mt-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">Cascade corridor mode</p>
          <p className="mt-1 text-xs text-muted-foreground">Group nearby signals within 250 m</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={cascadeEnabled}
          aria-label="Cascade corridor mode"
          onClick={() => setCascadeEnabled((enabled) => !enabled)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/70 ${
            cascadeEnabled ? "bg-violet-500" : "bg-muted-foreground/30"
          }`}
        >
          <span
            className={`absolute top-1 left-1 size-4 rounded-full bg-white shadow-sm transition-transform ${
              cascadeEnabled ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <span id="playback-speed-label" className="dashboard-label">
            Playback speed
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            simulated s per 1 s tick
          </span>
        </div>
        <div
          role="radiogroup"
          aria-labelledby="playback-speed-label"
          className="mt-2 grid grid-cols-4 gap-1 rounded-lg border border-border bg-muted/45 p-1"
        >
          {PLAYBACK_SPEEDS.map((speed) => (
            <button
              key={speed}
              type="button"
              role="radio"
              aria-checked={playbackSpeed === speed}
              onClick={() => setPlaybackSpeed(speed)}
              className={`min-h-8 rounded-md font-mono text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 ${
                playbackSpeed === speed
                  ? "bg-background text-cyan-700 shadow-sm dark:text-cyan-300"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {speed}×
            </button>
          ))}
        </div>
      </div>

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

      <div className="mt-5 rounded-xl border border-emerald-500/25 bg-emerald-500/7 p-4">
        <div className="flex items-center gap-2 text-[11px] font-medium">
          <TimerReset className="size-4 text-emerald-500" aria-hidden />
          <span>
            {isMockTransport ? "Mock pre-flight estimation" : "Sample pre-flight estimation"}
          </span>
          <span className="ml-auto font-mono text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
            READY
          </span>
        </div>
        <div className="my-4 grid grid-cols-2 gap-3">
          <Estimate label="Standard time" value={formatEstimate(normalSeconds)} />
          <Estimate label="GreenWave time" value={formatEstimate(greenwaveSeconds)} highlighted />
        </div>
        <div className="flex items-center gap-2 border-t border-emerald-500/20 pt-3 text-emerald-600 dark:text-emerald-400">
          <ArrowDownRight className="size-4" aria-hidden />
          <strong className="text-[11px]">
            {Math.round((savedSeconds / normalSeconds) * 100)}% TIME SAVED
          </strong>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
            −{formatEstimate(savedSeconds)}
          </span>
        </div>
      </div>

      <p className="mt-5 flex items-center gap-2 text-[10px] leading-relaxed text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0 text-emerald-500" aria-hidden />
        {isMockTransport
          ? "Demo uses synthetic route estimates and sample signal telemetry."
          : "Route estimates come from the simulation backend after initialization. All signal states are simulated."}
      </p>
    </aside>
  );
}

type NodeSelectProps<T extends string> = {
  id: string;
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<readonly [T, string]>;
};

function NodeSelect<T extends string>({ id, label, value, onChange, options }: NodeSelectProps<T>) {
  return (
    <div>
      <label htmlFor={id} className="dashboard-label">
        {label}
      </label>
      <div className="relative mt-2">
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value as T)}
          className="w-full appearance-none rounded-lg border border-border bg-background px-3 py-3 pr-10 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
        >
          {options.map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
        <MapPin
          className="pointer-events-none absolute top-3 right-3 size-4 text-cyan-600 dark:text-cyan-300"
          aria-hidden
        />
      </div>
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
