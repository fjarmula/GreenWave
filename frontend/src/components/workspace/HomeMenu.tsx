"use client";
import { useTranslation } from "@/components/language-provider";

import Link from "next/link";
import { Activity, ArrowRight, ArrowUpRight, Info, Smartphone } from "lucide-react";
import { useSimulationState } from "@/components/simulation-provider";
import { ThemeToggle } from "@/components/hud/ThemeToggle";
import { HomeBackdrop } from "@/components/workspace/HomeBackdrop";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import {
  ComparisonGlyph,
  GreenWaveGlyph,
  StandardTrafficGlyph,
} from "@/components/workspace/ModeGlyphs";
import { RUN_STATUS_LABELS, runStatusKey } from "@/lib/simulation-copy";
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
  const { t } = useTranslation();
  const { startRequest, simulationState, cancelReason } = useSimulationState();
  return (
    <main className="home-main">
      <HomeBackdrop />
      <div className="home-scrim" aria-hidden />
      <p className="home-corridor-caption">
        <strong>{t("Aleje Trzech Wieszczów")}</strong>
        <span>
          {t(corridor.signals.length)}
          {t(" traffic signals · real geometry")}
        </span>
        <span className="flex gap-3">
          <span className="home-legend">
            <i className="bg-[var(--vehicle)]" />
            {t(" Vehicle")}
          </span>
          <span className="home-legend">
            <i className="bg-[var(--signal-green)]" />
            {t(" Priority green")}
          </span>
        </span>
        <span>{t("Simulated")}</span>
      </p>

      <WorkspaceHeader compact actions={<ThemeToggle />}>
        <p className="home-brand-copy text-sm font-semibold tracking-tight">
          <span className="home-brand-name">{t("ER–GreenWave")}</span>
          <span className="home-brand-city font-normal text-muted-foreground">
            <span className="home-brand-divider" aria-hidden>
              /{" "}
            </span>
            {t("Kraków")}
          </span>
        </p>
      </WorkspaceHeader>

      <div className="home-content">
        <div className="home-hero">
          <section>
            <p className="home-eyebrow">
              <span aria-hidden className="size-1.5 rounded-full bg-go" />
              {t("Emergency corridor simulation")}
            </p>
            <h1 className="home-title">{t("A clearer path to the incident.")}</h1>
            <p className="home-lede">
              {t(
                "Explore simulated emergency response, compare recorded runs and follow the data behind the corridor.",
              )}
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
                {t("Return to simulation")}
                {" · "}
                {t(RUN_STATUS_LABELS[runStatusKey(simulationState, cancelReason)])}
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
                  <span className="home-card-number">
                    {t("0")}
                    {t(i + 1)}
                  </span>
                  <div className="home-card-text">
                    <h2 className="flex items-center gap-1.5 font-semibold tracking-tight">
                      {t(d.label)}
                      <ArrowRight className="home-card-arrow size-4" aria-hidden />
                    </h2>
                    <span className="home-card-copy">{t(copy)}</span>
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="home-foot">
            <nav className="flex flex-wrap gap-2" aria-label={t("Tools")}>
              {destinations.slice(4).map((d, i) => {
                const Icon = TOOL_ICONS[i];
                return (
                  <Link className="home-tool pressable" key={d.href} href={d.href}>
                    <Icon className="size-4 text-muted-foreground" aria-hidden />
                    {t(d.label)}
                    <ArrowUpRight className="size-3.5 text-muted-foreground" aria-hidden />
                  </Link>
                );
              })}
            </nav>
            <p className="home-disclaimer">
              <Info className="size-3.5 shrink-0" aria-hidden />
              <span>
                {t(
                  "Simulation only. Signal states and response times do not describe real traffic conditions. Map data ©",
                )}
                {t(" ")}
                <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">
                  {t("OpenStreetMap contributors")}
                </a>
                {t(" ")}
                {t("(ODbL) · Street registry © City of Kraków (MSIP) ·")}
                {t(" ")}
                <a href="https://carto.com/attributions" target="_blank" rel="noopener">
                  {t("© CARTO")}
                </a>
              </span>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
