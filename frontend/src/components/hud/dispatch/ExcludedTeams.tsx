"use client";
import { useTranslation } from "@/components/language-provider";
import { exclusionText } from "@/lib/team-dispatch-copy";
import type { ExcludedTeam, PrmTeam } from "@/types/telemetry";

/** Teams the ranking left out: off shift at the scenario time, or marked busy. */
export function ExcludedTeams({
  excluded,
  teams = [],
}: {
  excluded: ExcludedTeam[];
  teams?: PrmTeam[];
}) {
  const { t } = useTranslation();
  if (!excluded.length) return null;
  const byCode = new Map(teams.map((team) => [team.team_code, team]));
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-2xs font-semibold text-muted-foreground">
        {t("Excluded teams (")}
        {t(excluded.length)}
        {t(")")}
      </summary>
      <ul className="mt-1 space-y-0.5 text-2xs text-muted-foreground">
        {excluded.map((team) => (
          <li key={team.team_code}>
            <span className="font-mono">{t(team.team_code)}</span>
            {t(" —")}
            {t(" ")}
            {t(exclusionText(byCode.get(team.team_code), team.reason))}
          </li>
        ))}
      </ul>
    </details>
  );
}
