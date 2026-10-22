import type { RunStatusKey } from "@/lib/simulation-copy";

/** Status dot: green while all is well, amber while waiting or overridden, red on failure. */
export const RUN_STATUS_DOTS: Record<RunStatusKey, string> = {
  SETUP: "bg-go shadow-[0_0_10px_var(--go)]",
  STARTING: "bg-caution",
  RUNNING: "bg-go shadow-[0_0_10px_var(--go)]",
  FINISHED: "bg-muted-foreground",
  CANCELLED: "bg-caution",
  STOPPED: "bg-muted-foreground",
  SERVER_ERROR: "bg-emergency",
  ERROR: "bg-emergency",
};

/** Text tone for an ended run's outcome, matching its dot. */
export const RUN_OUTCOME_TEXT: Record<RunStatusKey, string> = {
  SETUP: "text-muted-foreground",
  STARTING: "text-caution",
  RUNNING: "text-go",
  FINISHED: "text-foreground",
  CANCELLED: "text-caution",
  STOPPED: "text-foreground",
  SERVER_ERROR: "text-emergency",
  ERROR: "text-emergency",
};
