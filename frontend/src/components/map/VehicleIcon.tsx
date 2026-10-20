import { createElement } from "react";

import { vehicleIcon } from "@/components/map/vehicle-icons";
import type { VehicleType } from "@/types/telemetry";

/** The lucide icon of a vehicle type, decorative. */
export function VehicleIcon({ type, className }: { type: VehicleType; className?: string }) {
  return createElement(vehicleIcon(type), { className, "aria-hidden": true });
}
