/**
 * The vehicle marker's slide between ticks, kept free of MapLibre and the DOM so it is testable.
 *
 * Each tick is one simulated second and its signal lights are shown as soon as it arrives, so the
 * slide for a tick always starts from the previous tick's position: a slide cut short by a fast or
 * bunched tick never leaves the marker behind the lights it is shown under.
 */
export type MarkerSlideOptions<P> = {
  show(point: P): void;
  interpolate(from: P, to: P, progress: number): P;
  now(): number;
  requestFrame(callback: (now: number) => void): number;
  cancelFrame(handle: number): void;
};

export type MarkerSlide<P> = {
  /** Slide to `target` over `durationMilliseconds` (the tick interval); the first call places it. */
  moveTo(target: P, durationMilliseconds: number, options?: { reduceMotion?: boolean }): void;
  cancel(): void;
};

export function createMarkerSlide<P>(options: MarkerSlideOptions<P>): MarkerSlide<P> {
  let previous: P | null = null;
  let frame: number | null = null;

  const cancel = () => {
    if (frame !== null) options.cancelFrame(frame);
    frame = null;
  };

  return {
    moveTo(target, durationMilliseconds, { reduceMotion = false } = {}) {
      cancel();
      const from = previous;
      previous = target;
      if (from === null || reduceMotion || durationMilliseconds <= 0) {
        options.show(target);
        return;
      }
      const started = options.now();
      const step = (now: number) => {
        const progress = Math.min(1, Math.max(0, (now - started) / durationMilliseconds));
        options.show(options.interpolate(from, target, progress));
        frame = progress < 1 ? options.requestFrame(step) : null;
      };
      frame = options.requestFrame(step);
    },
    cancel,
  };
}
