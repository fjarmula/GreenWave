"use client";
import Link from "next/link";
import { useSimulationState } from "@/components/simulation-provider";
import { ThemeToggle } from "@/components/hud/ThemeToggle";
import { destinations, routeForMode } from "@/lib/workspace-routes";
export function HomeMenu() {
  const { startRequest, simulationState } = useSimulationState();
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12 sm:py-20">
      <header className="flex items-center justify-between">
        <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
          ER–GreenWave / Kraków
        </p>
        <ThemeToggle />
      </header>
      <h1 className="mt-12 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
        A clearer path to the incident.
      </h1>
      <p className="mt-5 max-w-xl text-lg text-muted-foreground">
        Explore simulated emergency response, compare recorded runs and follow the data behind the
        corridor.
      </p>
      {startRequest && (
        <Link
          className="mt-6 inline-block underline"
          href={routeForMode(startRequest.green_wave_mode)}
        >
          Return to {simulationState.toLowerCase()} simulation
        </Link>
      )}
      <div className="mt-12 grid gap-4 sm:grid-cols-3">
        {destinations.slice(1, 4).map((d, i) => (
          <Link
            className="rounded-2xl border border-border p-6 focus-visible:outline-2 focus-visible:outline-emerald-500"
            key={d.href}
            href={d.href}
          >
            <span className="text-sm text-muted-foreground">0{i + 1}</span>
            <h2 className="mt-6 text-xl font-semibold">{d.label}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {
                [
                  "Simulate a priority corridor.",
                  "Use standard signal crossings.",
                  "Record both modes. Replay together.",
                ][i]
              }
            </p>
          </Link>
        ))}
      </div>
      <nav className="mt-8 flex flex-wrap gap-6" aria-label="Tools">
        {destinations.slice(4).map((d) => (
          <Link className="underline underline-offset-4" key={d.href} href={d.href}>
            {d.label}
          </Link>
        ))}
      </nav>
      <p className="mt-16 text-sm text-muted-foreground">
        Simulation only. Signal states and response times do not describe real traffic conditions.
      </p>
    </main>
  );
}
