"use client";
import { useTranslation } from "@/components/language-provider";
import { useId, useRef } from "react";
import { itsScenarioCaption, itsScenarioLabel, itsScenarioTone } from "@/lib/driver-presentation";
import { ITS_OUTCOME_SEED_MAX, normalizeOutcomeSeed } from "@/lib/start-request";
import type { ItsScenario } from "@/types/telemetry";
const scenarios: ItsScenario[] = ["NOMINAL", "DELAYED", "REJECTED", "NO_FEEDBACK", "MIXED"];
const FORWARD = ["ArrowRight", "ArrowDown"];
const BACK = ["ArrowLeft", "ArrowUp"];

/** Radio-group arrow keys: wrap through the scenarios; other keys are not ours. */
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
  seed = 0,
  onSeedChange = () => {},
}: {
  value: ItsScenario;
  disabled: boolean;
  onChange: (value: ItsScenario) => void;
  /** The MIXED scenario's outcome seed. */
  seed?: number;
  onSeedChange?: (seed: number) => void;
}) {
  const { t } = useTranslation();
  const group = useRef<HTMLDivElement>(null);
  const seedId = useId();
  const shown = disabled ? "NOMINAL" : value;
  return (
    <div className="mt-6">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold">{t("Simulated ITS feedback")}</p>
        {disabled && <span className="text-xs text-muted-foreground">{t("Green Wave off")}</span>}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("How the simulated signal controller answers each priority request.")}
      </p>
      <div
        ref={group}
        role="radiogroup"
        aria-label={t("Simulated ITS feedback")}
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
            className={`its-option pressable ${itsScenarioTone(scenario)}${
              scenario === "MIXED" ? " its-option-wide" : ""
            }`}
          >
            <span className="its-option-title">
              <span className="hud-dot" aria-hidden />
              {t(itsScenarioLabel(scenario))}
            </span>
            <span className="its-option-caption hud-value">{t(itsScenarioCaption(scenario))}</span>
          </button>
        ))}
      </div>
      {shown === "MIXED" && (
        <div className="mt-2">
          <label htmlFor={seedId} className="text-xs font-semibold">
            {t("Outcome seed")}
          </label>
          <input
            id={seedId}
            type="number"
            inputMode="numeric"
            min={0}
            max={ITS_OUTCOME_SEED_MAX}
            step={1}
            value={seed}
            onChange={(event) => onSeedChange(normalizeOutcomeSeed(event.target.valueAsNumber))}
            className="hud-input hud-value mt-1"
            aria-describedby={`${seedId}-hint`}
          />
          <p id={`${seedId}-hint`} className="mt-1 text-2xs text-muted-foreground">
            {t(
              "Each request is accepted, delayed, rejected or left unanswered by this seed and its junctions, so the same seed replays the same outcomes.",
            )}
          </p>
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        {disabled ? (
          t("Standard mode sends no priority requests.")
        ) : (
          <>
            {t("Times count from each priority request in simulated seconds.")}{" "}
            {t(
              "Acceptance starts signal clearing. After a rejection or an 8 s acknowledgement timeout, only those junctions use ordinary signals; the run continues.",
            )}
          </>
        )}
      </p>
    </div>
  );
}
