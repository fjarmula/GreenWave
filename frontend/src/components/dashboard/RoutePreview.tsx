"use client";

import { Route } from "lucide-react";
import type { ComponentProps } from "react";

import type { DashboardMode } from "@/components/dashboard/DashboardHeader";
import { VehicleTelemetry } from "@/components/dashboard/VehicleTelemetry";
import { IntersectionList } from "@/components/hud/IntersectionList";
import { ItsConsole } from "@/components/hud/ItsConsole";
import { KpiHeader } from "@/components/hud/KpiHeader";
import { RunSummary } from "@/components/hud/RunSummary";
import type { MapEndpoint } from "@/components/map/EndpointMarkers";
import { MapContainer } from "@/components/map/MapContainer";

export function RoutePreview({
  mode,
  origin,
  destination,
  mapFocusRequest,
  onBackToSetup,
  map: mapProps,
}: {
  mode: DashboardMode;
  origin: MapEndpoint | null;
  destination: MapEndpoint | null;
  mapFocusRequest: number;
  onBackToSetup?: () => void;
  /** Station layer and map-click inputs, passed through to the map. */
  map: Pick<
    ComponentProps<typeof MapContainer>,
    "stations" | "selectedVehicleType" | "chosenStationId" | "runnerUpIds" | "onMapClick"
  >;
}) {
  const isLive = mode === "live";

  return (
    <section
      className={`dashboard-map relative isolate order-1 overflow-hidden lg:order-2 ${
        isLive
          ? "min-h-[calc(100dvh-126px)] sm:min-h-[calc(100dvh-76px)]"
          : "min-h-[54dvh] lg:min-h-[690px]"
      }`}
      aria-label={isLive ? "Live corridor route preview" : "Planned corridor route preview"}
    >
      <div
        className={
          isLive ? "absolute inset-x-0 top-0 h-[560px] sm:h-[620px] lg:h-full" : "absolute inset-0"
        }
      >
        <MapContainer
          live={isLive}
          origin={origin}
          destination={destination}
          focusRequest={mapFocusRequest}
          {...mapProps}
        />
      </div>

      {isLive ? (
        <>
          <div className="relative z-20 p-3 sm:p-4 lg:p-6">
            <KpiHeader />
          </div>
          <VehicleTelemetry />
          <div className="absolute top-36 right-6 bottom-28 z-20 hidden w-[440px] space-y-3 overflow-y-auto lg:block">
            <div className="ml-auto w-[330px] space-y-3">
              {onBackToSetup && <RunSummary onBackToSetup={onBackToSetup} />}
              <IntersectionList />
            </div>
            <ItsConsole />
          </div>
          <div className="relative z-20 mt-[420px] grid gap-3 px-3 pb-3 sm:mt-[550px] sm:grid-cols-2 sm:px-4 lg:hidden">
            {onBackToSetup && (
              <div className="sm:col-span-2">
                <RunSummary onBackToSetup={onBackToSetup} />
              </div>
            )}
            <IntersectionList />
            <ItsConsole />
          </div>
        </>
      ) : (
        <>
          <div className="absolute top-4 left-4 z-20 flex items-center gap-3 rounded-xl border border-border/80 bg-card/88 px-4 py-3 shadow-xl backdrop-blur-xl sm:top-6 sm:left-6">
            <Route className="size-5 text-cyan-600 dark:text-cyan-300" aria-hidden />
            <div>
              <p className="dashboard-eyebrow">Planned response corridor</p>
              <strong className="mt-1 block font-mono text-xs">KRK-ROUTE-0942</strong>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
