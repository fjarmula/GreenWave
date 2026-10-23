"use client";
import Link from "next/link";
import type { CSSProperties } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  GitCompareArrows,
  Info,
  Smartphone,
  TrafficCone,
  Waves,
} from "lucide-react";
import { useSimulationState } from "@/components/simulation-provider";
import { ThemeToggle } from "@/components/hud/ThemeToggle";
import { GreenWaveIllustration } from "@/components/workspace/GreenWaveIllustration";
import { destinations, routeForMode } from "@/lib/workspace-routes";

const MODES = [
  { icon: Waves, tone: "home-card-icon--go", copy: "Simulate a priority corridor." },
  { icon: TrafficCone, tone: "home-card-icon--caution", copy: "Use standard signal crossings." },
  {
    icon: GitCompareArrows,
    tone: "home-card-icon--beacon",
    copy: "Record both modes. Replay together.",
  },
];
const TOOL_ICONS = [Activity, Smartphone];

/** Entrance order for the first-load reveal (40ms apart). */
const reveal = (step: number) => ({ "--reveal-step": step }) as CSSProperties;

export function HomeMenu() {
  const { startRequest, simulationState } = useSimulationState();
  return (
    <main className="home-main mx-auto w-full max-w-5xl px-6 py-10 sm:py-16">
      <header className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span aria-hidden className="home-mark" />
          ER–GreenWave
          <span className="font-normal text-muted-foreground">/ Kraków</span>
        </p>
        <ThemeToggle />
      </header>

      <section className="mt-14 sm:mt-20">
        <p className="home-reveal home-eyebrow" style={reveal(0)}>
          <span aria-hidden className="size-1.5 rounded-full bg-go" />
          Emergency corridor simulation
        </p>
        <h1
          className="home-reveal mt-5 max-w-2xl text-4xl font-semibold tracking-[-0.035em] text-balance sm:text-6xl"
          style={reveal(1)}
        >
          A clearer path to the incident.
        </h1>
        <p
          className="home-reveal mt-5 max-w-xl text-lg text-pretty text-muted-foreground"
          style={reveal(2)}
        >
          Explore simulated emergency response, compare recorded runs and follow the data behind the
          corridor.
        </p>
        {startRequest && (
          <Link
            className="home-reveal home-return pressable"
            style={reveal(3)}
            href={routeForMode(startRequest.green_wave_mode)}
          >
            <span
              aria-hidden
              className="home-return-dot"
              data-live={simulationState === "RUNNING" || undefined}
            />
            Return to {simulationState.toLowerCase()} simulation
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        )}
      </section>

      <figure className="home-reveal home-art" style={reveal(3)}>
        <GreenWaveIllustration />
        <figcaption className="home-art-caption">
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="home-legend">
              <i className="bg-emergency" /> Emergency vehicle
            </span>
            <span className="home-legend">
              <i className="bg-go" /> Priority green
            </span>
          </span>
          <span>Signals clear before the vehicle arrives · simulated</span>
        </figcaption>
      </figure>

      <div className="mt-6 grid gap-3 sm:grid-cols-3 sm:gap-4">
        {destinations.slice(1, 4).map((d, i) => {
          const { icon: Icon, tone, copy } = MODES[i];
          return (
            <Link
              className="home-reveal home-card pressable"
              style={reveal(4 + i)}
              key={d.href}
              href={d.href}
            >
              <span className="flex items-center justify-between">
                <span className={`home-card-icon ${tone}`}>
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  0{i + 1}
                </span>
              </span>
              <h2 className="mt-8 flex items-center gap-1.5 text-lg font-semibold tracking-tight">
                {d.label}
                <ArrowRight className="home-card-arrow size-4" aria-hidden />
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground">{copy}</p>
            </Link>
          );
        })}
      </div>

      <nav className="home-reveal mt-6 flex flex-wrap gap-2" style={reveal(7)} aria-label="Tools">
        {destinations.slice(4).map((d, i) => {
          const Icon = TOOL_ICONS[i];
          return (
            <Link className="home-tool pressable" key={d.href} href={d.href}>
              <Icon className="size-4 text-muted-foreground" aria-hidden />
              {d.label}
              <ArrowUpRight className="size-3.5 text-muted-foreground" aria-hidden />
            </Link>
          );
        })}
      </nav>

      <p className="mt-16 flex items-start gap-2 border-t border-border pt-6 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        Simulation only. Signal states and response times do not describe real traffic conditions.
      </p>
    </main>
  );
}
