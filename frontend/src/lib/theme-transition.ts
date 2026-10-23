export type ResolvedTheme = "light" | "dark";

/** Work that must finish before the new theme is captured (e.g. the map's restyle). */
export type ThemeBarrier = (next: ResolvedTheme) => Promise<void>;

type ViewTransitionHandle = { finished: Promise<void>; skipTransition(): void };

export type ThemeTransitionEnv = {
  startViewTransition?: (update: () => Promise<void>) => ViewTransitionHandle;
  reduceMotion: boolean;
  /** Longest the screen may hold the old frame while barriers run. */
  capMs?: number;
};

const DEFAULT_CAP_MS = 300;
const barriers = new Set<ThemeBarrier>();
let running: ViewTransitionHandle | null = null;

export function registerThemeBarrier(barrier: ThemeBarrier): () => void {
  barriers.add(barrier);
  return () => barriers.delete(barrier);
}

function browserEnv(): ThemeTransitionEnv {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (typeof document.startViewTransition !== "function") return { reduceMotion };
  return {
    reduceMotion,
    startViewTransition: (update) => document.startViewTransition(update),
  };
}

/**
 * Switches theme as one compositor cross-fade: the browser snapshots the old page, `apply` must
 * commit the new theme synchronously, and the new page is captured once barriers settle or the cap
 * passes. Without View Transitions (or with reduced motion) the theme applies in a single frame.
 */
export function transitionTheme(
  apply: () => void,
  next: ResolvedTheme,
  env: ThemeTransitionEnv = browserEnv(),
): Promise<void> {
  if (!env.startViewTransition || env.reduceMotion) {
    apply();
    return Promise.resolve();
  }
  running?.skipTransition();
  const capMs = env.capMs ?? DEFAULT_CAP_MS;
  const transition = env.startViewTransition(async () => {
    apply();
    const pending = [...barriers].map((barrier) => barrier(next));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cap = new Promise<void>((resolve) => (timer = setTimeout(resolve, capMs)));
    await Promise.race([Promise.allSettled(pending), cap]);
    clearTimeout(timer);
  });
  running = transition;
  return transition.finished
    .catch(() => undefined)
    .finally(() => {
      if (running === transition) running = null;
    });
}
