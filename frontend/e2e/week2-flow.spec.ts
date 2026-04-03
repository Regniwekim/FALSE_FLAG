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

  await expect(page.getByText(/Round\s+1/i)).toBeVisible();
  await expect(page2.getByText(/Round\s+1/i)).toBeVisible();

  await expect(page.getByPlaceholder("Ask a yes-or-no question")).toBeEnabled();
  await page.getByPlaceholder("Ask a yes-or-no question").fill("Is it in Europe?");
  await page.getByRole("button", { name: "Ask" }).click();

  await expect(page2.getByText(/^Is it in Europe\?$/)).toBeVisible();
  await expect(page2.getByRole("button", { name: "Answer Yes" })).toBeEnabled();
  await page2.getByRole("button", { name: "Answer Yes" }).click();

  await expect(page.getByText(/Last Q\/A:/)).toContainText("YES");

  await expect(page.getByRole("button", { name: "US" })).toBeEnabled();
  await page.getByRole("button", { name: "US" }).click();
  await expect(page.getByRole("button", { name: "US" })).toHaveClass(/flag-card-eliminated/);
  await expect(page2.getByRole("button", { name: "US" })).not.toHaveClass(/flag-card-eliminated/);

  await expect(page.getByRole("button", { name: "End Turn" })).toBeEnabled();
  await page.getByRole("button", { name: "End Turn" }).click();

  await expect(page2.getByPlaceholder("Ask a yes-or-no question")).toBeEnabled();

  await page.getByPlaceholder("Chat message").fill("hello from p1");
  await page.getByRole("button", { name: "Send Chat" }).click();
  await expect(page2.getByText(/hello from p1/i)).toBeVisible();

  await context2.close();
});
