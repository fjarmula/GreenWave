"use client";
import Link from "next/link";
import { Activity, ArrowRight, ArrowUpRight, Info, Smartphone } from "lucide-react";
import { useSimulationState } from "@/components/simulation-provider";
import { ThemeToggle } from "@/components/hud/ThemeToggle";
import { HomeBackdrop } from "@/components/workspace/HomeBackdrop";
import { GreenWaveMark } from "@/components/workspace/GreenWaveMark";
import {
  ComparisonGlyph,
  GreenWaveGlyph,
  StandardTrafficGlyph,
} from "@/components/workspace/ModeGlyphs";
import { corridor } from "@/lib/home-corridor";
import { destinations, routeForMode } from "@/lib/workspace-routes";

const MODES = [
  { icon: GreenWaveGlyph, tone: "home-card-icon--go", copy: "Simulate a priority corridor." },
  {
    icon: StandardTrafficGlyph,
    tone: "home-card-icon--caution",
    copy: "Use standard signal crossings.",
  },
  {
    icon: ComparisonGlyph,
    tone: "home-card-icon--beacon",
    copy: "Record both modes. Replay together.",
  },
];
const TOOL_ICONS = [Activity, Smartphone];

export function HomeMenu() {
  const { startRequest, simulationState } = useSimulationState();
  return (
    <main className="home-main">
      <HomeBackdrop />
      <div className="home-scrim" aria-hidden />
      <p className="home-corridor-caption">
        <strong>Aleje Trzech Wieszczów</strong>
        <span>{corridor.signals.length} traffic signals · real geometry</span>
        <span className="flex gap-3">
          <span className="home-legend">
            <i className="bg-[var(--signal-red)]" /> Vehicle
          </span>
          <span className="home-legend">
            <i className="bg-[var(--signal-green)]" /> Priority green
          </span>
        </span>
        <span>Simulated</span>
      </p>

      <div className="home-content">
        <div className="home-header">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <GreenWaveMark className="size-6" />
              ER–GreenWave
              <span className="font-normal text-muted-foreground">/ Kraków</span>
            </p>
            <ThemeToggle />
          </header>
        </div>

        <div className="home-hero">
          <section>
            <p className="home-eyebrow">
              <span aria-hidden className="size-1.5 rounded-full bg-go" />
              Emergency corridor simulation
            </p>
            <h1 className="home-title">A clearer path to the incident.</h1>
            <p className="home-lede">
              Explore simulated emergency response, compare recorded runs and follow the data behind
              the corridor.
            </p>
            {startRequest && (
              <Link
                className="home-return pressable"
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
        </div>

        <div className="home-bottom">
          <div className="home-cards">
            {destinations.slice(1, 4).map((d, i) => {
              const { icon: Icon, tone, copy } = MODES[i];
              return (
                <Link className="home-card pressable" key={d.href} href={d.href}>
                  <span className={`home-card-icon ${tone}`}>
                    <Icon className="size-[18px]" />
                  </span>
                  <span className="home-card-number">0{i + 1}</span>
                  <div className="home-card-text">
                    <h2 className="flex items-center gap-1.5 font-semibold tracking-tight">
                      {d.label}
                      <ArrowRight className="home-card-arrow size-4" aria-hidden />
                    </h2>
                    <span className="home-card-copy">{copy}</span>
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="home-foot">
            <nav className="flex flex-wrap gap-2" aria-label="Tools">
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
            <p className="home-disclaimer">
              <Info className="size-3.5 shrink-0" aria-hidden />
              <span>
                Simulation only. Signal states and response times do not describe real traffic
                conditions. Map data ©{" "}
                <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">
                  OpenStreetMap contributors
                </a>{" "}
                (ODbL) · Street registry © City of Kraków (MSIP) ·{" "}
                <a href="https://carto.com/attributions" target="_blank" rel="noopener">
                  © CARTO
                </a>
              </span>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
