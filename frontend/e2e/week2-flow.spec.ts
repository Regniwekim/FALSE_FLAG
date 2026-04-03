import { test, expect, type Page, type BrowserContext } from "@playwright/test";

async function getRoomCode(page: Page): Promise<string> {
  const roomLine = page.locator(".hero-meta .meta-pill").filter({ hasText: /^room /i }).first();
  await expect(roomLine).toBeVisible();
  for (let i = 0; i < 30; i += 1) {
    const text = (await roomLine.innerText()).replace(/^room\s+/i, "").trim();
    if (text && text.toLowerCase() !== "none") {
      return text;
    }
    await page.waitForTimeout(100);
  }
  throw new Error("Timed out waiting for generated room code");
}

async function expectRoundNumber(page: Page, roundNumber: number): Promise<void> {
  await expect(page.getByTestId("round-status")).toContainText(new RegExp(`Round\\s+${roundNumber}\\b`, "i"));
}

async function findFirstUncoveredMarkerLabel(page: Page): Promise<string | null> {
  const markers = page.getByTestId("map-canvas").locator(".map-flag-card");
  const count = await markers.count();

  for (let index = 0; index < count; index += 1) {
    const marker = markers.nth(index);
    const box = await marker.boundingBox();
    const label = await marker.getAttribute("aria-label");

    if (!box || !label) {
      continue;
    }

    const topMarkerLabel = await page.evaluate(({ x, y }) => {
      const topElement = document.elementFromPoint(x, y);
      return topElement?.closest(".map-flag-card")?.getAttribute("aria-label") ?? null;
    }, {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2
    });

    if (topMarkerLabel !== label) {
      continue;
    }

    return label;
  }

  return null;
}

async function overlapWindow(page: Page, sourceTestId: string, targetTestId: string): Promise<void> {
  const sourceTitleBar = page.getByTestId(sourceTestId).locator(".desktop-window-titlebar");
  const targetWindow = page.getByTestId(targetTestId);
  const sourceBox = await sourceTitleBar.boundingBox();
  const targetBox = await targetWindow.boundingBox();

  if (!sourceBox || !targetBox) {
    return;
  }

  await page.mouse.move(sourceBox.x + 56, sourceBox.y + 18);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + 112, targetBox.y + 96, { steps: 12 });
  await page.mouse.up();
}

async function clickFirstUncoveredMarker(page: Page): Promise<string> {
  let label = await findFirstUncoveredMarkerLabel(page);
  if (!label) {
    await overlapWindow(page, "chat-window", "intel-window");
    label = await findFirstUncoveredMarkerLabel(page);
  }

  if (!label) {
    await overlapWindow(page, "intel-window", "chat-window");
    label = await findFirstUncoveredMarkerLabel(page);
  }

  if (!label) {
    const fallbackMarker = page.getByTestId("map-canvas").locator(".map-flag-card:not([disabled])").first();
    await expect(fallbackMarker).toBeVisible();
    label = await fallbackMarker.getAttribute("aria-label");

    if (!label) {
      throw new Error("Expected a keyboard-focusable map marker button");
    }

    await fallbackMarker.focus();
    await page.keyboard.press("Enter");
    return label;
  }

  const marker = page.getByRole("button", { name: label }).first();
  await expect(marker).toBeEnabled();
  await marker.click();
  return label;
}

test("two-player Week 2 gameplay loop works across browser contexts", async ({ browser, page }) => {
  const context2: BrowserContext = await browser.newContext();
  const page2 = await context2.newPage();

  await page.goto("/");
  await page2.goto("/");

  await page.getByPlaceholder("Display name").fill("P1");
  await page.getByRole("button", { name: "Create Room" }).click();

  const roomCode = await getRoomCode(page);
  await expect(page.getByText(/Waiting for opponent/i)).toBeVisible();

  await page2.getByPlaceholder("Display name").fill("P2");
  await page2.getByPlaceholder("Room code").fill(roomCode);
  await page2.getByRole("button", { name: "Join Room" }).click();

  await expectRoundNumber(page, 1);
  await expectRoundNumber(page2, 1);

  await expect(page.getByPlaceholder("Ask a yes-or-no question")).toBeEnabled();
  await page.getByPlaceholder("Ask a yes-or-no question").fill("Is it in Europe?");
  await page.getByRole("button", { name: "Ask" }).click();

  await expect(page2.getByTestId("incoming-question")).toHaveText(/^Is it in Europe\?$/);
  await expect(page2.getByRole("button", { name: "Answer Yes" })).toBeEnabled();
  await page2.getByRole("button", { name: "Answer Yes" }).click();

  await expect(page.locator(".event-strip")).toContainText("YES");

  const eliminableFlagLabel = await clickFirstUncoveredMarker(page);
  await expect(page.getByRole("button", { name: eliminableFlagLabel })).toHaveClass(/flag-card-eliminated/);
  await expect(page2.getByRole("button", { name: eliminableFlagLabel })).not.toHaveClass(/flag-card-eliminated/);

  await expect(page.getByRole("button", { name: "End Turn" })).toBeEnabled();
  await page.getByRole("button", { name: "End Turn" }).click();

  await expect(page2.getByPlaceholder("Ask a yes-or-no question")).toBeEnabled();

  await page.getByPlaceholder("Chat message").fill("hello from p1");
  await page.getByRole("button", { name: "Send Chat" }).click();
  await expect(page2.getByText(/hello from p1/i)).toBeVisible();

  await context2.close();
});
