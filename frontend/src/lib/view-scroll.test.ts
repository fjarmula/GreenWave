import { describe, expect, it, vi } from "vitest";

import { scrollViewToTop } from "@/lib/view-scroll";

describe("scrollViewToTop", () => {
  it("scrolls to the top and returns nothing, so React never treats it as a cleanup", () => {
    // Some environments' scrollTo returns a value; returning it from an effect throws
    // "destroy is not a function" in React.
    const scrollTo = vi.fn(() => ({}) as unknown as undefined);

    const result = scrollViewToTop({ scrollTo });

    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
    expect(result).toBeUndefined();
  });
});
