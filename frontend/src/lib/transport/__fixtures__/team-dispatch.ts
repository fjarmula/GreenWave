/** Resource-aware ambulance bodies (ADR 0014), typed against the generated contract. */
import type {
  DispatchRankResponse,
  PrmTeam,
  RankedCandidate,
  ResourcesResponse,
  RosterInfo,
} from "@/types/telemetry";

export const ROSTER: RosterInfo = {
  source: "Wojewódzki plan działania systemu PRM",
  plan_update: "2",
  effective_from: "2026-09-01",
  teams_in_scope: 23,
};

function candidate(
  stationId: string,
  name: string,
  greenwave: number,
  standard: number,
  team: RankedCandidate["team"],
  selection_reason: RankedCandidate["selection_reason"] = null,
): RankedCandidate {
  return {
    station: {
      station_id: stationId,
      vehicle_type: "AMBULANCE",
      source_kind: "prm_base",
      name,
      position: { lat: 50.04, lng: 19.95 },
    },
    greenwave_seconds: greenwave,
    standard_seconds: standard,
    distance_m: 2000,
    on_site: false,
    team,
    selection_reason,
  };
}

/** The in-area team is chosen although an out-of-area team is 40 s faster (D4). */
export const TEAM_RANK: DispatchRankResponse = {
  schema_version: "1.0",
  incident_snapped: { position: { lat: 50.0445, lng: 19.9499 }, snap_distance_m: 3 },
  candidates: [
    candidate(
      "STN-A-0003",
      "ul. Rynek Podgórski 2, 30-533 Kraków",
      200,
      260,
      {
        team_code: "K01 008",
        team_type: "P2",
        area_teryt: ["1261049"],
        in_area: true,
        availability: "assumed_free",
        other_eligible_team_codes: ["K01 128"],
      },
      "IN_AREA_WITHIN_MARGIN",
    ),
    candidate("STN-A-0007", "ul. św. Łazarza 14, 31-530 Kraków", 160, 240, {
      team_code: "K01 001",
      team_type: "S",
      area_teryt: ["1261059"],
      in_area: false,
      availability: "free",
      other_eligible_team_codes: [],
    }),
  ],
  station_at_incident: null,
  scenario_time: "2026-10-27T21:00:00",
  outcome: "OK",
  incident_area: {
    teryt: "1261049",
    delegatura_name: "Podgórze",
    district_number: 13,
    district_name: "Podgórze",
  },
  excluded_teams: [
    { team_code: "K01 176", station_id: "STN-A-0003", reason: "OFF_SHIFT" },
    { team_code: "K01 018", station_id: "STN-A-0004", reason: "BUSY_OVERRIDE" },
  ],
  roster: ROSTER,
  area_rule: {
    reason: "IN_AREA_WITHIN_MARGIN",
    chosen_team_code: "K01 008",
    nearest_team_code: "K01 001",
    in_area_team_code: "K01 008",
    delta_seconds: 40,
  },
};

export const NO_ELIGIBLE_RANK: DispatchRankResponse = {
  ...TEAM_RANK,
  candidates: [],
  outcome: "NO_ELIGIBLE_RESOURCE",
  area_rule: null,
};

export function prmTeam(code: string, overrides: Partial<PrmTeam> = {}): PrmTeam {
  return {
    team_code: code,
    team_type: "P2",
    station_id: "STN-A-0003",
    base_address: "ul. Rynek Podgórski 2, 30-533 Kraków",
    area_teryt: ["1261049"],
    weekdays: "1234567",
    ready_from_min: 0,
    ready_to_min: 1440,
    season_from: "01-01",
    season_to: "12-31",
    on_shift: true,
    ...overrides,
  };
}

export const RESOURCES: ResourcesResponse = {
  schema_version: "1.0",
  roster: ROSTER,
  at: "2026-10-27T21:00:00",
  teams: [
    prmTeam("K01 008"),
    prmTeam("K01 128"),
    prmTeam("K01 176", {
      team_type: "P3",
      ready_from_min: 420,
      ready_to_min: 1140,
      on_shift: false,
    }),
    prmTeam("K01 001", {
      team_type: "S",
      station_id: "STN-A-0007",
      base_address: "ul. św. Łazarza 14, 31-530 Kraków",
      area_teryt: ["1261059"],
    }),
  ],
};

/** Long station names plus the drive/walk breakdown that must fit a narrow dispatch panel. */
export const TEAM_RANK_WITH_WALK: DispatchRankResponse = {
  ...TEAM_RANK,
  area_rule: { ...TEAM_RANK.area_rule!, reason: "NEAREST" },
  candidates: TEAM_RANK.candidates.map((candidate, index) => ({
    ...candidate,
    station: {
      ...candidate.station,
      name:
        index === 0
          ? "ul. Generała Bolesława Wieniawy-Długoszowskiego 15, Kraków"
          : "ul. Rynek Podgórski 2, 30-533 Kraków",
    },
    greenwave_seconds: index === 0 ? 200 : 430,
    standard_seconds: index === 0 ? 420 : 650,
    on_foot: { access_point: candidate.station.position, distance_m: 340, seconds: 242 },
    team: { ...candidate.team!, availability: "assumed_free", in_area: true },
  })),
};
