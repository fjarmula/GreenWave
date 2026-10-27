/**
 * Frontend names for the canonical v1 simulation contract (ADR 0003).
 * Every type is an alias of `api.generated.ts`, which is generated from the
 * backend Pydantic schemas; this file must not declare wire shapes of its own.
 * Types do not validate untrusted JSON: see `lib/transport/validate.ts`.
 */
import type { components } from "@/types/api.generated";

type Schemas = components["schemas"];

export type Position = Schemas["Position"];
export type RouteGeometry = Schemas["RouteGeometry"];
export type SimulationStartRequest = Schemas["SimulationStartRequest"];
export type SimulationStartResponse = Schemas["SimulationStartResponse"];
export type ComparisonStartRequest = Schemas["ComparisonStartRequest"];
export type ComparisonStartResponse = Schemas["ComparisonStartResponse"];
export type RouteIntersection = Schemas["RouteIntersection"];
export type SnappedEndpoint = Schemas["SnappedEndpoint"];
export type IntersectionState = Schemas["IntersectionState"];
export type IntersectionTelemetry = Schemas["IntersectionTelemetry"];
export type AmbulanceStatus = Schemas["AmbulanceStatus"];
export type AmbulanceTelemetry = Schemas["AmbulanceTelemetry"];
export type KpiMetrics = Schemas["KpiMetrics"];
export type GreenWaveMode = Schemas["GreenWaveMode"];
export type SignalPhaseIndicator = Schemas["SignalPhaseIndicator"];
export type SignalPhaseColor = Schemas["SignalPhaseColor"];
export type SignalMovementKind = Schemas["SignalMovementKind"];
export type SimulationTickEvent = Schemas["SimulationTickEvent"];
export type ItsDispatchEvent = Schemas["ItsDispatchEvent"];
export type SimulationCompletedEvent = Schemas["SimulationCompletedEvent"];
export type SimulationCancelledEvent = Schemas["SimulationCancelledEvent"];
export type SimulationStreamEvent = Schemas["SimulationStreamEvent"];
export type CancelReason = Schemas["CancelReason"];
export type ErrorCode = Schemas["ErrorCode"];
export type ErrorResponse = Schemas["ErrorResponse"];
export type StopResponse = Schemas["StopResponse"];
export type DatasetQualityResponse = Schemas["DatasetQualityResponse"];
export type QualityCheck = Schemas["QualityCheck"];
export type QualitySource = Schemas["QualitySource"];
export type QualityStatus = Schemas["QualityStatus"];
export type VehicleType = Schemas["VehicleType"];
export type StationSourceKind = Schemas["StationSourceKind"];
export type Station = Schemas["Station"];
export type OnFootLeg = Schemas["OnFootLeg"];
export type StationsResponse = Schemas["StationsResponse"];
export type AddressProvenance = Schemas["AddressProvenance"];
export type GeocodeResult = Schemas["GeocodeResult"];
export type GeocodeResponse = Schemas["GeocodeResponse"];
export type DispatchRankRequest = Schemas["DispatchRankRequest"];
export type DispatchRankResponse = Schemas["DispatchRankResponse"];
export type RankedCandidate = Schemas["RankedCandidate"];

export type ItsFeedbackEvent = Schemas["ItsFeedbackEvent"];
export type ItsRequestSnapshot = Schemas["ItsRequestSnapshot"];
export type ItsScenario = Schemas["ItsScenario"];
