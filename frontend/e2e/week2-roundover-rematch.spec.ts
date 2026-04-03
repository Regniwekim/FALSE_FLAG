import { test, expect, type BrowserContext, type Page } from "@playwright/test";

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

test("round-over and new-game reset flow works across two clients", async ({ browser, page }) => {
  const context2: BrowserContext = await browser.newContext();
  const page2 = await context2.newPage();

  await page.goto("/");
  await page2.goto("/");

  await page.getByPlaceholder("Display name").fill("P1");
  await page.getByRole("button", { name: "Create Room" }).click();
  const roomCode = await getRoomCode(page);

  await page2.getByPlaceholder("Display name").fill("P2");
  await page2.getByPlaceholder("Room code").fill(roomCode);
  await page2.getByRole("button", { name: "Join Room" }).click();

  await expectRoundNumber(page, 1);
  await expectRoundNumber(page2, 1);

  // Force three wrong guesses by always guessing own secret (secrets are unique per round).
  for (let round = 1; round <= 3; round += 1) {
    await expectRoundNumber(page, round);
    const ownSecretText = await page.locator(".secret-slot strong").innerText();
    await page.getByRole("button", { name: "Make Guess" }).click();
    await page.getByRole("combobox", { name: "Guess flag" }).click();
    await page.getByRole("option", { name: ownSecretText }).click();
    await page.getByRole("button", { name: "Confirm Guess" }).click();

    if (round < 3) {
      const transitionBanner = page.getByTestId("round-transition-banner");
      await expect(transitionBanner).toBeVisible();
      await expect(transitionBanner).toContainText(/NEXT ROUND/i);
      await expectRoundNumber(page, round + 1);
      await expect(transitionBanner).toHaveCount(0);
    }
  }

  await expect(page.getByText(/Match winner:/i)).toBeVisible();
  await expect(page.getByTestId("mission-window")).toBeVisible();
  await expect(page.getByTestId("intel-window")).toBeVisible();
  await expect(page.getByTestId("chat-window")).toBeVisible();
  await expect(page.getByRole("button", { name: "Rematch" })).toBeEnabled();

  await page.getByRole("button", { name: "Rematch" }).click();

  await expect(page.getByText(/New game started/i)).toBeVisible();
  await expect(page2.getByText(/New game started/i)).toBeVisible();

  await expectRoundNumber(page, 1);
  await expectRoundNumber(page2, 1);

  await context2.close();
});
