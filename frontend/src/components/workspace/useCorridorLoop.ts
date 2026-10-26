"use client";
import { useEffect, useRef } from "react";
import { corridorProgress } from "@/lib/home-corridor";

/**
 * One animation frame loop for the home corridor. Reduced motion draws one still frame; a hidden
 * tab stops the loop until it is visible again.
 */
export function useCorridorLoop(onFrame: (progress: number) => void): void {
  const frame = useRef(onFrame);
  useEffect(() => {
    frame.current = onFrame;
  });
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let id = 0;
    const tick = (time: number) => {
      frame.current(corridorProgress(time, reduced.matches));
      if (!reduced.matches) id = requestAnimationFrame(tick);
    };
    const run = () => {
      cancelAnimationFrame(id);
      if (!document.hidden) id = requestAnimationFrame(tick);
    };
    run();
    document.addEventListener("visibilitychange", run);
    reduced.addEventListener("change", run);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("visibilitychange", run);
      reduced.removeEventListener("change", run);
    };
  }, []);
}
