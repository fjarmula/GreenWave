/* eslint-disable @typescript-eslint/no-unused-expressions -- playwright-cli consumes a function expression */
async (page) => {
  const base = new URL(page.url()).origin;
  await page.context().addCookies([{ name: "greenwave-language", value: "en", url: base }]);
  await page.goto(base + "/simulation/green-wave");
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: /Initialize green corridor/ }).waitFor();
  await page.locator(".maplibregl-canvas").click({ position: { x: 500, y: 400 } });
  await page.getByRole("status").filter({ hasText: "Planned route" }).waitFor();
  assert(await page.locator('[aria-label^="Simulated signal INT-"]').count() === 0, "Preview started signal telemetry");
  await page.getByRole("button", { name: /Initialize green corridor/ }).click();
  await page.getByRole("status").filter({ hasText: "Simulation stream: Live" }).waitFor();
  assert(await page.getByText("Planned route", { exact: true }).count() === 0, "Preview remains during playback");
  const results = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 1024, height: 600 }]) {
    await page.setViewportSize(viewport);
    const measurement = await page.evaluate(() => {
      const inspector = document.querySelector("aside.workspace-inspector");
      const panels = [...inspector.querySelectorAll("section.hud-panel")].filter(p => /Route signals|ITS gateway audit log/.test(p.textContent));
      if (panels.length !== 2) throw new Error("Missing monitoring panels");
      const bodies = panels.map(p => p.querySelector(".monitor-panel-body") ?? p.lastElementChild);
      for (const body of bodies) {
        if (!body.querySelector("[data-stress]")) for (let i = 0; i < 40; i++) {
          const row = document.createElement("p"); row.dataset.stress = "true"; row.textContent = `Long monitoring entry ${i}`; row.style.padding = "12px"; body.append(row);
        }
      }
      const before = bodies.map(b => b.scrollTop);
      const headerPositions = panels.map(p => p.firstElementChild.getBoundingClientRect().top);
      bodies[0].scrollTop = 120;
      const firstIndependent = bodies[0].scrollTop > 0 && bodies[1].scrollTop === before[1];
      const firstScroll = bodies[0].scrollTop;
      bodies[1].scrollTop = 120;
      const secondIndependent = bodies[1].scrollTop > 0 && bodies[0].scrollTop === firstScroll;
      const headersFixed = panels.every((p, i) => p.firstElementChild.getBoundingClientRect().top === headerPositions[i]);
      return {
        firstIndependent, secondIndependent, headersFixed,
        bounded: panels.every(p => p.getBoundingClientRect().bottom <= inspector.getBoundingClientRect().bottom + 1),
        inspectorOverflow: inspector.scrollHeight - inspector.clientHeight,
        horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
        heights: bodies.map(b => b.clientHeight),
      };
    });
    assert(measurement.firstIndependent && measurement.secondIndependent, `Scrolling not independent: ${JSON.stringify(measurement)}`);
    assert(measurement.headersFixed && measurement.bounded, `Panels unbounded: ${JSON.stringify(measurement)}`);
    assert(measurement.inspectorOverflow <= 1 && measurement.horizontalOverflow <= 0, `Outer overflow: ${JSON.stringify(measurement)}`);
    assert(await page.getByTestId("stop-simulation").first().isVisible(), "Stop inaccessible");
    results.push({ viewport, ...measurement });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Show more", exact: true }).click();
  await page.locator('.bottom-sheet[data-snap="expanded"]').waitFor();
  const phonePanels = page.locator(".bottom-sheet .monitor-panel");
  assert(await phonePanels.count() === 2, "Phone monitoring panels missing");
  const phoneMeasurements = await phonePanels.evaluateAll(panels => panels.map(panel => {
    const body = panel.querySelector(".monitor-panel-body");
    for (let i = 0; i < 30; i++) {
      const row = document.createElement("p"); row.textContent = `Phone entry ${i}`; row.style.padding = "12px"; body.append(row);
    }
    const headingTop = panel.firstElementChild.getBoundingClientRect().top;
    body.scrollTop = 100;
    return { bounded: panel.clientHeight <= innerHeight * 0.45 + 1, scrolled: body.scrollTop > 0, headingFixed: panel.firstElementChild.getBoundingClientRect().top === headingTop };
  }));
  assert(phoneMeasurements.every(p => p.bounded && p.scrolled && p.headingFixed), `Phone panels unusable: ${JSON.stringify(phoneMeasurements)}`);
  assert(await page.getByTestId("stop-simulation").first().isVisible(), "Phone Stop inaccessible");
  results.push({ viewport: { width: 390, height: 844 }, phoneMeasurements });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Phone horizontal overflow");
  return JSON.stringify(results);
}
