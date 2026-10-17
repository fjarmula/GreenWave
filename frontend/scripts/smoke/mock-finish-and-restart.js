/* eslint-disable @typescript-eslint/no-unused-expressions -- playwright-cli run-code takes a bare function expression */
// Phase 2 of the mock-transport smoke (playwright-cli run-code). Waits for
// SIMULATION_COMPLETED, reads the run summary, returns to setup, then does a
// rapid start → back → start and checks the second run starts from a clean slate.
async (page) => {
  const result = {};
  const summary = page.getByRole("status").filter({ hasText: "Simulated run completed" });
  await summary.waitFor({ timeout: 60_000 });
  result.summary = await summary.locator("dl").innerText();
  result.headerStatus = await page.getByText("Simulation finished").first().isVisible();
  result.kpiBadge = await page.getByText("SIMULATION FINISHED").first().isVisible();

  await summary.getByRole("button", { name: "Back to dispatch setup" }).click();
  const initialize = page.getByRole("button", { name: /Initialize green corridor/ });
  await initialize.waitFor();
  result.backToSetup = true;

  // Rapid start → back → start.
  await page.getByRole("radio", { name: "10×" }).click();
  await initialize.click();
  await page.getByRole("status").filter({ hasText: "Simulation stream: Live" }).waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Dispatch setup" }).click();
  await initialize.waitFor();
  await page.getByRole("radio", { name: "10×" }).click();
  await initialize.click();
  await page.getByRole("status").filter({ hasText: "Simulation stream: Live" }).waitFor({ timeout: 10_000 });
  await page.getByText(/TICK · [1-9]/).waitFor({ timeout: 10_000 });
  result.secondRunTick = await page.getByText(/TICK · \d+/).textContent();
  result.secondRunItsEntries = await page
    .getByText("Simulated FORCE_GREEN_PHASE", { exact: false })
    .count();
  result.secondRunTimeSaved = await page
    .getByText(/^\+\d+s$/)
    .first()
    .textContent();
  return JSON.stringify(result, null, 2);
}
