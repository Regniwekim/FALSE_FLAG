import { test, expect, type BrowserContext, type Locator, type Page, devices } from "@playwright/test";

type TouchPoint = {
  clientX: number;
  clientY: number;
};

async function getRoomCode(page: Page): Promise<string> {
  const roomLine = page.getByTestId("mission-room-code");
  await expect(roomLine).toBeVisible();

  for (let index = 0; index < 30; index += 1) {
    const text = (await roomLine.innerText()).trim();
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

async function expectQuestionAnswerHistory(page: Page, question: string, answer: "YES" | "NO"): Promise<void> {
  const historyTable = page.getByRole("table", { name: "Question and answer history" });

  await expect(historyTable).toBeVisible();
  await expect(historyTable.getByText(question, { exact: true })).toBeVisible();
  await expect(historyTable.getByRole("cell", { name: answer, exact: true })).toBeVisible();
}

async function findVisibleMarkerLabels(page: Page, limit: number): Promise<string[]> {
  const markers = page.locator(".map-flag-card");
  const markerCount = await markers.count();
  const labels: string[] = [];

  for (let index = 0; index < markerCount; index += 1) {
    if (labels.length >= limit) {
      break;
    }

    const marker = markers.nth(index);
    if (!await marker.isVisible() || !await marker.isEnabled()) {
      continue;
    }

    const box = await marker.boundingBox();
    const label = await marker.getAttribute("aria-label");

    if (!box || !label || labels.includes(label)) {
      continue;
    }

    labels.push(label);
  }

  return labels;
}

async function getTouchPoint(locator: Locator): Promise<TouchPoint> {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("Expected a visible marker bounding box for touch interactions");
  }

  return {
    clientX: box.x + box.width / 2,
    clientY: box.y + box.height / 2
  };
}

async function dispatchTouchEvent(locator: Locator, type: "touchstart" | "touchend", point: TouchPoint): Promise<void> {
  await locator.dispatchEvent(type, {
    bubbles: true,
    cancelable: true,
    changedTouches: [{
      identifier: 1,
      clientX: point.clientX,
      clientY: point.clientY,
      pageX: point.clientX,
      pageY: point.clientY,
      screenX: point.clientX,
      screenY: point.clientY
    }],
    touches: type === "touchend"
      ? []
      : [{
        identifier: 1,
        clientX: point.clientX,
        clientY: point.clientY,
        pageX: point.clientX,
        pageY: point.clientY,
        screenX: point.clientX,
        screenY: point.clientY
      }],
    targetTouches: type === "touchend"
      ? []
      : [{
        identifier: 1,
        clientX: point.clientX,
        clientY: point.clientY,
        pageX: point.clientX,
        pageY: point.clientY,
        screenX: point.clientX,
        screenY: point.clientY
      }]
  });
}

test("mobile long press reveals a map preview without eliminating and tap still eliminates", async ({ browser }) => {
  const mobileContext: BrowserContext = await browser.newContext({
    ...devices["iPhone 12"],
    locale: "en-US"
  });
  const hostContext: BrowserContext = await browser.newContext();

  const mobilePage = await mobileContext.newPage();
  const hostPage = await hostContext.newPage();

  await mobilePage.goto("/");
  await hostPage.goto("/");

  await mobilePage.getByPlaceholder("Display name").fill("Mobile Host");
  await mobilePage.getByRole("button", { name: "Create Room" }).click();
  const roomCode = await getRoomCode(mobilePage);

  await hostPage.getByPlaceholder("Display name").fill("Desktop Joiner");
  await hostPage.getByPlaceholder("Room code").fill(roomCode);
  await hostPage.getByRole("button", { name: "Join Room" }).click();

  await expectRoundNumber(mobilePage, 1);
  await expect(mobilePage.getByTestId("turn-status")).toContainText(/YOUR TURN/i);

  const question = "Is it in Europe?";
  const composer = mobilePage.getByLabel("Intercept composer");
  await composer.scrollIntoViewIfNeeded();
  await composer.fill(question);
  await mobilePage.getByRole("button", { name: "Ask Question" }).click();

  await expect(hostPage.getByTestId("incoming-question")).toHaveText(question);
  await hostPage.getByRole("button", { name: "Answer Yes" }).click();
  await expectQuestionAnswerHistory(mobilePage, question, "YES");

  const endTurnButton = mobilePage.getByRole("button", { name: "End Turn" });
  await endTurnButton.scrollIntoViewIfNeeded();
  await expect(endTurnButton).toBeEnabled();

  const mapStage = mobilePage.getByTestId("map-canvas");
  await mapStage.scrollIntoViewIfNeeded();
  await expect(mapStage).toBeVisible();

  const visibleMarkerLabels = await findVisibleMarkerLabels(mobilePage, 2);
  expect(visibleMarkerLabels.length).toBeGreaterThan(0);

  const previewLabel = visibleMarkerLabels[0];
  const tapLabel = visibleMarkerLabels[1] ?? visibleMarkerLabels[0];
  const previewCard = mobilePage.getByRole("button", { name: previewLabel }).first();
  const previewPoint = await getTouchPoint(previewCard);

  await expect(mobilePage.getByText("0 / 24 flags eliminated")).toBeVisible();

  await dispatchTouchEvent(previewCard, "touchstart", previewPoint);
  await mobilePage.waitForTimeout(600);
  const preview = mobilePage.getByTestId("map-flag-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toContainText(/Capital/i);
  await expect(preview).toContainText(/Population/i);
  await expect(mobilePage.getByText("0 / 24 flags eliminated")).toBeVisible();

  await dispatchTouchEvent(previewCard, "touchend", previewPoint);
  await expect(preview).toHaveCount(0);
  await expect(mobilePage.getByText("0 / 24 flags eliminated")).toBeVisible();

  const tapCard = mobilePage.getByRole("button", { name: tapLabel }).first();
  const tapPoint = await getTouchPoint(tapCard);
  await dispatchTouchEvent(tapCard, "touchstart", tapPoint);
  await dispatchTouchEvent(tapCard, "touchend", tapPoint);
  await tapCard.dispatchEvent("click");

  await expect(mobilePage.getByText("1 / 24 flags eliminated")).toBeVisible();
  await expect(mobilePage.getByRole("button", { name: tapLabel }).first()).toHaveClass(/flag-card-eliminated/);
  await expect(hostPage.getByRole("button", { name: tapLabel }).first()).not.toHaveClass(/flag-card-eliminated/);

  await mobileContext.close();
  await hostContext.close();
});