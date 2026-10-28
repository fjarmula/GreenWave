/* eslint-disable @typescript-eslint/no-unused-expressions -- playwright-cli consumes a function expression */
async (page) => {
  const results = [];
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const base = new URL(page.url()).origin;
  await page.context().clearCookies();
  await page.goto(base);
  await page.getByRole("heading", { name: "Szybsza droga na miejsce zdarzenia." }).waitFor();
  check((await page.locator("html").getAttribute("lang")) === "pl", "First visit must use Polish");
  check(
    (await page
      .getByRole("button", { name: "Polski", exact: true })
      .getAttribute("aria-pressed")) === "true",
    "PL must be selected",
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const language of ["en", "pl"]) {
      await page
        .getByRole("button", { name: language === "en" ? "English" : "Polski", exact: true })
        .click();
      await page.waitForFunction((lang) => document.documentElement.lang === lang, language);
      for (const route of [
        "/",
        "/simulation/green-wave",
        "/simulation/standard",
        "/compare",
        "/diagnostics",
        "/driver",
      ]) {
        await page.goto(base + route);
        check(
          (await page.locator("html").getAttribute("lang")) === language,
          `Language lost at ${route}`,
        );
        const switcher = page.locator(".language-switch");
        await switcher.waitFor();
        const box = await switcher.boundingBox();
        check(
          box && box.x >= 0 && box.x + box.width <= width,
          `Language switch out of viewport: ${width} ${route}`,
        );
        check(
          (await page
            .getByRole("button", { name: language === "en" ? "English" : "Polski", exact: true })
            .getAttribute("aria-pressed")) === "true",
          `Wrong selection: ${route}`,
        );
        if (route === "/")
          check(
            (await page.locator("h1").textContent()).includes(
              language === "pl" ? "Szybsza droga" : "A clearer path",
            ),
            "Wrong home translation",
          );
        else
          check(
            !(await page.title()).startsWith(language === "pl" ? "Driver" : "Kierowca"),
            "Wrong browser title",
          );
        results.push({ width, language, route, title: await page.title() });
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + "/simulation/green-wave");
  await page
    .locator(".maplibregl-canvas")
    .first()
    .click({ position: { x: 1000, y: 450 } });
  await page.getByRole("button", { name: "Uruchom zielony korytarz" }).click();
  await page.getByRole("button", { name: "Zatrzymaj symulację", exact: true }).first().waitFor();
  await page.getByRole("button", { name: "Powiększ", exact: true }).waitFor();
  const before = await page.locator("[data-testid='stop-simulation']").count();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("button", { name: "Stop simulation", exact: true }).first().waitFor();
  await page.getByRole("button", { name: "Zoom in", exact: true }).waitFor();
  check(
    (await page.locator("[data-testid='stop-simulation']").count()) === before,
    "Switch interrupted active run",
  );
  await page.getByRole("button", { name: "Polski", exact: true }).click();
  await page.getByRole("button", { name: "Zatrzymaj symulację", exact: true }).first().click();
  await page.screenshot({ path: "localization-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await page.screenshot({ path: "localization-phone.png" });
  // A malformed stored preference is rejected server-side.
  await page.context().addCookies([{ name: "greenwave-language", value: "de", url: base }]);
  await page.reload();
  check(
    (await page.locator("html").getAttribute("lang")) === "pl",
    "Invalid preference must fall back to Polish",
  );
  await page.goto(base + "/missing-page");
  await page.getByRole("heading", { name: "Nie znaleziono strony" }).waitFor();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("heading", { name: "Page not found" }).waitFor();
  check(pageErrors.length === 0, `Browser errors: ${pageErrors.join("; ")}`);
  return {
    routes: results,
    activeRunSwitch: true,
    invalidPreference: true,
    localizedNotFound: true,
    pageErrors,
  };
}
