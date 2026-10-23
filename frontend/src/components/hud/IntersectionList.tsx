"use client";

import { ItsFeedbackStatus } from "./ItsFeedbackStatus";
import { useState } from "react";
import {
  JsonInspectButton,
  JsonViewer,
  type JsonInspection,
} from "@/components/diagnostics/JsonDetails";
import { ChevronRight, Signal } from "lucide-react";
import { useSimulationState } from "@/components/simulation-provider";
import { isCascadeClearing } from "@/lib/signal-visuals";
import type { IntersectionTelemetry, RouteIntersection } from "@/types/telemetry";

const KIND_LABELS: Record<RouteIntersection["kind"], string> = {
  signalised_junction: "Junction",
  midblock_signal: "Mid-block signal",
  pedestrian_crossing: "Pedestrian crossing",
};

export function IntersectionList() {
  const [selection, setSelection] = useState<JsonInspection | null>(null);
  const { liveTelemetry, routeData, itsRequests, simulationState } = useSimulationState();
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
        key={intersection.id}
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
    <section className="rounded-xl border border-border/80 bg-card/92 p-4 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="dashboard-eyebrow">Corridor monitoring</p>
          <h2 className="mt-1 text-sm font-semibold">
            Route signals <span className="font-normal text-muted-foreground">(TTI)</span>
          </h2>
        </div>
        <Signal className="size-5 text-cyan-600 dark:text-cyan-300" aria-hidden />
      </div>

      <div className="mt-3 space-y-3">
        {!intersections.length && (
          <p className="text-xs text-muted-foreground">Waiting for simulation telemetry.</p>
        )}
        {upcoming.map(card)}
        {passed.length > 0 && (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md py-1 text-[11px] font-semibold text-muted-foreground select-none hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 [&::-webkit-details-marker]:hidden">
              <ChevronRight
                className="size-3.5 transition-transform group-open:rotate-90 motion-reduce:transition-none"
                aria-hidden
              />
              Passed ({passed.length})
            </summary>
            <div className="mt-2 space-y-3">{passed.map(card)}</div>
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
  const { id, name, state, tti_seconds: ttiSeconds, is_active_corridor: active } = intersection;
  const isCascade = isCascadeClearing(intersection);
  const detail = active ? "SIMULATED CORRIDOR ACTIVE" : "ORDINARY TRAFFIC REPORT";

  return (
    <article className="rounded-lg border border-border/70 bg-background/65 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <strong className="block font-mono text-xs">{id}</strong>
          <span className="mt-1 block text-[10px] text-muted-foreground">
            {name ?? routeDetail?.name ?? "Unnamed intersection"}
          </span>
          {routeDetail && (
            <span className="mt-1 block text-[9px] text-muted-foreground">
              {KIND_LABELS[routeDetail.kind]} · {routeDetail.signal_count} signals
            </span>
          )}
          {routeDetail?.needs_review && (
            <span className="mt-1 block text-[9px] font-semibold text-amber-600 dark:text-amber-300">
              Source data flagged for review
            </span>
          )}
        </div>
        <span
          className={`inline-flex items-center gap-1.5 font-mono text-[9px] font-bold ${
            isCascade
              ? "text-violet-600 dark:text-violet-300"
              : active
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-muted-foreground"
          }`}
        >
          <i className="size-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" />
          {state}
          {isCascade && " · CASCADE"}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 font-mono">
        <strong className="text-[11px] text-muted-foreground">
          TTI:{" "}
          <span className="text-foreground">
            {ttiSeconds === null ? "Passed" : `${ttiSeconds}s`}
          </span>
        </strong>
        <span className="text-[9px] text-muted-foreground">{detail}</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
        <span
          className={`block h-full rounded-full shadow-[0_0_8px_currentColor] ${
            isCascade ? "bg-violet-500 text-violet-500" : "bg-emerald-500 text-emerald-500"
          }`}
          style={{ width: `${Math.min(100, Math.max(0, (ttiSeconds ?? 0) * 2.5))}%` }}
        />
      </div>
      {onInspect && (
        <div className="mt-3 border-t border-border/60 pt-2">
          <JsonInspectButton title={id} onClick={onInspect} />
        </div>
      )}
    </article>
  );
}
