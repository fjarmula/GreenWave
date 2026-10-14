"use client";

import {
  Activity,
  Ambulance,
  Crosshair,
  Gauge,
  Layers3,
  MapPin,
  Minus,
  Plus,
  Route,
  Settings2,
  Siren,
} from "lucide-react";
import { useState } from "react";

import { DispatchForm } from "@/components/hud/DispatchForm";
import { IntersectionList } from "@/components/hud/IntersectionList";
import { ItsConsole } from "@/components/hud/ItsConsole";
import { KpiHeader } from "@/components/hud/KpiHeader";
import { ThemeToggle } from "@/components/hud/ThemeToggle";

type DashboardMode = "setup" | "live";

export function Dashboard() {
  const [mode, setMode] = useState<DashboardMode>("setup");

  return (
    <main className="flex min-h-dvh min-w-80 flex-col overflow-x-hidden bg-background text-foreground">
      <DashboardHeader mode={mode} onModeChange={setMode} />

      {mode === "setup" ? (
        <section className="grid min-h-0 flex-1 lg:grid-cols-[370px_minmax(0,1fr)]">
          <div className="order-2 lg:order-1">
            <DispatchForm onInitialize={() => setMode("live")} />
          </div>
          <RoutePreview mode="setup" />
        </section>
      ) : (
        <RoutePreview mode="live" />
      )}
    </main>
  );
}

type DashboardHeaderProps = {
  mode: DashboardMode;
  onModeChange: (mode: DashboardMode) => void;
};

function DashboardHeader({ mode, onModeChange }: DashboardHeaderProps) {
  return (
    <header className="z-50 flex flex-wrap items-center gap-3 border-b border-border bg-background/92 px-4 py-3 backdrop-blur-xl sm:px-6 lg:min-h-[76px] lg:flex-nowrap">
      <div className="flex min-w-0 flex-1 items-center gap-3 lg:min-w-[285px] lg:flex-none">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-500 text-emerald-950 shadow-lg shadow-emerald-500/25">
          <Siren className="size-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="dashboard-eyebrow truncate">Kraków Municipal Response Network</p>
          <h1 className="truncate text-lg font-bold tracking-[0.09em]">
            ER<span className="text-emerald-500">-</span>GREENWAVE
          </h1>
        </div>
      </div>

      <nav
        className="order-3 flex w-full rounded-lg border border-border bg-muted/45 p-1 sm:order-none sm:ml-auto sm:w-auto"
        aria-label="Dashboard mode"
      >
        <ModeButton
          active={mode === "setup"}
          onClick={() => onModeChange("setup")}
          icon={Settings2}
        >
          Dispatch setup
        </ModeButton>
        <ModeButton
          active={mode === "live"}
          onClick={() => onModeChange("live")}
          icon={Activity}
          live
        >
          Live operations
        </ModeButton>
      </nav>

      <div className="order-2 sm:order-none">
        <ThemeToggle />
      </div>

      <div className="ml-2 hidden items-center gap-2 text-[11px] text-muted-foreground xl:flex">
        <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]" />
        <span>System ready</span>
        <span className="mx-1 h-4 w-px bg-border" />
        <span className="font-mono">SIMULATION ENVIRONMENT</span>
      </div>
    </header>
  );
}

type ModeButtonProps = {
  active: boolean;
  onClick: () => void;
  icon: typeof Settings2;
  live?: boolean;
  children: React.ReactNode;
};

function ModeButton({ active, onClick, icon: Icon, live = false, children }: ModeButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-h-9 flex-1 items-center justify-center gap-2 rounded-md px-3 text-[11px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 sm:flex-none ${
        active
          ? live
            ? "bg-cyan-500/12 text-cyan-700 shadow-sm dark:text-cyan-300"
            : "bg-emerald-500/12 text-emerald-700 shadow-sm dark:text-emerald-300"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="size-3.5" aria-hidden />
      {children}
    </button>
  );
}

function RoutePreview({ mode }: { mode: DashboardMode }) {
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
      <MapBackdrop live={isLive} />

      {isLive ? (
        <>
          <div className="relative z-20 p-3 sm:p-4 lg:p-6">
            <KpiHeader />
          </div>
          <VehicleTelemetry />
          <div className="absolute top-36 right-6 z-20 hidden w-[330px] lg:block">
            <IntersectionList />
          </div>
          <div className="absolute right-6 bottom-48 z-20 hidden w-[440px] lg:block">
            <ItsConsole />
          </div>
          <div className="relative z-20 mt-[310px] grid gap-3 px-3 pb-3 sm:mt-[360px] sm:grid-cols-2 sm:px-4 lg:hidden">
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
          <RouteMarker
            label="A · UNIVERSITY HOSPITAL"
            className="bottom-[12%] left-[9%] sm:left-[13%]"
          />
          <RouteMarker
            label="B · ŁAZARZA ZRM"
            destination
            className="top-[13%] right-[5%] sm:right-[10%]"
          />
        </>
      )}

      <MapControls />
    </section>
  );
}

