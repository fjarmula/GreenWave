/**
 * Runs a layer effect's `addSource`/`addLayer` calls. Mid theme swap the next style is still
 * loading and MapLibre throws; the effect re-runs on the new style's `styleRevision`, so that
 * one case is skipped (returns false). Any other error is a bug and propagates.
 */
export function addToStyle(add: () => void): boolean {
  try {
    add();
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Style is not done loading"))
      return false;
    throw error;
  }
}
