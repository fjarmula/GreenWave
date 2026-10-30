/* eslint-disable @typescript-eslint/no-unused-expressions -- playwright-cli consumes a function expression */
async page => {
  const base = new URL(page.url()).origin;
  await page.context().addCookies([{ name: "greenwave-language", value: "en", url: base }]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const results = [];
  for (const route of ["green-wave", "standard"]) {
    await page.goto(`${base}/simulation/${route}`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator(".maplibregl-canvas").waitFor();
    await page.locator(".maplibregl-canvas").click({ position: { x: 500, y: 400 } });
    await page.getByRole("status").filter({ hasText: "Planned route" }).waitFor();
    const oldIncident = await page.locator("#incident").inputValue();
    await page.locator(".maplibregl-canvas").click({ position: { x: 600, y: 500 } });
    await page.getByRole("status").filter({ hasText: "Planned route" }).waitFor();
    const newIncident = await page.locator("#incident").inputValue();
    if (oldIncident === newIncident) throw new Error("Incident did not change");
    await page.getByRole("button", { name: "Fire", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Planned route" }).waitFor();
    const passesInput = await page.getByRole("status").filter({ hasText: "Planned route" }).evaluate(label => {
      const r = label.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) !== label;
    });
    if (!passesInput) throw new Error("Preview feedback intercepts map gestures");
    if (await page.locator('[aria-label^="Simulated signal INT-"]').count()) throw new Error("Preview started telemetry");
    if (!(await page.getByTestId("start-corridor").isEnabled())) throw new Error("Start unavailable after preview");
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: `preview-${route}.png` });
    results.push({ route, oldIncident, newIncident, fireSelected: await page.getByRole("button", { name: "Fire", exact: true }).getAttribute("aria-pressed") });
  }
  return results;
}
