import { describe, expect, it } from "vitest";

import { vehicleIcon, VEHICLE_ICON_COLORS } from "@/components/map/vehicle-icons";
import type { VehicleType } from "@/types/telemetry";

const TYPES: VehicleType[] = ["AMBULANCE", "FIRE_TRUCK", "POLICE_CAR"];

describe("vehicleIcon", () => {
  it("has a distinct icon for every vehicle type", () => {
    const icons = TYPES.map(vehicleIcon);
    icons.forEach((icon) => expect(icon).toBeTruthy());
    expect(new Set(icons).size).toBe(TYPES.length);
  });

  it("has a colour for every vehicle type", () => {
    expect(Object.keys(VEHICLE_ICON_COLORS).sort()).toEqual([...TYPES].sort());
  });
});
