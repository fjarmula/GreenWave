import type { CSSProperties } from "react";

/**
 * One 8s loop: the vehicle drives the corridor in the first 6.8s (85%) and every signal turns
 * green just before it arrives. All delays share one offset so the paused (reduced-motion)
 * frame shows the vehicle mid-corridor with the signal ahead already green.
 */
const ROAD_START = 40;
const ROAD_END = 760;
const TRAVEL_SECONDS = 6.8;
const SIGNAL_ARRIVAL_AT = 2; // seconds into the signal keyframes (25% of 8s)
const FRAME_OFFSET = 2.2;
const SIGNALS = [160, 280, 400, 520, 640];

const arrival = (x: number) => ((x - ROAD_START) / (ROAD_END - ROAD_START)) * TRAVEL_SECONDS;
const delay = (seconds: number) => ({ animationDelay: `${seconds.toFixed(3)}s` }) as CSSProperties;

const STREETS = [ROAD_START - 40, ...SIGNALS, ROAD_END + 40];

export function GreenWaveIllustration() {
  return (
    <svg
      className="corridor-art"
      viewBox="0 0 800 210"
      role="img"
      aria-label="Illustration: an emergency vehicle drives a corridor while each signal ahead turns green before it arrives."
    >
      <defs>
        <linearGradient id="corridor-wave" x1="0" x2="1">
          <stop offset="0" stopColor="var(--go)" stopOpacity="0.55" />
          <stop offset="1" stopColor="var(--go)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {STREETS.slice(0, -1).map((left, i) => {
        const right = STREETS[i + 1];
        return (
          <g key={left} className="corridor-block">
            <rect x={left + 14} y={14} width={right - left - 28} height={58} rx={6} />
            <rect x={left + 14} y={150} width={right - left - 28} height={46} rx={6} />
          </g>
        );
      })}
      {SIGNALS.map((x) => (
        <line key={x} className="corridor-cross" x1={x} x2={x} y1={0} y2={210} />
      ))}
      <line className="corridor-road" x1={0} x2={800} y1={120} y2={120} />
      <line className="corridor-lane" x1={0} x2={800} y1={120} y2={120} />

      {SIGNALS.map((x, i) => (
        <g key={x}>
          <line className="corridor-post" x1={x + 14} x2={x + 14} y1={106} y2={92} />
          <circle className="corridor-lamp-stop" cx={x + 14} cy={86} r={6} />
          <circle
            className="corridor-lamp-go"
            cx={x + 14}
            cy={86}
            r={6}
            style={delay(arrival(x) - SIGNAL_ARRIVAL_AT - FRAME_OFFSET)}
          />
          <text className="corridor-label" x={x + 24} y={89}>
            INT-0{i + 1}
          </text>
        </g>
      ))}

      <g className="corridor-vehicle" style={delay(-FRAME_OFFSET)}>
        <rect x={ROAD_START} y={116} width={150} height={8} rx={4} fill="url(#corridor-wave)" />
        <circle className="corridor-vehicle-pulse" cx={ROAD_START} cy={120} r={9} />
        <circle className="corridor-vehicle-dot" cx={ROAD_START} cy={120} r={7} />
      </g>
    </svg>
  );
}
