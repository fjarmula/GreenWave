import { hoursText } from "@/lib/team-dispatch-copy";
import type { TeamAvailability } from "@/lib/useIncidentDispatch";
import type { PrmTeam, ResourcesResponse } from "@/types/telemetry";

type TeamAvailabilityPanelProps = {
  resources: ResourcesResponse | null;
  availability: Record<string, "free" | "busy">;
  onChange: (teamCode: string, value: TeamAvailability) => void;
};

const LABELS: Record<TeamAvailability, string> = {
  unknown: "Unknown",
  free: "Free",
  busy: "Busy",
};
const TONES: Record<TeamAvailability, string> = {
  unknown: "tone-muted",
  free: "tone-go",
  busy: "tone-emergency",
};

/** The tri-state toggle's next value: unknown → free → busy → unknown. */
export function nextAvailability(value: TeamAvailability): TeamAvailability {
  return value === "unknown" ? "free" : value === "free" ? "busy" : "unknown";
}

/** Teams grouped by base, in the roster's team-code order within a base. */
function byBase(teams: PrmTeam[]): [string, PrmTeam[]][] {
  const groups = new Map<string, PrmTeam[]>();
  for (const team of teams)
    groups.set(team.base_address, [...(groups.get(team.base_address) ?? []), team]);
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "pl"));
}

/**
 * Simulated availability per PRM team (ADR 0014). Hook-free, so tests can walk its tree. An
 * off-shift team cannot be set: the published schedule wins over any override.
 */
export function TeamAvailabilityPanel({
  resources,
  availability,
  onChange,
}: TeamAvailabilityPanelProps) {
  if (!resources) return null;
  return (
    <details className="mt-4 rounded-xl border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="dashboard-eyebrow">Team availability</span>
        <span className="hud-chip tone-caution text-2xs">Simulated</span>
      </summary>
      <div className="space-y-3 px-4 pb-4">
        {byBase(resources.teams).map(([base, teams]) => (
          <section key={base}>
            <h3 className="truncate text-2xs font-semibold text-muted-foreground" title={base}>
              {base}
            </h3>
            <ul className="mt-1 space-y-1">
              {teams.map((team) => {
                const value: TeamAvailability = availability[team.team_code] ?? "unknown";
                return (
                  <li key={team.team_code} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 text-xs">
                      <span className="font-mono font-medium">{team.team_code}</span>
                      <span className="hud-chip tone-muted text-2xs">{team.team_type}</span>
                      <span className="text-2xs text-muted-foreground">{hoursText(team)}</span>
                    </span>
                    {team.on_shift ? (
                      <button
                        type="button"
                        data-team-code={team.team_code}
                        aria-label={`${team.team_code} status: ${LABELS[value]}`}
                        onClick={() => onChange(team.team_code, nextAvailability(value))}
                        className={`hud-chip ${TONES[value]} shrink-0 cursor-pointer text-2xs`}
                      >
                        {LABELS[value]}
                      </button>
                    ) : (
                      <button
                        type="button"
                        data-team-code={team.team_code}
                        disabled
                        className="hud-chip tone-muted shrink-0 text-2xs opacity-60"
                      >
                        off shift
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
}
