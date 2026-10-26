import { describe, expect, it } from "vitest";
import {
  dampedOffset,
  nextSnap,
  settleSnap,
  sheetTravel,
  shouldDragSheet,
  type SnapStop,
} from "./sheet-physics";

describe("nextSnap", () => {
  it("opens on an upward flick regardless of distance", () => {
    expect(nextSnap("collapsed", -10, -0.2, 300)).toBe("expanded");
  });
  it("stays collapsed before half the travel without a flick", () => {
    expect(nextSnap("collapsed", -100, 0, 300)).toBe("collapsed");
  });
  it("opens past half the travel", () => {
    expect(nextSnap("collapsed", -160, 0, 300)).toBe("expanded");
  });
  it("collapses on a downward flick", () => {
    expect(nextSnap("expanded", 20, 0.3, 300)).toBe("collapsed");
  });
  it("keeps the snap when the flick points the way it already is", () => {
    expect(nextSnap("collapsed", 10, 0.4, 300)).toBe("collapsed");
    expect(nextSnap("expanded", -10, -0.4, 300)).toBe("expanded");
  });
});

describe("dampedOffset", () => {
  it("follows the finger inside the bounds", () => {
    expect(dampedOffset(-100, -300, 0)).toBe(-100);
  });
  it("damps past a bound", () => {
    expect(dampedOffset(-400, -300, 0)).toBe(-325);
    expect(dampedOffset(40, -300, 0)).toBe(10);
  });
});

describe("shouldDragSheet (defers to inner scroll)", () => {
  it("always drags from the header", () => {
    expect(shouldDragSheet(120, -5, false)).toBe(true);
  });
  it("lets a scrolled list scroll", () => {
    expect(shouldDragSheet(40, 12, true)).toBe(false);
    expect(shouldDragSheet(0, -12, true)).toBe(false);
  });
  it("moves the sheet once the list is at the top and the drag is downward", () => {
    expect(shouldDragSheet(0, 12, true)).toBe(true);
  });
});

describe("sheetTravel (recomputes snaps on resize)", () => {
  it("is the part of the sheet below the collapsed slot", () => {
    expect(sheetTravel(600, 180)).toBe(420);
  });
  it("follows a smaller container after rotation", () => {
    expect(sheetTravel(300, 180)).toBe(120);
  });
  it("never goes negative, so the sheet never ends off-screen", () => {
    expect(sheetTravel(150, 180)).toBe(0);
  });
});

describe("settleSnap", () => {
  const three: SnapStop[] = [
    { snap: "expanded", translate: 0 },
    { snap: "collapsed", translate: 300 },
    { snap: "minimized", translate: 520 },
  ];
  it("settles on the stop nearest the release point", () => {
    expect(settleSnap(three, 300, 150, 0)).toBe("minimized");
    expect(settleSnap(three, 300, 40, 0)).toBe("collapsed");
  });
  it("moves one stop in the direction of a flick", () => {
    expect(settleSnap(three, 300, 10, 0.3)).toBe("minimized");
    expect(settleSnap(three, 520, -10, -0.3)).toBe("collapsed");
    expect(settleSnap(three, 0, -10, -0.3)).toBe("expanded");
  });
  it("keeps the two-snap sheet unchanged", () => {
    const two = three.slice(0, 2);
    expect(settleSnap(two, 300, 10, 0.3)).toBe("collapsed");
  });
});
