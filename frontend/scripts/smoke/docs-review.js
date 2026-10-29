/* eslint-disable @typescript-eslint/no-unused-expressions -- playwright-cli consumes a function expression */
async (page) => {
  const base = new URL(page.url()).origin;
  const results = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  await page.context().clearCookies();
  for (const width of [1440, 900, 768, 393, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base + "/docs", { waitUntil: "networkidle" });
    for (const language of ["pl", "en"]) {
      await page.getByRole("button", { name: language === "pl" ? "Polski" : "English", exact: true }).click();
      await page.getByRole("heading", { name: language === "pl" ? "Dokumentacja" : "Documentation", exact: true }).waitFor();
      const list = page.getByRole("tablist");
      check(await page.getByRole("tab").count() === 5, "Expected five documentation sections");
      check(await list.getAttribute("aria-orientation") === (width < 768 ? "horizontal" : "vertical"), "Wrong keyboard orientation");
      const demo = page.locator(".docs-head a");
      check(await demo.locator("svg").count() === 1, "Demo arrow must be an SVG");
      check(!(await demo.textContent()).includes("↗"), "Demo must not contain an emoji-prone arrow");
      for (const id of ["about", "tech", "data", "architecture", "roadmap"]) {
        await page.locator(`#docs-tab-${id}`).click();
        const panel = page.locator(`#docs-panel-${id}`);
        await panel.waitFor();
        const geometry = await page.evaluate(() => {
          const panel = document.querySelector('.docs-panel').getBoundingClientRect();
          const header = document.querySelector('.workspace-header').getBoundingClientRect();
          return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, panelRight: panel.right, headerBottom: header.bottom, panelTop: panel.top };
        });
        check(geometry.scrollWidth <= width + 1, `Page overflow: ${width}/${language}/${id}`);
        check(geometry.panelRight <= width, `Panel outside viewport: ${width}/${id}`);
        if (id === "data") check(await page.locator(width < 768 ? ".docs-table-mobile" : ".docs-table-scroll").isVisible(), "Data sources use wrong layout");
        if (id === "architecture") {
          const diagram = await panel.locator(".docs-diagram").evaluate((element) => ({ width: element.clientWidth, narrow: getComputedStyle(element.querySelector('.docs-diagram-narrow')).display !== 'none' }));
          check(diagram.width > 640 || diagram.narrow, "Diagram labels are squeezed into a wide layout");
        }
        results.push({ width, language, id });
      }
      await page.locator("#docs-tab-about").click();
      await page.locator("#docs-tab-about").focus();
      await page.keyboard.press(width < 768 ? "ArrowRight" : "ArrowDown");
      await page.waitForFunction(() => location.hash === "#tech");
      await page.locator('#docs-tab-tech[aria-selected="true"]').waitFor();
    }
  }
  await page.setViewportSize({ width: 393, height: 700 });
  await page.goto(base + "/docs#data", { waitUntil: "networkidle" });
  await page.locator("#docs-panel-data").waitFor();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.locator("#docs-tab-tech").click();
  await page.locator("#docs-panel-tech").waitFor();
  const headingVisible = await page.evaluate(() => document.querySelector('.docs-section-title').getBoundingClientRect().top >= document.querySelector('.workspace-header').getBoundingClientRect().bottom);
  check(headingVisible, "Section switching leaves the new heading hidden above the viewport");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base + "/docs", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Polski", exact: true }).click();
  await page.screenshot({ path: "docs-desktop-light.png", fullPage: true });
  await page.locator("#docs-tab-data").click();
  await page.screenshot({ path: "docs-data-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 393, height: 844 });
  await page.goto(base + "/docs", { waitUntil: "networkidle" });
  await page.screenshot({ path: "docs-phone-light.png", fullPage: true });
  await page.locator("#docs-tab-data").click();
  await page.screenshot({ path: "docs-data-phone.png", fullPage: true });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
  await page.goto(base + "/docs", { waitUntil: "networkidle" });
  await page.screenshot({ path: "docs-phone-dark.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "docs-desktop-dark.png", fullPage: true });
  await page.goto(base + "/docs#run", { waitUntil: "networkidle" });
  await page.locator("#docs-panel-about").waitFor();
  check(await page.getByRole("tab").count() === 5, "Removed Running section reappeared");
  check(errors.length === 0, errors.join("; "));
  return { passed: true, cases: results.length, errors };
}
