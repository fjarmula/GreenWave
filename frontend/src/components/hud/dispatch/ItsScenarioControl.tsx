import type { ItsScenario } from "@/types/telemetry";
const scenarios: ItsScenario[] = ["NOMINAL", "DELAYED", "REJECTED", "NO_FEEDBACK"];
export function ItsScenarioControl({
  value,
  disabled,
  onChange,
}: {
  value: ItsScenario;
  disabled: boolean;
  onChange: (value: ItsScenario) => void;
}) {
  return (
    <label className="mt-4 block text-xs font-medium">
      Simulated ITS feedback
      <select
        aria-label="Simulated ITS feedback"
        className="mt-2 min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-cyan-500 disabled:opacity-60"
        value={disabled ? "NOMINAL" : value}
        disabled={disabled}
        onChange={(e) => {
          const value = scenarios.find((s) => s === e.target.value);
          if (value) onChange(value);
        }}
      >
        <option value="NOMINAL">Nominal · accept after 1 s</option>
        <option value="DELAYED">Delayed · accept after 5 s</option>
        <option value="REJECTED">Rejected · decline request</option>
        <option value="NO_FEEDBACK">No feedback · timeout after 8 s</option>
      </select>
    </label>
  );
}
