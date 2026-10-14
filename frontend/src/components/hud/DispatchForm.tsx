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
  Zap,
} from "lucide-react";
import { useState } from "react";

type DispatchFormProps = {
  onInitialize: () => void;
};

export function DispatchForm({ onInitialize }: DispatchFormProps) {
  const [trafficDensity, setTrafficDensity] = useState(1.5);
  const [cascadeEnabled, setCascadeEnabled] = useState(true);

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
          defaultValue="hospital"
          options={[
            ["hospital", "University Hospital (SOR)"],
            ["prokocim", "Prokocim Emergency Hub"],
            ["rydygier", "Rydygier Hospital"],
          ]}
        />
        <NodeSelect
          id="destination"
          label="Destination node"
          defaultValue="station"
          options={[
            ["station", "Łazarza ZRM Station"],
            ["wroclawska", "Wrocławska ZRM Station"],
            ["nowa-huta", "Nowa Huta Dispatch Point"],
          ]}
        />
      </div>

      <button
        type="button"
        className="mt-4 flex w-full items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/8 px-3 py-2.5 text-left text-xs font-semibold text-cyan-700 transition hover:bg-cyan-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 dark:text-cyan-300"
      >
        <Target className="size-4" aria-hidden />
        Pick on map
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

      <button
        type="button"
        onClick={onInitialize}
        className="mt-7 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 text-xs font-extrabold tracking-[0.08em] text-emerald-950 uppercase shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
      >
        <Zap className="size-4" aria-hidden />
        Initialize green corridor
        <ArrowUpRight className="ml-auto size-4" aria-hidden />
      </button>

      <div className="mt-5 rounded-xl border border-emerald-500/25 bg-emerald-500/7 p-4">
        <div className="flex items-center gap-2 text-[11px] font-medium">
          <TimerReset className="size-4 text-emerald-500" aria-hidden />
          <span>Pre-flight estimation</span>
          <span className="ml-auto font-mono text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
            READY
          </span>
        </div>
        <div className="my-4 grid grid-cols-2 gap-3">
          <Estimate label="Standard time" value="13m 00s" />
          <Estimate label="GreenWave time" value="06m 20s" highlighted />
        </div>
        <div className="flex items-center gap-2 border-t border-emerald-500/20 pt-3 text-emerald-600 dark:text-emerald-400">
          <ArrowDownRight className="size-4" aria-hidden />
          <strong className="text-[11px]">51% TIME SAVED</strong>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">−06m 40s</span>
        </div>
      </div>

      <p className="mt-5 flex items-center gap-2 text-[10px] leading-relaxed text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0 text-emerald-500" aria-hidden />
        Route planning uses municipal spatial data from MSIP and ZDMK.
      </p>
    </aside>
  );
}

type NodeSelectProps = {
  id: string;
  label: string;
  defaultValue: string;
  options: ReadonlyArray<readonly [string, string]>;
};

function NodeSelect({ id, label, defaultValue, options }: NodeSelectProps) {
  return (
    <div>
      <label htmlFor={id} className="dashboard-label">
        {label}
      </label>
      <div className="relative mt-2">
        <select
          id={id}
          defaultValue={defaultValue}
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
