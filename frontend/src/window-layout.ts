export const DESKTOP_WINDOW_BREAKPOINT = 1024;
export const DESKTOP_WINDOW_STORAGE_KEY = "false-flag.desktop-layout.v2";

const WINDOW_MARGIN = 24;
const WINDOW_TOP_SAFE_AREA = 228;
export const COLLAPSED_WINDOW_HEIGHT = 64;

const WINDOW_MIN_SIZES: Record<DesktopWindowId, { minWidth: number; minHeight: number }> = {
  mission: { minWidth: 320, minHeight: 300 },
  intel: { minWidth: 340, minHeight: 320 },
  chat: { minWidth: 500, minHeight: 280 }
};

export type DesktopWindowId = "mission" | "intel" | "chat";

export type DesktopWindowLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minWidth: number;
  minHeight: number;
};

export type DesktopWindowsState = Record<DesktopWindowId, DesktopWindowLayout>;

function clampValue(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function normalizeDesktopWindowLayout(
  layout: DesktopWindowLayout,
  viewportWidth: number,
  viewportHeight: number,
  visualHeight?: number
): DesktopWindowLayout {
  const maxWidth = Math.max(layout.minWidth, viewportWidth - WINDOW_MARGIN * 2);
  const maxHeight = Math.max(layout.minHeight, viewportHeight - WINDOW_TOP_SAFE_AREA - WINDOW_MARGIN);
  const width = clampValue(layout.width, layout.minWidth, maxWidth);
  const height = clampValue(layout.height, layout.minHeight, maxHeight);
  const effectiveHeight = visualHeight ?? height;
  const maxX = Math.max(WINDOW_MARGIN, viewportWidth - width - WINDOW_MARGIN);
  const maxY = Math.max(WINDOW_MARGIN, viewportHeight - effectiveHeight - WINDOW_MARGIN);

  return {
    ...layout,
    width,
    height,
    x: clampValue(layout.x, WINDOW_MARGIN, maxX),
    y: clampValue(layout.y, WINDOW_MARGIN, maxY)
  };
}

export function createDefaultDesktopWindows(viewportWidth: number, viewportHeight: number): DesktopWindowsState {
  const availableHeight = Math.max(340, viewportHeight - WINDOW_TOP_SAFE_AREA - WINDOW_MARGIN);

  return normalizeDesktopWindows({
    mission: {
      x: viewportWidth - 416,
      y: WINDOW_TOP_SAFE_AREA + 8,
      width: 392,
      height: Math.min(430, availableHeight),
      zIndex: 14,
      ...WINDOW_MIN_SIZES.mission
    },
    intel: {
      x: viewportWidth - 472,
      y: WINDOW_TOP_SAFE_AREA + 148,
      width: 432,
      height: Math.min(520, availableHeight),
      zIndex: 13,
      ...WINDOW_MIN_SIZES.intel
    },
    chat: {
      x: viewportWidth - 532,
      y: viewportHeight - Math.min(360, availableHeight) - WINDOW_MARGIN,
      width: 500,
      height: Math.min(360, availableHeight),
      zIndex: 15,
      ...WINDOW_MIN_SIZES.chat
    }
  }, viewportWidth, viewportHeight);
}

export function normalizeDesktopWindows(
  windows: DesktopWindowsState,
  viewportWidth: number,
  viewportHeight: number
): DesktopWindowsState {
  return {
    mission: normalizeDesktopWindowLayout(windows.mission, viewportWidth, viewportHeight),
    intel: normalizeDesktopWindowLayout(windows.intel, viewportWidth, viewportHeight),
    chat: normalizeDesktopWindowLayout(windows.chat, viewportWidth, viewportHeight)
  };
}

function isDesktopWindowLayout(value: unknown): value is DesktopWindowLayout {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return ["x", "y", "width", "height", "zIndex", "minWidth", "minHeight"].every((key) => (
    typeof record[key] === "number" && Number.isFinite(record[key] as number)
  ));
}

export function loadPersistedDesktopWindows(viewportWidth: number, viewportHeight: number): DesktopWindowsState {
  if (typeof window === "undefined") {
    return createDefaultDesktopWindows(viewportWidth, viewportHeight);
  }

  try {
    const rawValue = window.localStorage.getItem(DESKTOP_WINDOW_STORAGE_KEY);
    if (!rawValue) {
      return createDefaultDesktopWindows(viewportWidth, viewportHeight);
    }

    const parsed = JSON.parse(rawValue) as Partial<Record<DesktopWindowId, unknown>>;
    if (!isDesktopWindowLayout(parsed.mission) || !isDesktopWindowLayout(parsed.intel) || !isDesktopWindowLayout(parsed.chat)) {
      return createDefaultDesktopWindows(viewportWidth, viewportHeight);
    }

    return normalizeDesktopWindows({
      mission: { ...parsed.mission, ...WINDOW_MIN_SIZES.mission },
      intel: { ...parsed.intel, ...WINDOW_MIN_SIZES.intel },
      chat: { ...parsed.chat, ...WINDOW_MIN_SIZES.chat }
    }, viewportWidth, viewportHeight);
  } catch {
    return createDefaultDesktopWindows(viewportWidth, viewportHeight);
  }
}

export function raiseDesktopWindow(windows: DesktopWindowsState, windowId: DesktopWindowId): DesktopWindowsState {
  const nextZIndex = Math.max(...Object.values(windows).map((layout) => layout.zIndex)) + 1;

  return {
    ...windows,
    [windowId]: {
      ...windows[windowId],
      zIndex: nextZIndex
    }
  };
}

export function updateDesktopWindowLayout(
  windows: DesktopWindowsState,
  windowId: DesktopWindowId,
  nextLayout: DesktopWindowLayout,
  viewportWidth: number,
  viewportHeight: number,
  isCollapsed?: boolean
): DesktopWindowsState {
  return {
    ...windows,
    [windowId]: normalizeDesktopWindowLayout(
      nextLayout, viewportWidth, viewportHeight,
      isCollapsed ? COLLAPSED_WINDOW_HEIGHT : undefined
    )
  };
}