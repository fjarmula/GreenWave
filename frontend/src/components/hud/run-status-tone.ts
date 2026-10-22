import type { RunStatusKey } from "@/lib/simulation-copy";

/** Status dot: green while all is well, amber while waiting or overridden, red on failure. */
export const RUN_STATUS_DOTS: Record<RunStatusKey, string> = {
  SETUP: "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]",
  STARTING: "bg-amber-500",
  RUNNING: "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]",
  FINISHED: "bg-muted-foreground",
  CANCELLED: "bg-amber-500",
  STOPPED: "bg-muted-foreground",
  SERVER_ERROR: "bg-red-500",
  ERROR: "bg-red-500",
};

/** Text tone for an ended run's outcome, matching its dot. */
export const RUN_OUTCOME_TEXT: Record<RunStatusKey, string> = {
  SETUP: "text-muted-foreground",
  STARTING: "text-amber-700 dark:text-amber-300",
  RUNNING: "text-emerald-700 dark:text-emerald-300",
  FINISHED: "text-foreground",
  CANCELLED: "text-amber-700 dark:text-amber-300",
  STOPPED: "text-foreground",
  SERVER_ERROR: "text-red-700 dark:text-red-300",
  ERROR: "text-red-700 dark:text-red-300",
};
