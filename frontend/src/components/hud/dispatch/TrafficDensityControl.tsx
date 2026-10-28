"use client";
import { useTranslation } from "@/components/language-provider";
import type { CSSProperties } from "react";

type TrafficDensityControlProps = {
  value: number;
  onChange: (value: number) => void;
};

export function TrafficDensityControl({ value, onChange }: TrafficDensityControlProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className="mt-5 flex items-center justify-between gap-3">
        <label htmlFor="traffic-density" className="dashboard-label">
          {t("Traffic density multiplier")}
        </label>
        <output htmlFor="traffic-density" className="hud-value text-base font-semibold">
          {t(value.toFixed(1))}
          {t("x")}
        </output>
      </div>
      <input
        id="traffic-density"
        type="range"
        min="1"
        max="3"
        step="0.1"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="hud-range mt-3"
        style={{ "--fill": `${((value - 1) / 2) * 100}%` } as CSSProperties}
      />
      <div className="mt-1 flex justify-between text-2xs text-muted-foreground tabular-nums">
        <span>{t("1.0x normal")}</span>
        <span>{t("3.0x peak")}</span>
      </div>
    </>
  );
}
