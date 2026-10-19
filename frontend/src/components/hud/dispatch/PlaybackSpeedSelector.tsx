import { PLAYBACK_SPEEDS, type PlaybackSpeed } from "@/lib/playback-speed";

type PlaybackSpeedSelectorProps = {
  value: PlaybackSpeed;
  onChange: (speed: PlaybackSpeed) => void;
};

export function PlaybackSpeedSelector({ value, onChange }: PlaybackSpeedSelectorProps) {
  return (
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
            aria-checked={value === speed}
            onClick={() => onChange(speed)}
            className={`min-h-8 rounded-md font-mono text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 ${
              value === speed
                ? "bg-background text-cyan-700 shadow-sm dark:text-cyan-300"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {speed}×
          </button>
        ))}
      </div>
    </div>
  );
}
