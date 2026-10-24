import { describe, expect, it } from "vitest";

import { distinctStreetName, upcomingIntersectionIds } from "@/lib/driver-signal-labels";
import type { IntersectionTelemetry, RouteIntersection } from "@/types/telemetry";

const tick = (id: string, tti: number | null) =>
  ({ id, name: null, state: "NORMAL", tti_seconds: tti }) as IntersectionTelemetry;

const route = (...names: Array<[id: string, name: string | null]>) =>
  names.map(([id, name]) => ({ id, name }) as RouteIntersection);

describe("upcomingIntersectionIds", () => {
  it("labels the next two", () => {
    const ids = upcomingIntersectionIds([
      tick("a", null),
      tick("b", 12),
      tick("c", 30),
      tick("d", 55),
    ]);
    expect([...ids]).toEqual(["b", "c"]);
  });

  it("labels at most the remaining upcoming", () => {
    expect([...upcomingIntersectionIds([tick("a", null), tick("b", null), tick("c", 8)])]).toEqual([
      "c",
    ]);
    expect(upcomingIntersectionIds([tick("a", null), tick("b", null)]).size).toBe(0);
  });
});

describe("distinctStreetName", () => {
  const slowackiego = route(
    ["X", "Aleja Juliusza Słowackiego / Mazowiecka"],
    ["Y", "Aleja Juliusza Słowackiego / Krowoderska"],
    ["Z", "Aleja Juliusza Słowackiego / Łobzowska"],
  );

  it("drops the shared street", () => {
    expect(distinctStreetName("Y", slowackiego)).toBe("Krowoderska");
    expect(distinctStreetName("X", slowackiego)).toBe("Mazowiecka");
  });

  it("keeps all distinguishing parts", () => {
    const names = route(
      ["A", "Karola Bunscha / Profesora Michała Bobrzyńskiego / Czerwone Maki"],
      ["B", "Profesora Michała Bobrzyńskiego / Drukarska"],
    );
    expect(distinctStreetName("A", names)).toBe("Karola Bunscha / Czerwone Maki");
  });

  it("falls back to the first part", () => {
    const names = route(["P", "Mogilska / Lema"], ["Q", "Mogilska"], ["R", "Mogilska / Meissnera"]);
    expect(distinctStreetName("Q", names)).toBe("Mogilska");
  });

  it("no label for coordinate names", () => {
    const names = route(["C", "50.07118, 20.00717"], ["N", null]);
    expect(distinctStreetName("C", names)).toBeNull();
    expect(distinctStreetName("N", names)).toBeNull();
    expect(distinctStreetName("missing", names)).toBeNull();
  });
});
