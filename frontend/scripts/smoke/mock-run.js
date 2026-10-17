/* eslint-disable @typescript-eslint/no-unused-expressions -- playwright-cli run-code takes a bare function expression */
// Phase 1 of the mock-transport smoke (playwright-cli run-code). Starts a 10× run
// and checks that live telemetry, a simulated ITS dispatch, real-position signal
// markers and the data attribution appear. Returns a JSON summary.
async (page) => {
  const result = {};
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: /Initialize green corridor/ }).waitFor();
  result.setupHasMockNote = await page
    .getByText("Demo uses synthetic route estimates and sample signal telemetry.")
    .isVisible();
  await page.getByRole("radio", { name: "10×" }).click();
  await page.getByRole("button", { name: /Initialize green corridor/ }).click();

  await page.getByRole("status").filter({ hasText: "Simulation stream: Live" }).waitFor({ timeout: 10_000 });
  result.connectionBadge = await page.getByRole("status").filter({ hasText: "Simulation stream:" }).first().textContent();
  await page.getByText(/TICK · [3-9]/).waitFor({ timeout: 10_000 });
  result.tickText = await page.getByText(/TICK · \d+/).textContent();

  const dispatch = page
    .getByText("Simulated FORCE_GREEN_PHASE → INT-0360, INT-0366", { exact: false })
    .first();
  await dispatch.waitFor({ timeout: 20_000 });
  result.itsEntry = await dispatch.textContent();

  result.signalMarkers = await page
    .locator('[aria-label^="Simulated signal INT-"]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label")));
  result.cascadeSeen = await page.getByText("· CASCADE").first().isVisible();
  result.attribution = await page.locator(".maplibregl-ctrl-attrib").first().textContent();
  result.simulatedLabels = await page.getByText("SIMULATED CORRIDOR ACTIVE").count();
  return JSON.stringify(result, null, 2);
}
