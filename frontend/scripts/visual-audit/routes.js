// playwright-cli --raw run-code --filename=frontend/scripts/visual-audit/routes.js
// Screens every route in light/dark on desktop and phone into .tmp/playwright/visual/.
/* eslint-disable @typescript-eslint/no-unused-vars -- the function is evaluated by playwright-cli run-code */
async function routes(page) {
  const BASE = "http://localhost:3000";
  const ROUTES = ["/", "/simulation/green-wave", "/compare", "/diagnostics", "/driver"];
  const VIEWPORTS = [
    { width: 1440, height: 900, tag: "desktop" },
    { width: 390, height: 844, tag: "phone" },
  ];
  const report = [];
  for (const { width, height, tag } of VIEWPORTS) {
    await page.setViewportSize({ width, height });
    for (const theme of ["light", "dark"]) {
      for (const route of ROUTES) {
        await page.goto(BASE + route);
        await page.evaluate((value) => localStorage.setItem("theme", value), theme);
        await page.reload();
        await page.waitForTimeout(1800);
        const name = `${tag}-${theme}${route === "/" ? "-home" : route.replace(/\//g, "-")}`;
        await page.screenshot({ path: `.tmp/playwright/visual/${name}.png` });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        );
        report.push(`${name}${overflow ? "  HORIZONTAL OVERFLOW" : ""}`);
      }
    }
  }
  return report.join("\n");
}
