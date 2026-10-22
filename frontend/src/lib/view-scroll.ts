/**
 * Effect body: each dashboard view starts at its top, so the live KPI strip (and its phone Stop)
 * is on screen. Returns nothing on purpose; an effect's return value is called as its cleanup.
 */
export function scrollViewToTop(target: Pick<Window, "scrollTo">): void {
  target.scrollTo({ top: 0 });
}
