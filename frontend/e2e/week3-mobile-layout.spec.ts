import { test, expect, type BrowserContext, type Page, devices } from "@playwright/test";

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

test("week 3 mobile portrait layout stays usable in active match", async ({ browser }) => {
  const hostContext: BrowserContext = await browser.newContext();
  const mobileContext: BrowserContext = await browser.newContext({
    ...devices["iPhone 12"],
    locale: "en-US"
  });

  const hostPage = await hostContext.newPage();
  const mobilePage = await mobileContext.newPage();

  await hostPage.goto("/");
  await mobilePage.goto("/");

  await hostPage.getByPlaceholder("Display name").fill("Host");
  await hostPage.getByRole("button", { name: "Create Room" }).click();
  const roomCode = await getRoomCode(hostPage);

  await mobilePage.getByPlaceholder("Display name").fill("Mobile");
  await mobilePage.getByPlaceholder("Room code").fill(roomCode);
  await mobilePage.getByRole("button", { name: "Join Room" }).click();

  await expectRoundNumber(mobilePage, 1);
  await expect(mobilePage.locator(".score-ribbon")).toBeVisible();
  await expect(mobilePage.getByText(/YOUR TURN|OPPONENT TURN/i)).toBeVisible();

  const mapStage = mobilePage.locator(".map-stage");
  await expect(mapStage).toBeVisible();
  await expect(mobilePage.getByLabel("Map zoom controls")).toBeVisible();

  const chatInput = mobilePage.getByPlaceholder("Chat message");
  await chatInput.scrollIntoViewIfNeeded();
  await expect(chatInput).toBeVisible();
  await expect(mobilePage.getByRole("button", { name: "Send Chat" })).toBeVisible();

  const makeGuessButton = mobilePage.getByRole("button", { name: "Make Guess" });
  await makeGuessButton.scrollIntoViewIfNeeded();
  await expect(makeGuessButton).toBeVisible();

  await mobileContext.close();
  await hostContext.close();
});
