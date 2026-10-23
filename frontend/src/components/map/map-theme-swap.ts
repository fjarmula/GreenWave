import type { ResolvedTheme } from "@/lib/theme-transition";

/** The slice of a MapLibre map a theme swap needs. */
export type MapStyleTarget = {
  setStyle(url: string): void;
  onceStyleLoad(callback: () => void): void;
  tilesReady(): boolean;
  /** Draws a frame now; rAF-driven repaints do not run while a view transition holds rendering. */
  paint(): void;
};

const TILE_POLL_MILLISECONDS = 16;
/** Tiles that are not ready by now (slow or offline basemap) are painted as they are. */
const TILE_GIVE_UP_MILLISECONDS = 2000;

/**
 * Swaps the basemap style and reports when the new style can be painted. Rendering is paused while a
 * view transition captures the new page, so readiness is polled with timers instead of map events.
 */
export function createMapThemeSwap(
  target: MapStyleTarget,
  styles: Record<ResolvedTheme, string>,
  initial: ResolvedTheme,
) {
  let applied = initial;
  let pending: Promise<void> = Promise.resolve();
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settle: (() => void) | null = null;

  function to(next: ResolvedTheme): Promise<void> {
    if (next === applied || disposed) return pending;
    applied = next;
    pending = new Promise<void>((resolve) => {
      settle = resolve;
      target.onceStyleLoad(() => {
        const giveUpAt = Date.now() + TILE_GIVE_UP_MILLISECONDS;
        const poll = () => {
          if (disposed) return;
          if (!target.tilesReady() && Date.now() < giveUpAt) {
            timer = setTimeout(poll, TILE_POLL_MILLISECONDS);
            return;
          }
          target.paint();
          resolve();
        };
        poll();
      });
    });
    target.setStyle(styles[next]);
    return pending;
  }

  function dispose() {
    disposed = true;
    clearTimeout(timer);
    settle?.();
  }

  return { to, dispose, applied: () => applied };
}
