"use client";
import { useId, useRef } from "react";
import { useCorridorLoop } from "@/components/workspace/useCorridorLoop";
import { TRAIL, corridor, signalState } from "@/lib/home-corridor";

const [, , WIDTH, HEIGHT] = corridor.viewBox;
const [START_X, START_Y] = corridor.route.path.slice(1).split("L")[0].split(",").map(Number);
// Phones stack the text over the whole width: keep the corridor near the right edge.
const [PX, PY, PW, PH] = corridor.phoneViewBox;
const PHONE_VIEW_BOX = [PX - PW * 0.3, PY, PW, PH].join(" ");

/**
 * The home corridor drawn over Kraków's real roads (a baked alpha mask coloured per theme).
 * Frames write SVG attributes directly; nothing re-renders per frame.
 */
export function HomeStaticBackdrop({ phone }: { phone: boolean }) {
  const maskId = useId();
  const trail = useRef<SVGPathElement>(null);
  const vehicle = useRef<SVGGElement>(null);
  const signals = useRef<SVGGElement>(null);

  useCorridorLoop((progress) => {
    const path = trail.current;
    if (!path) return;
    const length = path.getTotalLength();
    const head = progress * length;
    const lit = Math.min(head, TRAIL * length);
    path.style.strokeDasharray = `${lit} ${length}`;
    path.style.strokeDashoffset = `${lit - head}`;
    const point = path.getPointAtLength(head);
    vehicle.current?.setAttribute("transform", `translate(${point.x} ${point.y})`);
    signals.current?.querySelectorAll<SVGCircleElement>("[data-signal]").forEach((circle, i) => {
      circle.dataset.state = signalState(corridor.signals[i].t, progress);
    });
  });

  return (
    <svg
      className="home-backdrop-svg"
      viewBox={phone ? PHONE_VIEW_BOX : corridor.viewBox.join(" ")}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <defs>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x={0}
          y={0}
          width={WIDTH}
          height={HEIGHT}
          style={{ maskType: "alpha" }}
        >
          <image href="/home/krakow-roads.svg" width={WIDTH} height={HEIGHT} />
        </mask>
      </defs>
      <rect className="home-roads" width={WIDTH} height={HEIGHT} mask={`url(#${maskId})`} />
      <path className="home-corridor-base" d={corridor.route.path} />
      <path ref={trail} className="home-corridor-trail" d={corridor.route.path} />
      <g ref={signals}>
        {corridor.signals.map((signal) => (
          <circle
            key={signal.id}
            className="home-signal"
            data-signal={signal.id}
            data-state="ahead"
            cx={signal.x}
            cy={signal.y}
            r={5}
          />
        ))}
      </g>
      <g ref={vehicle} transform={`translate(${START_X} ${START_Y})`}>
        <circle className="home-vehicle-halo" r={14} />
        <circle className="home-vehicle" r={6} />
      </g>
    </svg>
  );
}
