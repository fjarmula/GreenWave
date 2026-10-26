/** About 1.5 sine periods across the tile; shared with `app/icon.svg`. */
export const WAVE_PATH = "M5 19 C8.5 19 9.5 11 13 11 S17.5 21 21 21 S25.5 13 27 13";

/** The brand mark: a green tile carrying the wave, with the vehicle at its leading edge. */
export function GreenWaveMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={`brand-mark ${className}`}>
      <rect width="32" height="32" rx="8" fill="var(--go)" />
      <path
        d={WAVE_PATH}
        fill="none"
        stroke="var(--brand-ink)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="27" cy="13" r="3" fill="var(--brand-ink)" />
    </svg>
  );
}
