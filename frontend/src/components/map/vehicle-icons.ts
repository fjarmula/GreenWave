import { Ambulance, FlameKindling, Siren, type LucideIcon } from "lucide-react";

import type { VehicleType } from "@/types/telemetry";

const VEHICLE_ICONS: Record<VehicleType, LucideIcon> = {
  AMBULANCE: Ambulance,
  FIRE_TRUCK: FlameKindling,
  POLICE_CAR: Siren,
};

export function vehicleIcon(type: VehicleType): LucideIcon {
  return VEHICLE_ICONS[type];
}

/** Marker fill per type; literal class names so Tailwind generates them. */
export const VEHICLE_ICON_COLORS: Record<VehicleType, string> = {
  AMBULANCE: "bg-sky-600 text-white",
  FIRE_TRUCK: "bg-orange-600 text-white",
  POLICE_CAR: "bg-indigo-600 text-white",
};
