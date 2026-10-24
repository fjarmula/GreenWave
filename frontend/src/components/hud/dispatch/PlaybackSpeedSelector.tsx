import { PLAYBACK_SPEEDS, type PlaybackSpeed } from "@/lib/playback-speed";

type PlaybackSpeedSelectorProps = {
  value: PlaybackSpeed;
  label?: string;
  onChange: (speed: PlaybackSpeed) => void;
};

export function PlaybackSpeedSelector({
  value,
  onChange,
  label = "Playback speed",
}: PlaybackSpeedSelectorProps) {
  return (
    <div className="mt-6">
      <div className="flex items-center justify-between gap-3">
        <span id="playback-speed-label" className="dashboard-label">
          {label}
        </span>
        <span className="text-2xs text-muted-foreground">simulated s per real s</span>
      </div>
      <div role="radiogroup" aria-labelledby="playback-speed-label" className="hud-segmented mt-2">
        {PLAYBACK_SPEEDS.map((speed) => (
          <button
            key={speed}
            type="button"
            role="radio"
            aria-checked={value === speed}
            onClick={() => onChange(speed)}
            className="hud-segment hud-value"
          >
            {speed}×
          </button>
        ))}
      </div>
    </div>
  );
}
