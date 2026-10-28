"use client";
import { useTranslation } from "@/components/language-provider";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore, type CSSProperties } from "react";
import { flushSync } from "react-dom";

import { transitionTheme, type ResolvedTheme } from "@/lib/theme-transition";

const themeOptions = [
  { value: "light", label: "Light theme", icon: Sun },
  { value: "system", label: "System theme", icon: Monitor },
  { value: "dark", label: "Dark theme", icon: Moon },
] as const;

type ThemeChoice = (typeof themeOptions)[number]["value"];

export function resolveThemeChoice(choice: ThemeChoice, prefersDark: boolean): ResolvedTheme {
  if (choice === "system") return prefersDark ? "dark" : "light";
  return choice;
}

/** The thumb has its own view-transition name, so it slides while the page cross-fades. */
export function themeThumbStyle(index: number): CSSProperties {
  return { viewTransitionName: "theme-thumb", transform: `translateX(${index * 100}%)` };
}

const subscribe = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);

  if (!mounted) {
    return <div aria-hidden className="theme-toggle" />;
  }

  const activeIndex = themeOptions.findIndex((option) => option.value === theme);

  return (
    <div className="theme-toggle" role="group" aria-label={t("Color theme")}>
      {activeIndex >= 0 && (
        <span aria-hidden className="theme-toggle-thumb" style={themeThumbStyle(activeIndex)} />
      )}
      {themeOptions.map(({ value, label, icon: Icon }) => {
        const isActive = theme === value;

        return (
          <button
            key={value}
            type="button"
            aria-label={t(label)}
            aria-pressed={isActive}
            title={t(label)}
            onClick={() => {
              const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
              void transitionTheme(
                () => flushSync(() => setTheme(value)),
                resolveThemeChoice(value, prefersDark),
              );
            }}
            className="theme-toggle-option"
          >
            <Icon className="size-3.5" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
