import { useRef } from "react";
import { itsScenarioCaption, itsScenarioLabel, itsScenarioTone } from "@/lib/driver-presentation";
import type { ItsScenario } from "@/types/telemetry";
const scenarios: ItsScenario[] = ["NOMINAL", "DELAYED", "REJECTED", "NO_FEEDBACK"];
const FORWARD = ["ArrowRight", "ArrowDown"];
const BACK = ["ArrowLeft", "ArrowUp"];

/** Radio-group arrow keys: wrap through the four scenarios; other keys are not ours. */
export function nextItsScenario(current: ItsScenario, key: string): ItsScenario | null {
  const step = FORWARD.includes(key) ? 1 : BACK.includes(key) ? -1 : 0;
  if (!step) return null;
  const index = scenarios.indexOf(current);
  return scenarios[(index + step + scenarios.length) % scenarios.length];
}

export function ItsScenarioControl({
  value,
  disabled,
  onChange,
}: {
  value: ItsScenario;
  disabled: boolean;
  onChange: (value: ItsScenario) => void;
}) {
  const group = useRef<HTMLDivElement>(null);
  const shown = disabled ? "NOMINAL" : value;
  return (
    <div className="mt-6">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold">Simulated ITS feedback</p>
        {disabled && <span className="text-xs text-muted-foreground">Green Wave off</span>}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        How the simulated signal controller answers each priority request.
      </p>
      <div
        ref={group}
        role="radiogroup"
        aria-label="Simulated ITS feedback"
        className="its-grid mt-2"
        onKeyDown={(event) => {
          const next = nextItsScenario(shown, event.key);
          if (!next || disabled) return;
          event.preventDefault();
          onChange(next);
          requestAnimationFrame(() =>
            group.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus(),
          );
        }}
      >
        {scenarios.map((scenario) => (
          <button
            key={scenario}
            type="button"
            role="radio"
            aria-checked={scenario === shown}
            tabIndex={scenario === shown ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(scenario)}
            className={`its-option pressable ${itsScenarioTone(scenario)}`}
          >
            <span className="its-option-title">
              <span className="hud-dot" aria-hidden />
              {itsScenarioLabel(scenario)}
            </span>
            <span className="its-option-caption hud-value">{itsScenarioCaption(scenario)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
