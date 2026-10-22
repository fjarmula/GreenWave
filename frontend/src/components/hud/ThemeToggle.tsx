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
    return (
      <div aria-hidden className="h-9 w-[108px] rounded-lg border border-border bg-muted/40" />
    );
  }

  return (
    <div
      className="flex items-center rounded-lg border border-border bg-muted/55 p-1 shadow-sm"
      role="group"
      aria-label="Color theme"
    >
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
            className={`grid size-7 place-items-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 ${
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="size-3.5" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
