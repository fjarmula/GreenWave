import { describe, expect, it } from "vitest";

import { createMarkerSlide } from "@/lib/marker-slide";

type Point = [number, number];

/** Manual frame clock: `frame(t)` runs the pending frame callback at time `t`. */
function harness() {
  const shown: Point[] = [];
  let pending: ((now: number) => void) | null = null;
  let clock = 0;
  const slide = createMarkerSlide<Point>({
    show: (point) => shown.push(point),
    interpolate: (from, to, progress) => [
      from[0] + (to[0] - from[0]) * progress,
      from[1] + (to[1] - from[1]) * progress,
    ],
    now: () => clock,
    requestFrame: (callback) => {
      pending = callback;
      return 1;
    },
    cancelFrame: () => {
      pending = null;
    },
  });
  const frame = (at: number) => {
    clock = at;
    const callback = pending;
    pending = null;
    callback?.(at);
  };
  return { slide, shown, frame, setClock: (at: number) => (clock = at) };
}

describe("marker slide", () => {
  it("places the first position without sliding", () => {
    const { slide, shown } = harness();
    slide.moveTo([0, 0], 1000);
    expect(shown).toEqual([[0, 0]]);
  });

  it("slides from the previous tick's position over the given duration", () => {
    const { slide, shown, frame } = harness();
    slide.moveTo([0, 0], 1000);
    slide.moveTo([100, 0], 200);
    frame(100);
    frame(200);
    expect(shown.slice(1)).toEqual([
      [50, 0],
      [100, 0],
    ]);
  });

  it("starts the next slide from the previous tick, never from a lagging mid-slide point", () => {
    // Ticks bunched by the network or a slow frame must not leave the marker behind the lights.
    const { slide, shown, frame, setClock } = harness();
    slide.moveTo([0, 0], 1000);
    slide.moveTo([100, 0], 100);
    frame(30); // only 30 % of the way when the next tick arrives
    setClock(30);
    slide.moveTo([200, 0], 100);
    frame(30);
    expect(shown.at(-1)).toEqual([100, 0]);
    frame(80);
    expect(shown.at(-1)).toEqual([150, 0]);
  });

  it("applies a new duration from the next tick without restarting the slide", () => {
    const { slide, shown, frame, setClock } = harness();
    slide.moveTo([0, 0], 1000);
    slide.moveTo([100, 0], 1000);
    frame(500);
    expect(shown.at(-1)).toEqual([50, 0]);
    setClock(1000);
    slide.moveTo([200, 0], 100); // speed changed to 10x
    frame(1050);
    expect(shown.at(-1)).toEqual([150, 0]);
  });

  it("jumps straight to each position when motion is reduced", () => {
    const { slide, shown } = harness();
    slide.moveTo([0, 0], 1000);
    slide.moveTo([100, 0], 1000, { reduceMotion: true });
    expect(shown).toEqual([
      [0, 0],
      [100, 0],
    ]);
  });

  it("stops sliding when cancelled", () => {
    const { slide, shown, frame } = harness();
    slide.moveTo([0, 0], 1000);
    slide.moveTo([100, 0], 1000);
    slide.cancel();
    frame(500);
    expect(shown).toEqual([[0, 0]]);
  });
});
