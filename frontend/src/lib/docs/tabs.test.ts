import { describe, expect, it } from "vitest";
import { nextTabIndex, sectionFromHash } from "./tabs";

describe("sectionFromHash", () => {
  it.each(["#data", "data"])("reads %s", (hash) => expect(sectionFromHash(hash)).toBe("data"));
  it.each(["", "#", "#foo", "#DATA", "#data?x=1"])("falls back to about for %j", (hash) =>
    expect(sectionFromHash(hash)).toBe("about"),
  );
});

describe("nextTabIndex", () => {
  it("wraps arrows", () => {
    expect(nextTabIndex("ArrowRight", 5, 6)).toBe(0);
    expect(nextTabIndex("ArrowLeft", 0, 6)).toBe(5);
    expect(nextTabIndex("ArrowRight", 2, 6)).toBe(3);
  });
  it("jumps with Home and End", () => {
    expect(nextTabIndex("Home", 3, 6)).toBe(0);
    expect(nextTabIndex("End", 0, 6)).toBe(5);
  });
  it("ignores other keys", () => expect(nextTabIndex("Enter", 2, 6)).toBeNull());
});

it("uses Up/Down for the vertical documentation rail", () => {
  expect(nextTabIndex("ArrowDown", 0, 5, "vertical")).toBe(1);
  expect(nextTabIndex("ArrowUp", 0, 5, "vertical")).toBe(4);
  expect(nextTabIndex("ArrowRight", 0, 5, "vertical")).toBeNull();
  expect(sectionFromHash("#run")).toBe("about");
});

it("opens the system logic reference directly from its URL hash", () => {
  expect(sectionFromHash("#logic")).toBe("logic");
});
