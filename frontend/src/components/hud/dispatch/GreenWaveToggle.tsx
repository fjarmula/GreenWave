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
          : "Simulated standard traffic, no signal priority: at a red or yellow signal the vehicle rolls through cautiously without stopping, within the ordinary speed limit."}
      </p>
      <div role="radiogroup" aria-label="ER Green Wave" className="hud-segmented mt-2">
        {MODES.map((option) => (
          <button
            key={option.mode}
            type="button"
            role="radio"
            aria-checked={mode === option.mode}
            onClick={() => onChange(option.mode)}
            className={`hud-segment ${option.mode === "ENABLED" ? "tone-go" : ""}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