function MapBackdrop({ live }: { live: boolean }) {
  return (
    <div className="absolute inset-0" aria-hidden>
      <div className="dashboard-road top-[47%] left-[2%] w-[90%] -rotate-[27deg]" />
      <div className="dashboard-road top-[29%] left-[16%] w-[75%] rotate-[38deg]" />
      <div className="dashboard-road top-[69%] left-[5%] w-[95%] rotate-[7deg]" />
      <div className="dashboard-road top-[53%] left-[40%] w-[58%] -rotate-[63deg]" />

      <span className="dashboard-map-label top-[44%] left-[25%] -rotate-[27deg]">
        ALEJE TRZECH WIESZCZÓW
      </span>
      <span className="dashboard-map-label top-[26%] left-[62%] rotate-[38deg]">CZARNOWIEJSKA</span>
      <span className="dashboard-map-label top-[67%] left-[19%] rotate-[7deg]">REYMONTA</span>
      <span className="dashboard-map-label top-[55%] left-[72%] -rotate-[63deg]">KARMELICKA</span>

      <svg
        className="absolute inset-0 z-[2] size-full"
        viewBox="0 0 1000 800"
        preserveAspectRatio="none"
      >
        <path
          d="M155 690 C260 620 220 520 370 455 S510 370 570 280 S690 250 820 100"
          fill="none"
          stroke="var(--route-shadow)"
          strokeWidth="17"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          className={live ? "dashboard-route-live" : "dashboard-route-planned"}
          d="M155 690 C260 620 220 520 370 455 S510 370 570 280 S690 250 820 100"
          fill="none"
          strokeWidth={live ? 6 : 4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {live && (
        <>
          <div className="dashboard-vehicle left-[37%] top-[57%] -translate-x-1/2 -translate-y-1/2">
            <span className="dashboard-wave" />
            <span className="dashboard-wave [animation-delay:1.1s]" />
            <Ambulance className="size-5" />
          </div>
          <SignalNode className="top-[51%] left-[43%]" label="NORMAL" />
          <SignalNode className="top-[32%] left-[60%]" label="CLEARING" active />
          <SignalNode className="top-[28.5%] left-[70%]" label="CASCADE" cascade />
          <SignalNode className="top-[12.5%] left-[82%]" label="PRIORITY GREEN" active prominent />
        </>
      )}
    </div>
  );
}

function RouteMarker({
  label,
  destination = false,
  className,
}: {
  label: string;
  destination?: boolean;
  className: string;
}) {
  return (
    <div
      className={`absolute z-10 flex items-center gap-2 font-mono text-[9px] font-bold text-foreground drop-shadow-md ${className}`}
    >
      <MapPin
        className={`size-6 ${destination ? "text-emerald-500" : "text-cyan-500"}`}
        aria-hidden
      />
      <span className="hidden rounded bg-background/65 px-1.5 py-1 backdrop-blur sm:block">
        {label}
      </span>
    </div>
  );
}

function SignalNode({
  className,
  label,
  active = false,
  cascade = false,
  prominent = false,
}: {
  className: string;
  label: string;
  active?: boolean;
  cascade?: boolean;
  prominent?: boolean;
}) {
  return (
    <div
      className={`absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 font-mono text-[9px] font-bold text-[var(--map-label)] ${className}`}
    >
      <span
        className={`rounded-full ${prominent ? "size-4" : "size-3"} ${
          cascade
            ? "dashboard-signal-pulse bg-violet-500 shadow-[0_0_14px_rgb(139,92,246)]"
            : active
              ? "dashboard-signal-pulse bg-emerald-500 shadow-[0_0_14px_rgb(16,185,129)]"
              : "bg-red-500/70"
        }`}
      />
      <b className="hidden sm:block">{label}</b>
    </div>
  );
}

function VehicleTelemetry() {
  return (
    <div className="absolute top-36 left-6 z-20 hidden w-[292px] space-y-3 lg:block">
      <div className="flex gap-3 rounded-xl border border-border/80 bg-card/88 p-4 shadow-xl backdrop-blur-xl">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-cyan-500/12 text-cyan-600 dark:text-cyan-300">
          <Ambulance className="size-5" aria-hidden />
        </div>
        <div>
          <p className="dashboard-eyebrow">Priority vehicle</p>
          <h2 className="mt-1 font-mono text-sm font-bold">AMB-KRA-01</h2>
          <p className="mt-1 text-[10px] text-muted-foreground">
            University Hospital → Łazarza ZRM
          </p>
        </div>
      </div>
      <div className="rounded-xl border border-border/80 bg-card/88 p-4 shadow-xl backdrop-blur-xl">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Vehicle telemetry</span>
          <Gauge className="size-4 text-cyan-600 dark:text-cyan-300" aria-hidden />
        </div>
        <div className="mt-4 flex items-end gap-2">
          <strong className="font-mono text-2xl">62.4</strong>
          <span className="mb-1 text-[10px] text-muted-foreground">km/h</span>
          <b className="mb-1 ml-auto font-mono text-[10px] text-emerald-600 dark:text-emerald-400">
            +4.2%
          </b>
        </div>
        <div className="mt-2 h-1 rounded-full bg-muted">
          <span className="block h-full w-[72%] rounded-full bg-cyan-500" />
        </div>
        <div className="mt-3 flex justify-between font-mono text-[9px] text-muted-foreground">
          <span>HEADING · NE 042°</span>
          <span>GPS · FIXED</span>
        </div>
      </div>
    </div>
  );
}

function MapControls() {
  return (
    <div className="absolute right-3 bottom-3 z-30 hidden flex-col gap-1 sm:flex lg:right-6 lg:bottom-6">
      <MapControl label="Center route" icon={Crosshair} />
      <MapControl label="Map layers" icon={Layers3} />
      <div className="overflow-hidden rounded-lg border border-border shadow-lg">
        <MapControl label="Zoom in" icon={Plus} grouped />
        <MapControl label="Zoom out" icon={Minus} grouped />
      </div>
    </div>
  );
}

function MapControl({
  label,
  icon: Icon,
  grouped = false,
}: {
  label: string;
  icon: typeof Crosshair;
  grouped?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`grid size-9 place-items-center border border-border bg-card/90 text-muted-foreground shadow-lg backdrop-blur transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 ${
        grouped ? "border-0 border-b last:border-b-0" : "rounded-lg"
      }`}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}
