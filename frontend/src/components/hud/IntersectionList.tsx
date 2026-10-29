"use client";
import { useTranslation } from "@/components/language-provider";

import { ItsFeedbackStatus } from "./ItsFeedbackStatus";
import { useState, type CSSProperties } from "react";
import {
  JsonInspectButton,
  JsonViewer,
  type JsonInspection,
} from "@/components/diagnostics/JsonDetails";
import { ChevronRight, Signal } from "lucide-react";
import { useSimulationState } from "@/components/simulation-provider";
import { tickIntervalMilliseconds } from "@/lib/playback-speed";
import { isCascadeClearing } from "@/lib/signal-visuals";
import type { IntersectionTelemetry, RouteIntersection } from "@/types/telemetry";

const KIND_LABELS: Record<RouteIntersection["kind"], string> = {
  signalised_junction: "Junction",
  midblock_signal: "Mid-block signal",
  pedestrian_crossing: "Pedestrian crossing",
};

export function IntersectionList() {
  const { t } = useTranslation();
  const [selection, setSelection] = useState<JsonInspection | null>(null);
  const { liveTelemetry, routeData, startRequest, itsRequests, simulationState } =
    useSimulationState();
  // TTI bars glide between ticks, so their transition lasts exactly one tick.
  const tick = { "--tick": `${tickIntervalMilliseconds(startRequest?.playback_speed ?? 1)}ms` };
  const intersections = liveTelemetry?.intersections ?? [];
  const routeIntersections = new Map(
    (routeData?.route_intersections ?? []).map((intersection) => [intersection.id, intersection]),
  );
  const { upcoming, passed } = splitByPassage(intersections, routeIntersections);
  const card = (intersection: IntersectionTelemetry) => (
    <div key={intersection.id}>
      <ItsFeedbackStatus
        request={itsRequests?.find((r) => r.intersections_group.includes(intersection.id))}
        state={intersection.state}
        observedAt={liveTelemetry?.its_observed_at_simulated_sec}
        ended={simulationState !== "RUNNING"}
      />
      <IntersectionCard
        telemetry={intersection}
        onInspect={
          liveTelemetry
            ? () =>
                setSelection({
                  title: intersection.id,
                  description: `Full validated simulation tick ${liveTelemetry.tick} containing ${intersection.id}. This is received telemetry, not an outgoing controller command.`,
                  capture: {
                    method: "GET",
                    path: "/api/v1/simulation/" + liveTelemetry.simulation_id + "/stream",
                    eventType: "SIMULATION_TICK",
                    validation: "accepted",
                    responseBody: JSON.stringify(liveTelemetry),
                  },
                })
            : undefined
        }
        detail={routeIntersections.get(intersection.id)}
      />
    </div>
  );
  return (
    <section className="hud-panel" style={tick as CSSProperties}>
      <div className="hud-head">
        <div>
          <p className="dashboard-eyebrow">{t("Corridor monitoring")}</p>
          <h2 className="hud-title">
            {t("Route signals ")}
            <span className="font-normal text-muted-foreground">{t("(TTI)")}</span>
          </h2>
        </div>
        <span className="hud-icon tone-beacon">
          <Signal aria-hidden />
        </span>
      </div>

      <div className="mt-3 space-y-3">
        {!intersections.length && (
          <p className="text-xs text-muted-foreground">{t("Waiting for simulation telemetry.")}</p>
        )}
        {t(upcoming.map(card))}
        {passed.length > 0 && (
          <details className="group">
            <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-md text-xs font-semibold text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
              <ChevronRight
                className="size-3.5 transition-transform duration-200 ease-out group-open:rotate-90 motion-reduce:transition-none"
                aria-hidden
              />
              {t("Passed (")}
              {t(passed.length)}
              {t(")")}
            </summary>
            <div className="mt-2 space-y-3">{t(passed.map(card))}</div>
          </details>
        )}
      </div>
      <JsonViewer selection={selection} onClose={() => setSelection(null)} />
    </section>
  );
}

