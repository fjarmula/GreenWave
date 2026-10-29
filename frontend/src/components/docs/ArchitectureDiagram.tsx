import { useId } from "react";
import type { ArchitectureNodeId } from "@/lib/docs/content";

type Box = { x: number; y: number; w: number; h: number };
type Layout = {
  viewBox: string;
  boxes: Record<ArchitectureNodeId, Box>;
  /** Data flow, then the corridor path drawn in signal green, then the simulated ITS link. */
  flow: string[];
  corridor: string[];
  its: string;
};

const W = 150;
const H = 52;
// Wide: ETL row on top, live run row below, simulated ITS under the API.
const wide: Layout = {
  viewBox: "0 0 740 196",
  boxes: {
    sources: { x: 10, y: 16, w: W, h: H },
    etl: { x: 200, y: 16, w: W, h: H },
    dataset: { x: 390, y: 16, w: W, h: H },
    api: { x: 580, y: 16, w: W, h: H },
    its: { x: 580, y: 128, w: W, h: H },
    stream: { x: 390, y: 128, w: W, h: H },
    dashboard: { x: 200, y: 128, w: W, h: H },
  },
  flow: ["M160 42 H194", "M350 42 H384", "M540 42 H574"],
  corridor: ["M610 68 V98 H465 V122", "M390 154 H356"],
  its: "M655 74 V122",
};
// Narrow: one column, simulated ITS beside the API.
const narrow: Layout = {
  viewBox: "0 0 340 452",
  boxes: {
    sources: { x: 10, y: 8, w: 180, h: H },
    etl: { x: 10, y: 84, w: 180, h: H },
    dataset: { x: 10, y: 160, w: 180, h: H },
    api: { x: 10, y: 236, w: 180, h: H },
    its: { x: 220, y: 236, w: 110, h: H },
    stream: { x: 10, y: 312, w: 180, h: H },
    dashboard: { x: 10, y: 388, w: 180, h: H },
  },
  flow: ["M100 60 V78", "M100 136 V154", "M100 212 V230"],
  corridor: ["M100 288 V306", "M100 364 V382"],
  its: "M196 262 H214",
};

function Diagram({
  layout,
  nodes,
  caption,
  className,
}: {
  layout: Layout;
  nodes: Record<ArchitectureNodeId, string>;
  caption: string;
  className: string;
}) {
  const id = useId();
  const arrow = `${id}-arrow`;
  const go = `${id}-go`;
  return (
    <svg className={className} viewBox={layout.viewBox} role="img" aria-label={caption}>
      <defs>
        {[
          [arrow, "var(--muted-foreground)"],
          [go, "var(--signal-green)"],
        ].map(([markerId, fill]) => (
          <marker
            key={markerId}
            id={markerId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 z" fill={fill} />
          </marker>
        ))}
      </defs>
      {layout.flow.map((d) => (
        <path key={d} d={d} className="docs-diagram-line" markerEnd={`url(#${arrow})`} />
      ))}
      {layout.corridor.map((d) => (
        <path
          key={d}
          d={d}
          className="docs-diagram-line docs-diagram-go"
          markerEnd={`url(#${go})`}
        />
      ))}
      <path
        d={layout.its}
        className="docs-diagram-line docs-diagram-simulated"
        markerStart={`url(#${arrow})`}
        markerEnd={`url(#${arrow})`}
      />
      {(Object.keys(layout.boxes) as ArchitectureNodeId[]).map((node) => {
        const { x, y, w, h } = layout.boxes[node];
        return (
          <g key={node}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx="10"
              className={
                node === "its" ? "docs-diagram-box docs-diagram-simulated" : "docs-diagram-box"
              }
            />
            <text x={x + w / 2} y={y + h / 2} className="docs-diagram-label">
              {nodes[node]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Two SVGs swapped by CSS; the hidden one is display:none, so assistive tech reads one. */
export function ArchitectureDiagram({
  nodes,
  caption,
}: {
  nodes: Record<ArchitectureNodeId, string>;
  caption: string;
}) {
  return (
    <figure className="docs-diagram">
      <Diagram layout={wide} nodes={nodes} caption={caption} className="docs-diagram-wide" />
      <Diagram layout={narrow} nodes={nodes} caption={caption} className="docs-diagram-narrow" />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
