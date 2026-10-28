import type { StationSourceKind, VehicleType } from "@/types/telemetry";

/** Every station says where it comes from; ambulances start only from PRM team bases. */
export const SOURCE_KIND_LABELS: Record<StationSourceKind, string> = {
  prm_base: "PRM team base",
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

/** The vehicle on its own, e.g. in the live panels ("Fire" alone reads as the event). */
export const VEHICLE_NAMES: Record<VehicleType, string> = {
  AMBULANCE: "Ambulance",
  FIRE_TRUCK: "Fire truck",
  POLICE_CAR: "Police car",
};
