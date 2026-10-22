"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const themeOptions = [
  { value: "light", label: "Light theme", icon: Sun },
  { value: "system", label: "System theme", icon: Monitor },
  { value: "dark", label: "Dark theme", icon: Moon },
] as const;

let switchTimer: number | undefined;

/** Cross-fades every surface for one switch only, so normal hovers stay instant. */
function switchThemeSmoothly(apply: () => void) {
  const root = document.documentElement;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return apply();
  root.dataset.themeSwitching = "";
  apply();
  window.clearTimeout(switchTimer);
  switchTimer = window.setTimeout(() => delete root.dataset.themeSwitching, 300);
}

const subscribe = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);

  if (!mounted) {
    return <div aria-hidden className="theme-toggle" />;
  }

  const activeIndex = themeOptions.findIndex((option) => option.value === theme);

  return (
    <div className="theme-toggle" role="group" aria-label="Color theme">
      {activeIndex >= 0 && (
        <span
          aria-hidden
          className="theme-toggle-thumb"
          style={{ transform: `translateX(${activeIndex * 100}%)` }}
        />
      )}
      {themeOptions.map(({ value, label, icon: Icon }) => {
        const isActive = theme === value;

        return (
          <button
            key={value}
            type="button"
            aria-label={label}
            aria-pressed={isActive}
            title={label}
            onClick={() => switchThemeSmoothly(() => setTheme(value))}
            className="theme-toggle-option"
          >
            <Icon className="size-3.5" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
