import type { GreenWaveMode } from "@/types/telemetry";

const MODES: ReadonlyArray<{ mode: GreenWaveMode; label: string }> = [
  { mode: "ENABLED", label: "Enabled" },
  { mode: "DISABLED", label: "Disabled" },
];

type GreenWaveToggleProps = {
  mode: GreenWaveMode;
  onChange: (mode: GreenWaveMode) => void;
};

/** Enabled pre-clears signals on the route; Disabled crosses them in standard simulated traffic. */
export function GreenWaveToggle({ mode, onChange }: GreenWaveToggleProps) {
  return (
    <div className="mt-6">
      <p className="text-sm font-semibold">ER Green Wave</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {mode === "ENABLED"
          ? "Simulated signal priority clears each intersection ahead of the vehicle."
          : "Simulated standard traffic: the vehicle waits for a life corridor and crosses at the speed limit."}
      </p>
      <div
        role="radiogroup"
        aria-label="ER Green Wave"
        className="mt-2 grid grid-cols-2 gap-1 rounded-lg border border-border bg-background p-1"
      >
        {MODES.map((option) => (
          <button
            key={option.mode}
            type="button"
            role="radio"
            aria-checked={mode === option.mode}
            onClick={() => onChange(option.mode)}
            className="flex min-h-9 items-center justify-center rounded-md text-xs font-semibold text-muted-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/70 aria-checked:bg-emerald-500/15 aria-checked:text-emerald-700 dark:aria-checked:text-emerald-300"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
