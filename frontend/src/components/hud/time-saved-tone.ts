import type { TimeSavedTone } from "@/lib/simulation-copy";

/**
 * Text colour for a "saved vs normal-traffic" value. The sign stays in the text, so colour
 * is never the only signal; a non-positive saving is not shown as a success.
 */
export const SAVED_VALUE_TONES: Record<TimeSavedTone, string> = {
  positive: "text-emerald-700 dark:text-emerald-300",
  neutral: "text-muted-foreground",
  negative: "text-amber-700 dark:text-amber-300",
};
