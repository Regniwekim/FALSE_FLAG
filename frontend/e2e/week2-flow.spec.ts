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

  const eliminableFlagButton = page.locator(".map-stage .map-flag-card:visible").first();
  const eliminableFlagLabel = await eliminableFlagButton.getAttribute("aria-label");
  if (!eliminableFlagLabel) {
    throw new Error("Expected at least one visible eliminable flag button");
  }

  await expect(eliminableFlagButton).toBeEnabled();
  await eliminableFlagButton.click();
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
