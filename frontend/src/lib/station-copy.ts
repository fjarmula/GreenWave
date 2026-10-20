import type { StationSourceKind, VehicleType } from "@/types/telemetry";

/** Every station says where it comes from, so a hospital ED is never passed off as a base. */
export const SOURCE_KIND_LABELS: Record<StationSourceKind, string> = {
  ambulance_base: "Ambulance base",
  hospital_ed: "Hospital emergency dept.",
  fire_state: "State fire service (PSP)",
  fire_volunteer: "Volunteer fire brigade (OSP)",
  fire_other: "Fire brigade",
  police: "Police station",
};

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  AMBULANCE: "Ambulance",
  FIRE_TRUCK: "Fire",
  POLICE_CAR: "Police",
};
