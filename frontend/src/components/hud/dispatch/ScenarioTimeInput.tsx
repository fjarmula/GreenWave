"use client";
import { useTranslation } from "@/components/language-provider";
type ScenarioTimeInputProps = {
  /** Local "YYYY-MM-DDTHH:MM". */
  value: string;
  onChange: (value: string) => void;
};

/** The scenario's local time: which PRM teams the published schedule has on shift. */
export function ScenarioTimeInput({ value, onChange }: ScenarioTimeInputProps) {
  const { t } = useTranslation();
  return (
    <div>
      <label htmlFor="scenario-time" className="dashboard-label">
        {t("Scenario time")}
      </label>
      <input
        id="scenario-time"
        type="datetime-local"
        step={300}
        value={value}
        onChange={(event) => {
          if (event.target.value) onChange(event.target.value);
        }}
        className="hud-input mt-2"
      />
      <p className="mt-1 text-2xs text-muted-foreground">
        {t("Shifts follow the published PRM schedule; team status is simulated.")}
      </p>
    </div>
  );
}
