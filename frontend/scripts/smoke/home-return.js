/* eslint-disable @typescript-eslint/no-unused-expressions -- playwright-cli run-code takes a bare function expression */
async (page) => {
  const assertHome = async () => {
    if (await page.getByRole("navigation", { name: "Workspace navigation" }).count())
      throw new Error("Home has a duplicate workspace menu");
    for (const selector of [".home-title", ".home-lede", ".home-header"]) {
      const visible = await page.locator(selector).evaluate((element) => {
        // Restoring a backgrounded page must not leave essential text in a hidden frame.
        for (const animation of element.getAnimations({ subtree: true })) {
          animation.pause();
          animation.currentTime = 0;
        }
        const style = getComputedStyle(element);
        return style.opacity === "1" && style.visibility === "visible";
      });
      if (!visible) throw new Error(`${selector} disappeared after navigation`);
    }
  };
  const results = [];
  await page.goto("http://127.0.0.1:3100");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    for (const theme of ["Light theme", "Dark theme"]) {
      await page.getByRole("button", { name: theme, exact: true }).click();
      for (const [index, route] of ["/simulation/green-wave", "/driver", "/compare"].entries()) {
        await assertHome();
        await page.locator(`a[href="${route}"]`).first().click();
        await page.waitForURL(`**${route}`);
        if (index % 2) await page.goBack();
        else {
          const menu = page.locator(".page-menu-trigger");
          if (await menu.isVisible()) await menu.click();
          await page.getByRole("navigation", { name: "Workspace navigation" })
            .getByRole("link", { name: "Home", exact: true }).click();
        }
        await page.waitForURL("http://127.0.0.1:3100/");
        await assertHome();
        results.push({ width, theme, route, visible: true });
      }
    }
  }
  return results;
}
