import { expect, test } from "@playwright/test";

test("desktop windows can be moved by dragging the title bar", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");

  const missionWindow = page.getByTestId("mission-window");
  const titleBar = missionWindow.locator(".desktop-window-titlebar");

  await expect(missionWindow).toBeVisible();

  const before = await missionWindow.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      left: style.left,
      top: style.top
    };
  });

  const titleBarBox = await titleBar.boundingBox();
  if (!titleBarBox) {
    throw new Error("Expected mission window title bar to have a bounding box");
  }

  await page.mouse.move(titleBarBox.x + 40, titleBarBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(titleBarBox.x - 140, titleBarBox.y + 110, { steps: 12 });
  await page.mouse.up();

  const after = await missionWindow.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      left: style.left,
      top: style.top
    };
  });

  expect(after.left).not.toBe(before.left);
  expect(after.top).not.toBe(before.top);
});