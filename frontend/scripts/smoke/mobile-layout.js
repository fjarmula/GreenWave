/* eslint-disable @typescript-eslint/no-unused-expressions -- playwright-cli consumes a function expression */
async (page) => {
  const base = new URL(page.url()).origin;
  const failures = [];
  const headers = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  await page.context().clearCookies();
  for (const width of [320, 393, 430]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto(base);
    for (const language of ["pl", "en"]) {
      await page.getByRole("button", { name: language === "pl" ? "Polski" : "English", exact: true }).click();
      for (const theme of ["Jasny motyw", "Ciemny motyw"]) {
        await page.getByRole("button", { name: language === "pl" ? theme : theme === "Jasny motyw" ? "Light theme" : "Dark theme", exact: true }).click();
        const geometry = await page.locator(".home-main .workspace-header").evaluate((header) => {
          const copy = header.querySelector(".workspace-heading p");
          const name = copy.querySelector(".home-brand-name") ?? copy.firstChild;
          const city = copy.querySelector(".home-brand-city") ?? copy.querySelector("span");
          const lines = (node) => { const range = document.createRange(); range.selectNodeContents(node); return [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0); };
          const nameRects = name.nodeType === Node.TEXT_NODE ? (() => { const range = document.createRange(); range.selectNode(name); return [...range.getClientRects()]; })() : lines(name);
          const cityRects = lines(city);
          const actions = header.querySelector(".workspace-actions").getBoundingClientRect();
          const bounds = header.getBoundingClientRect();
          return { heroTop: document.querySelector(".home-eyebrow").getBoundingClientRect().top, headerBottom: bounds.bottom, nameLines: nameRects.length, cityLines: cityRects.length, brandRight: Math.max(...nameRects.map((r) => r.right), ...cityRects.map((r) => r.right)), actionsLeft: actions.left, right: bounds.right, scrollWidth: document.documentElement.scrollWidth, viewport: innerWidth };
        });
        check(geometry.nameLines === 1 && geometry.cityLines === 1, `Brand wraps within words at ${width}/${language}/${theme}`);
        check(geometry.brandRight <= geometry.actionsLeft, `Brand overlaps controls at ${width}/${language}/${theme}`);
        check(geometry.right <= width && geometry.scrollWidth <= width, `Header overflows at ${width}/${language}/${theme}`);
        check(geometry.heroTop >= geometry.headerBottom, `Header covers home content at ${width}/${language}/${theme}`);
        headers.push({ width, language, theme, ...geometry });
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + "/driver");
  await page.getByRole("button", { name: "Polski", exact: true }).click();
  await page.locator(".maplibregl-canvas").first().click({ position: { x: 1000, y: 350 } });
  await page.getByRole("button", { name: "Straż", exact: true }).click();
  await page.setViewportSize({ width: 393, height: 700 });
  const sheet = page.locator(".bottom-sheet");
  await sheet.waitFor();
  await page.locator(".settings-summary").click();
  await page.waitForFunction(() => document.querySelector('.bottom-sheet')?.dataset.snap === "expanded");
  // Wait for the existing drawer transition, then scroll from the heading rather than the details.
  await sheet.evaluate(async (element) => { await Promise.all(element.getAnimations().map((a) => a.finished.catch(() => {}))); });
  const before = await page.locator(".driver-setup-title").boundingBox();
  await page.locator(".driver-setup-title").hover();
  await page.mouse.wheel(0, 350);
  await page.waitForFunction(() => document.querySelector('.bottom-sheet').scrollTop > 50, undefined, { timeout: 2000 }).catch(() => {});
  const after = await page.locator(".driver-setup-title").boundingBox();
  const scrolled = await sheet.evaluate((element) => element.scrollTop);
  check(scrolled > 50 && after.y < before.y - 40, "Scrolling from the setup heading must move the entire form");
  const action = page.getByRole("button", { name: "Uruchom przejazd z priorytetem", exact: true });
  check(await action.isVisible(), "Dispatch action must remain visible while scrolling");
  const actionBox = await action.boundingBox();
  check(actionBox.y + actionBox.height <= 700, "Dispatch action must stay inside the viewport");
  await page.screenshot({ path: "mobile-driver-scroll.png" });
  await page.locator(".bottom-sheet-grabber").click();
  await page.waitForFunction(() => document.querySelector('.bottom-sheet')?.dataset.snap === "collapsed");
  check(await sheet.evaluate((element) => element.scrollTop) === 0, "Collapsing must restore the form to its beginning");
  await page.setViewportSize({ width: 700, height: 393 });
  await page.locator(".bottom-sheet-grabber").click();
  await page.waitForFunction(() => document.querySelector('.bottom-sheet')?.dataset.snap === "expanded");
  await sheet.evaluate(async (element) => { await Promise.all(element.getAnimations().map((a) => a.finished.catch(() => {}))); });
  await page.locator(".driver-setup-title").hover();
  await page.mouse.wheel(0, 200);
  await page.waitForFunction(() => document.querySelector('.bottom-sheet').scrollTop > 30, undefined, { timeout: 2000 }).catch(() => {});
  check(await sheet.evaluate((element) => element.scrollTop) > 30, "Expanded setup must scroll in landscape");
  const landscapeAction = await action.boundingBox();
  check(landscapeAction.y + landscapeAction.height <= 393, "Landscape dispatch action must stay visible");
  await page.setViewportSize({ width: 393, height: 700 });
  await page.goto(base);
  await page.screenshot({ path: "mobile-home-header.png" });
  return { passed: failures.length === 0, failures, headers, scrolled };
}