/**
 * The next signal leads: upcoming ones in route order, then the passed ones (no TTI left).
 * Route order comes from the start response; ticks without it keep their own order.
 */
function splitByPassage(
  intersections: IntersectionTelemetry[],
  routeIntersections: Map<string, RouteIntersection>,
) {
  const distance = (intersection: IntersectionTelemetry) =>
    routeIntersections.get(intersection.id)?.distance_along_route_m ?? Number.POSITIVE_INFINITY;
  const inRouteOrder = intersections
    .map((intersection, index) => ({ intersection, index }))
    .sort((a, b) => distance(a.intersection) - distance(b.intersection) || a.index - b.index)
    .map(({ intersection }) => intersection);
  return {
    upcoming: inRouteOrder.filter((intersection) => intersection.tti_seconds !== null),
    passed: inRouteOrder.filter((intersection) => intersection.tti_seconds === null),
  };
}

function IntersectionCard({
  telemetry: intersection,
  onInspect,
  detail: routeDetail,
}: {
  telemetry: IntersectionTelemetry;
  onInspect?: () => void;
  detail: RouteIntersection | undefined;
}) {
  const { t } = useTranslation();
  const { id, name, state, tti_seconds: ttiSeconds, is_active_corridor: active } = intersection;
  const isCascade = isCascadeClearing(intersection);
  const fallback = intersection.crossing_strategy === "STANDARD_FALLBACK";
  // Ordinary green is never shown as granted priority: a fallback junction says so.
  const detail = active
    ? "SIMULATED CORRIDOR ACTIVE"
    : fallback
      ? "STANDARD FALLBACK · ORDINARY SIGNALS"
      : "ORDINARY TRAFFIC REPORT";

  return (
    <article className="intersection-card">
      {/* A long state chip drops below the name instead of squeezing it on narrow panels. */}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-[min(9rem,100%)] flex-1">
          <strong className="hud-value block text-xs font-semibold">{t(id)}</strong>
          <span className="mt-1 block text-xs text-muted-foreground">
            {t(name ?? routeDetail?.name ?? "Unnamed intersection")}
          </span>
          {routeDetail && (
            <span className="mt-0.5 block text-2xs text-muted-foreground">
              {t(KIND_LABELS[routeDetail.kind])}
              {t(" · ")}
              {t(routeDetail.signal_count)}
              {t(" signals")}
            </span>
          )}
          {routeDetail?.needs_review && (
            <span className="mt-1 block text-2xs font-semibold text-caution">
              {t("Source data flagged for review")}
            </span>
          )}
        </div>
        <span
          className={`hud-chip hud-value shrink-0 text-2xs ${
            isCascade ? "tone-cascade" : active ? "tone-go" : fallback ? "tone-caution" : ""
          }`}
        >
          <i className="hud-dot shadow-[0_0_8px_currentColor]" />
          {t(state)}
          {t(isCascade && " · CASCADE")}
          {t(fallback && " · FALLBACK")}
        </span>
      </div>
      <div className="hud-value mt-3 flex flex-wrap items-center justify-between gap-2">
        <strong className="text-xs font-medium text-muted-foreground">
          {t("TTI")}
          {t(" ")}
          <span className="text-sm font-semibold text-foreground">
            {t(ttiSeconds === null ? "Passed" : `${ttiSeconds}s`)}
          </span>
        </strong>
        <span className="text-2xs text-muted-foreground">{t(detail)}</span>
      </div>
      <div className="intersection-tti">
        <span
          className={isCascade ? "bg-cascade" : "bg-go"}
          style={{
            transform: `scaleX(${Math.min(100, Math.max(0, (ttiSeconds ?? 0) * 2.5)) / 100})`,
          }}
        />
      </div>
      {onInspect && (
        <div className="mt-2 flex justify-end">
          <JsonInspectButton title={t(id)} onClick={onInspect} />
        </div>
      )}
    </article>
  );
}
