import { expect, test, type Page } from "@playwright/test";

type MapViewportState = {
  transform: string;
  scale: number;
};

async function findExposedMapPoint(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>("[data-testid='map-canvas']");
    if (!stage) {
      return null;
    }

    const rect = stage.getBoundingClientRect();
    for (let y = rect.top + 96; y < rect.bottom - 96; y += 28) {
      for (let x = rect.left + 96; x < rect.right - 96; x += 28) {
        const topElement = document.elementFromPoint(x, y);
        if (!topElement) {
          continue;
        }

        if (!stage.contains(topElement)) {
          continue;
        }

        if (topElement.closest(".map-flag-card")) {
          continue;
        }

        return { x, y };
      }
    }

    return null;
  });

  if (!point) {
    throw new Error("Expected an exposed map pixel that routes pointer input to the map canvas");
  }

  return point;
}

async function findVisibleMarkerCode(page: Page): Promise<string> {
  const flagCode = await page.evaluate(() => {
    const markers = Array.from(document.querySelectorAll<HTMLElement>(".map-flag-marker[data-flag-code]"));

    for (const marker of markers) {
      const card = marker.querySelector<HTMLElement>(".map-flag-card");
      if (!card) {
        continue;
      }

      const rect = card.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      if (centerX < 0 || centerY < 0 || centerX > window.innerWidth || centerY > window.innerHeight) {
        continue;
      }

      const topElement = document.elementFromPoint(centerX, centerY);
      if (!topElement || !marker.contains(topElement)) {
        continue;
      }

      const code = marker.getAttribute("data-flag-code");
      if (code) {
        return code;
      }
    }

    return null;
  });

  if (!flagCode) {
    throw new Error("Expected a visible marker that receives pointer input");
  }

  return flagCode;
}

async function readMapViewportState(page: Page): Promise<MapViewportState> {
  return page.locator(".map-world-layer").evaluate((element) => {
    const transform = (element as HTMLElement).style.transform;
    const scaleMatch = /scale\(([^)]+)\)/.exec(transform);
    return {
      transform,
      scale: scaleMatch ? Number(scaleMatch[1]) : 0
    };
  });
}

async function dragMapFromExposedPoint(
  page: Page,
  deltaX: number,
  deltaY: number,
  steps: number
): Promise<void> {
  const exposedPoint = await findExposedMapPoint(page);

  await page.mouse.move(exposedPoint.x, exposedPoint.y);
  await page.mouse.down();
  await page.mouse.move(exposedPoint.x + deltaX, exposedPoint.y + deltaY, { steps });
  await page.mouse.up();
}

async function waitForTransformChange(
  page: Page,
  previousTransform: string,
  timeout: number
): Promise<boolean> {
  try {
    await expect.poll(async () => {
      const currentState = await readMapViewportState(page);
      return currentState.transform !== previousTransform;
    }, { timeout }).toBe(true);
    return true;
  } catch {
    return false;
  }
}

test("desktop map accepts exposed-canvas drag and wheel zoom", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");

  const mapStage = page.getByTestId("map-canvas");
  await expect(mapStage).toBeVisible();

  const beforeDrag = await readMapViewportState(page);
  let didDragChangeTransform = false;

  for (const [deltaX, deltaY, steps, timeout] of [
    [120, 48, 12, 1500],
    [160, 64, 18, 2000],
    [220, 80, 24, 2500]
  ] as const) {
    await dragMapFromExposedPoint(page, deltaX, deltaY, steps);
    didDragChangeTransform = await waitForTransformChange(page, beforeDrag.transform, timeout);
    if (didDragChangeTransform) {
      break;
    }
  }

  expect(didDragChangeTransform).toBe(true);

  const beforeZoom = await readMapViewportState(page);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -320);
  await page.keyboard.up("Control");

  await expect.poll(async () => {
    const currentState = await readMapViewportState(page);
    return currentState.scale;
  }).toBeGreaterThan(beforeZoom.scale);
});

test("desktop map flags fade and expand a compact infobox on hover", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");

  const markerCode = await findVisibleMarkerCode(page);
  const marker = page.locator(`.map-flag-marker[data-flag-code="${markerCode}"]`);
  const card = marker.locator(".map-flag-card");

  await marker.hover();

  await expect.poll(async () => {
    return card.evaluate((element) => getComputedStyle(element as HTMLElement).opacity);
  }).toBe("0.9");

  const preview = page.getByTestId("map-flag-preview");
  await expect(preview).toBeVisible({ timeout: 1200 });
  await expect(preview).toContainText(/Capital/i);
  await expect(preview).toContainText(/Population/i);

  const exposedPoint = await findExposedMapPoint(page);
  await page.mouse.move(exposedPoint.x, exposedPoint.y);
  await expect(preview).toHaveCount(0);
});