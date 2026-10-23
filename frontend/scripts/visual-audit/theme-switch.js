// playwright-cli --raw run-code --filename=frontend/scripts/visual-audit/theme-switch.js
// Measures one toggle click in each direction on the home and map routes.
/* eslint-disable @typescript-eslint/no-unused-vars -- the function is evaluated by playwright-cli run-code */
async function themeSwitch(page) {
  const BASE = "http://localhost:3000";
  const results = {};
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const route of ["/", "/simulation/green-wave"]) {
    for (const [from, to] of [
      ["light", "dark"],
      ["dark", "light"],
    ]) {
      await page.goto(BASE + route);
      await page.evaluate((value) => localStorage.setItem("theme", value), from);
      await page.reload();
      await page.waitForTimeout(3000);
      results[`${route} ${from}->${to}`] = await page.evaluate(
        (target) =>
          new Promise((resolve) => {
            const longTasks = [];
            new PerformanceObserver((list) =>
              list.getEntries().forEach((entry) => longTasks.push(Math.round(entry.duration))),
            ).observe({ type: "longtask" });
            const label = target === "dark" ? "Dark theme" : "Light theme";
            const map = document.querySelector("[data-map-theme]");
            let mapThemeMs = null;
            if (map) {
              new MutationObserver(() => {
                if (map.getAttribute("data-map-theme") === target && mapThemeMs === null) {
                  mapThemeMs = Math.round(performance.now() - start);
                }
              }).observe(map, { attributes: true, attributeFilter: ["data-map-theme"] });
            }
            let maxCssTransitions = 0;
            let crossFadeStartMs = null;
            let crossFadeEndMs = null;
            let frames = 0;
            const start = performance.now();
            const sample = () => {
              const animations = document.getAnimations();
              const elapsed = Math.round(performance.now() - start);
              const css = animations.filter(
                (a) => a instanceof CSSTransition && !a.effect?.pseudoElement,
              ).length;
              const crossFade = animations.some((a) =>
                a.effect?.pseudoElement?.startsWith("::view-transition"),
              );
              maxCssTransitions = Math.max(maxCssTransitions, css);
              if (crossFade && crossFadeStartMs === null) crossFadeStartMs = elapsed;
              if (!crossFade && crossFadeStartMs !== null && crossFadeEndMs === null) {
                crossFadeEndMs = elapsed;
              }
              if (++frames < 90) return requestAnimationFrame(sample);
              resolve({
                maxCssTransitions,
                crossFadeStartMs,
                crossFadeEndMs,
                mapThemeMs,
                longTasks,
                themeApplied:
                  document.documentElement.classList.contains("dark") === (target === "dark"),
              });
            };
            document.querySelector(`button[aria-label="${label}"]`).click();
            requestAnimationFrame(sample);
          }),
        to,
      );
    }
  }
  return JSON.stringify(results, null, 1);
}
