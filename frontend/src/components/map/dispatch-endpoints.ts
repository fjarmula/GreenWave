export type MapCoordinates = [longitude: number, latitude: number];

type DispatchEndpoint = {
  id: string;
  label: string;
  mapLabel: string;
  coordinates: MapCoordinates;
};

export const ORIGIN_ENDPOINTS = [
  {
    id: "hospital",
    label: "University Hospital (SOR)",
    mapLabel: "University Hospital",
    coordinates: [19.955, 50.015] as MapCoordinates,
  },
  {
    id: "prokocim",
    label: "Prokocim Emergency Hub",
    mapLabel: "Prokocim Hub",
    coordinates: [20.011, 50.005] as MapCoordinates,
  },
  {
    id: "rydygier",
    label: "Rydygier Hospital",
    mapLabel: "Rydygier Hospital",
    coordinates: [19.949, 50.093] as MapCoordinates,
  },
] as const satisfies readonly DispatchEndpoint[];

export const DESTINATION_ENDPOINTS = [
  {
    id: "station",
    label: "Łazarza ZRM Station",
    mapLabel: "Łazarza ZRM",
    coordinates: [19.96, 50.063] as MapCoordinates,
  },
  {
    id: "wroclawska",
    label: "Wrocławska ZRM Station",
    mapLabel: "Wrocławska ZRM",
    coordinates: [19.934, 50.08] as MapCoordinates,
  },
  {
    id: "nowa-huta",
    label: "Nowa Huta Dispatch Point",
    mapLabel: "Nowa Huta",
    coordinates: [20.037, 50.069] as MapCoordinates,
  },
] as const satisfies readonly DispatchEndpoint[];

export type OriginEndpoint = (typeof ORIGIN_ENDPOINTS)[number];
export type DestinationEndpoint = (typeof DESTINATION_ENDPOINTS)[number];
export type OriginEndpointId = OriginEndpoint["id"];
export type DestinationEndpointId = DestinationEndpoint["id"];
