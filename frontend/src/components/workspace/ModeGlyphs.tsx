/**
 * The home mode icons as one family: the line is the drive, the dot is the vehicle. Green Wave
 * flows (the logo's wave), standard traffic stops and starts, comparison stacks both lanes with
 * the Green Wave vehicle ahead. Drawn for 18px.
 */
type GlyphProps = { className?: string };

export function GreenWaveGlyph({ className }: GlyphProps) {
  return (
    <svg viewBox="5 5 24 22" fill="none" aria-hidden className={className}>
      <path
        d="M7 19 C9.6 19 10.4 13 13 13 S16.4 20.5 19 20.5 S22.4 14.5 24 14.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="25.2" cy="14.5" r="2.3" fill="currentColor" />
    </svg>
  );
}

export function StandardTrafficGlyph({ className }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path
        d="M2.5 17h4.5V7.5h5.5V17h3.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="19.4" cy="17" r="2.3" fill="currentColor" />
    </svg>
  );
}

export function ComparisonGlyph({ className }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path
        d="M3 8 C5.2 8 5.8 4.6 8 4.6 S10.8 8 13 8 S15.2 6 16 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="19" cy="6" r="2.1" fill="currentColor" />
      <path
        d="M3 19.5h3v-5h3.5v5H11"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="14" cy="19.5" r="2.1" fill="currentColor" />
    </svg>
  );
}
