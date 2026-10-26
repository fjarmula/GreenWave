/**
 * Only the Driver's incident setup card minimizes: it has the peek row. The on-site answer that
 * can replace it has none, so minimizing would leave its "Back to setup" inert.
 */
export function setupSheetMinimizable({
  driver,
  setup,
  onSite,
}: {
  driver: boolean;
  setup: boolean;
  onSite: boolean;
}): boolean {
  return driver && setup && !onSite;
}
