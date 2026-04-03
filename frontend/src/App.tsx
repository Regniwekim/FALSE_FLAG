import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import {
  CLIENT_TO_SERVER,
  FULL_FLAG_CATALOG,
  ROOM_DIFFICULTIES,
  SERVER_TO_CLIENT,
  type RoomCreatedPayload,
  type GameStartedPayload,
  type ActionErrorPayload,
  type TurnState,
  type IncomingQuestionPayload,
  type QuestionAcceptedPayload,
  type QuestionAnsweredPayload,
  type BoardUpdatedPayload,
  type ChatMessageEventPayload,
  type GuessLockedPayload,
  type NextRoundPendingPayload,
  type SyncStatePayload,
  type RoundOverPayload,
  type RoomDifficulty
} from "@flagwho/shared";
import { socket } from "./socket";
import {
  playIncomingQuestion,
  playTurnChange,
  playRoundOver,
  playCorrectGuess,
  playWrongGuess,
  playButtonClick
} from "./audio";
import { DesktopWindow } from "./desktop-window";
import { CompactCountryInfobox, HiddenCountryPanel } from "./hidden-country-panel";
import { IntelSubpanel } from "./intel-subpanel";
import {
  DESKTOP_WINDOW_BREAKPOINT,
  DESKTOP_WINDOW_STORAGE_KEY,
  loadPersistedDesktopWindows,
  normalizeDesktopWindows,
  raiseDesktopWindow,
  type DesktopWindowLayout,
  type DesktopWindowId,
  updateDesktopWindowLayout
} from "./window-layout";
import { WORLD_MAP_MARKER_POSITIONS, type FlagMarkerPositions } from "./world-map-marker-positions";

type LobbyState = {
  roomCodeInput: string;
  displayName: string;
};

type ToastTone = "info" | "success" | "warning" | "error";

type ToastMessage = {
  id: number;
  text: string;
  tone: ToastTone;
};

type RoundRevealPhase = "hidden" | "impact" | "secrets" | "settled";

type ScorePulseTarget = "self" | "opponent" | null;

type RecentBoardChange = {
  flagCode: string;
  eliminated: boolean;
} | null;

type MapFlagPreviewIntent = "hover" | "focus" | "touch";

type MapFlagPreviewAlignment = "center" | "start" | "end";

type MapFlagPreviewPlacement = "above" | "below";

type CollapsedWindowsState = Record<"intel" | "chat", boolean>;

type AskedQuestionHistoryEntry = {
  id: number;
  question: string;
  answer: QuestionAnsweredPayload["answer"] | null;
};

const DEFAULT_FLAG_CODES = [...FULL_FLAG_CATALOG.slice(0, 24)];
const DIFFICULTY_LABELS: Record<RoomDifficulty, string> = {
  easy: "Easy (24 countries)",
  medium: "Medium (36 countries)",
  hard: "Hard (48 countries)",
  "007": "007 (Full list)"
};

const MAP_WIDTH = 2000;
const MAP_HEIGHT = 857;
const PRIME_MERIDIAN_X = MAP_WIDTH / 2;
const EQUATOR_Y = MAP_HEIGHT / 2;
const MAP_GRID_VERTICAL_STEP = MAP_WIDTH / 10;
const MAP_GRID_HORIZONTAL_STEP = MAP_HEIGHT / 5;
const CHAMPIONSHIP_TARGET_WINS = 3;
const MAP_FLAG_PREVIEW_DELAY_MS = 500;
const MAP_FLAG_PREVIEW_TOUCH_MOVE_TOLERANCE_PX = 12;

function buildCenteredGridPositions(center: number, step: number, limit: number): number[] {
  const positions = [Number(center.toFixed(1))];

  for (let offset = step; center - offset > 0 || center + offset < limit; offset += step) {
    const negative = Number((center - offset).toFixed(1));
    const positive = Number((center + offset).toFixed(1));

    if (negative > 0) {
      positions.push(negative);
    }

    if (positive < limit) {
      positions.push(positive);
    }
  }

  return positions;
}

function formatMapGridCoordinate(coordinate: number): string {
  return coordinate.toFixed(1).replace(/\.0$/, "");
}

const MAP_GRID_VERTICAL_POSITIONS = buildCenteredGridPositions(PRIME_MERIDIAN_X, MAP_GRID_VERTICAL_STEP, MAP_WIDTH);
const MAP_GRID_HORIZONTAL_POSITIONS = buildCenteredGridPositions(EQUATOR_Y, MAP_GRID_HORIZONTAL_STEP, MAP_HEIGHT);
const EXPANDED_HIDDEN_COUNTRY_INTEL_WIDTH = 820;
const EXPANDED_HIDDEN_COUNTRY_INTEL_HEIGHT = 720;

type ViewportSize = {
  width: number;
  height: number;
};

function getViewportSize(): ViewportSize {
  if (typeof window === "undefined") {
    return { width: 1280, height: 800 };
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight
  };
}

function getCenteredPanY(viewportHeight: number, zoomLevel: number): number {
  const mapHeight = MAP_HEIGHT * zoomLevel;
  if (mapHeight >= viewportHeight) {
    return 0;
  }

  return Math.round((viewportHeight - mapHeight) / 2);
}

function getDefaultMapPan(viewportWidth: number, viewportHeight: number): { x: number; y: number } {
  return {
    x: Math.round((viewportWidth - MAP_WIDTH) / 2),
    y: getCenteredPanY(viewportHeight, 1)
  };
}

function clampMapPanY(candidateY: number, zoomLevel: number, viewportHeight: number): number {
  const mapHeight = MAP_HEIGHT * zoomLevel;

  if (mapHeight <= viewportHeight) {
    return getCenteredPanY(viewportHeight, zoomLevel);
  }

  const minY = viewportHeight - mapHeight;
  return Math.max(minY, Math.min(0, candidateY));
}

function toFlagImage(flagCode: string): string {
  return `https://flagcdn.com/w80/${flagCode}.png`;
}

function formatTurnState(turnState: TurnState | null): string {
  return turnState ? turnState.replace(/-/g, " ") : "pending";
}

function formatRoundReason(reason: RoundOverPayload["reason"]): string {
  return reason === "correct-guess" ? "Correct guess" : "Wrong guess";
}

function formatDifficultyLabel(difficulty: RoomDifficulty): string {
  return DIFFICULTY_LABELS[difficulty];
}

function getMapFlagPreviewAlignment(marker: { x: number; y: number }): MapFlagPreviewAlignment {
  if (marker.x < 180) {
    return "start";
  }

  if (marker.x > MAP_WIDTH - 180) {
    return "end";
  }

  return "center";
}

function getMapFlagPreviewPlacement(marker: { x: number; y: number }): MapFlagPreviewPlacement {
  return marker.y < 170 ? "below" : "above";
}

function isMapFlagMarkerTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest(".map-flag-marker"));
}

function appendAskedQuestionHistoryEntry(
  history: AskedQuestionHistoryEntry[],
  question: string,
  nextEntryId: number
): AskedQuestionHistoryEntry[] {
  const lastEntry = history[history.length - 1];
  if (lastEntry && lastEntry.question === question && lastEntry.answer === null) {
    return history;
  }

  return [...history.slice(-7), { id: nextEntryId, question, answer: null }];
}

function resolveAskedQuestionHistoryAnswer(
  history: AskedQuestionHistoryEntry[],
  payload: QuestionAnsweredPayload
): AskedQuestionHistoryEntry[] {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry.answer === null && entry.question === payload.question) {
      const nextHistory = [...history];
      nextHistory[index] = { ...entry, answer: payload.answer };
      return nextHistory;
    }
  }

  return history;
}

function fallbackMarkerForFlag(flagCode: string): { x: number; y: number } {
  let hash = 2166136261;
  for (const char of flagCode) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  const normalized = (hash >>> 0) / 4294967295;
  const normalizedSecondary = ((hash >>> 9) ^ (hash >>> 3)) / 4294967295;
  return {
    x: Math.round(140 + normalized * (MAP_WIDTH - 280)),
    y: Math.round(120 + normalizedSecondary * (MAP_HEIGHT - 220))
  };
}

function getMarkerForFlag(flagCode: string, markerPositions: FlagMarkerPositions): { x: number; y: number } {
  return markerPositions[flagCode] ?? fallbackMarkerForFlag(flagCode);
}

type FlagMarkerProps = {
  flagCode: string;
  marker: { x: number; y: number };
  isEliminated: boolean;
  canEditBoard: boolean;
  isPreviewActive: boolean;
  isPreviewExpanded: boolean;
  previewAlignment: MapFlagPreviewAlignment;
  previewPlacement: MapFlagPreviewPlacement;
  onMarkerClick: (flagCode: string) => void;
  onPreviewStart: (flagCode: string, intent: MapFlagPreviewIntent) => void;
  onPreviewEnd: (flagCode: string) => void;
  onPreviewTouchMove: (flagCode: string, clientX: number, clientY: number) => void;
  onPreviewTouchStart: (flagCode: string, clientX: number, clientY: number) => void;
  onPreviewTouchEnd: (flagCode: string) => void;
};

const FlagMarker = memo(function FlagMarker({
  flagCode,
  marker,
  isEliminated,
  canEditBoard,
  isPreviewActive,
  isPreviewExpanded,
  previewAlignment,
  previewPlacement,
  onMarkerClick,
  onPreviewStart,
  onPreviewEnd,
  onPreviewTouchMove,
  onPreviewTouchStart,
  onPreviewTouchEnd
}: FlagMarkerProps) {
  const markerClassName = [
    "map-flag-marker",
    isPreviewActive ? "map-flag-marker-active" : "",
    isPreviewExpanded ? "map-flag-marker-expanded" : "",
    previewAlignment === "start" ? "map-flag-marker-preview-start" : "",
    previewAlignment === "end" ? "map-flag-marker-preview-end" : "",
    previewPlacement === "below" ? "map-flag-marker-preview-below" : ""
  ].filter(Boolean).join(" ");
  const buttonClassName = [
    "flag-card",
    "map-flag-card",
    isEliminated ? "flag-card-eliminated" : "",
    isPreviewActive ? "map-flag-card-preview-active" : "",
    isPreviewExpanded ? "map-flag-card-preview-expanded" : ""
  ].filter(Boolean).join(" ");

  return (
    <div
      className={markerClassName}
      data-flag-code={flagCode}
      style={{
        left: `${marker.x}px`,
        top: `${marker.y}px`,
        pointerEvents: "auto"
      } as CSSProperties}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
      onMouseDown={(event) => {
        event.stopPropagation();
      }}
      onMouseEnter={() => {
        onPreviewStart(flagCode, "hover");
      }}
      onMouseLeave={() => {
        onPreviewEnd(flagCode);
      }}
      onTouchStart={(event) => {
        event.stopPropagation();

        if (event.touches.length !== 1) {
          onPreviewEnd(flagCode);
          return;
        }

        const touch = event.touches[0];
        if (!touch) {
          return;
        }
        onPreviewTouchStart(flagCode, touch.clientX, touch.clientY);
      }}
      onTouchMove={(event) => {
        event.stopPropagation();

        if (event.touches.length !== 1) {
          onPreviewEnd(flagCode);
          return;
        }

        const touch = event.touches[0];
        if (!touch) {
          return;
        }
        onPreviewTouchMove(flagCode, touch.clientX, touch.clientY);
      }}
      onTouchEnd={(event) => {
        event.stopPropagation();
        onPreviewTouchEnd(flagCode);
      }}
      onTouchCancel={(event) => {
        event.stopPropagation();
        onPreviewEnd(flagCode);
      }}
    >
      <button
        className={buttonClassName}
        type="button"
        aria-label={flagCode.toUpperCase()}
        tabIndex={0}
        onBlur={() => {
          onPreviewEnd(flagCode);
        }}
        onClick={() => {
          onMarkerClick(flagCode);
        }}
        onFocus={() => {
          onPreviewStart(flagCode, "focus");
        }}
        disabled={!canEditBoard}
      >
        <img src={toFlagImage(flagCode)} alt={flagCode.toUpperCase()} loading="lazy" />
        <span>{flagCode.toUpperCase()}</span>
      </button>

      {isPreviewExpanded ? <CompactCountryInfobox flagCode={flagCode} dataTestId="map-flag-preview" /> : null}
    </div>
  );
}, (previousProps, nextProps) => {
  return previousProps.flagCode === nextProps.flagCode
    && previousProps.marker.x === nextProps.marker.x
    && previousProps.marker.y === nextProps.marker.y
    && previousProps.isEliminated === nextProps.isEliminated
    && previousProps.canEditBoard === nextProps.canEditBoard
    && previousProps.isPreviewActive === nextProps.isPreviewActive
    && previousProps.isPreviewExpanded === nextProps.isPreviewExpanded
    && previousProps.previewAlignment === nextProps.previewAlignment
    && previousProps.previewPlacement === nextProps.previewPlacement;
});

function WorldMapBackdrop() {
  return (
    <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} className="world-map-svg" aria-hidden="true" focusable="false">
      <image className="map-source-image" href="/world.svg" x="0" y="0" width={MAP_WIDTH} height={MAP_HEIGHT} />
      <g className="map-grid">
        {MAP_GRID_VERTICAL_POSITIONS.map((coordinate) => (
          <path key={`grid-v-${coordinate}`} d={`M${formatMapGridCoordinate(coordinate)} 0v${MAP_HEIGHT}`} />
        ))}
        {MAP_GRID_HORIZONTAL_POSITIONS.map((coordinate) => (
          <path key={`grid-h-${coordinate}`} d={`M0 ${formatMapGridCoordinate(coordinate)}h${MAP_WIDTH}`} />
        ))}
      </g>
    </svg>
  );
}

export function App() {
  const initialViewportSize = getViewportSize();
  const initialMapPan = getDefaultMapPan(initialViewportSize.width, initialViewportSize.height);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("Disconnected");
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [seat, setSeat] = useState<RoomCreatedPayload["seat"] | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [gameInfo, setGameInfo] = useState<GameStartedPayload | null>(null);
  const [lobby, setLobby] = useState<LobbyState>({ roomCodeInput: "", displayName: "" });
  const [selectedDifficulty, setSelectedDifficulty] = useState<RoomDifficulty>("easy");
  const [roomDifficulty, setRoomDifficulty] = useState<RoomDifficulty>("easy");
  const [turnState, setTurnState] = useState<TurnState | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [incomingQuestion, setIncomingQuestion] = useState<string | null>(null);
  const [askedQuestionHistory, setAskedQuestionHistory] = useState<AskedQuestionHistoryEntry[]>([]);
  const [eliminatedCodes, setEliminatedCodes] = useState<string[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessageEventPayload[]>([]);
  const [roundResult, setRoundResult] = useState<RoundOverPayload | null>(null);
  const [score, setScore] = useState<Record<string, number>>({});
  const [matchWinnerId, setMatchWinnerId] = useState<string | null>(null);
  const [isRoundTransitioning, setIsRoundTransitioning] = useState(false);
  const [guessFlagCode, setGuessFlagCode] = useState<string>(DEFAULT_FLAG_CODES[0]);
  const [isGuessPickerOpen, setIsGuessPickerOpen] = useState(false);
  const [isGuessModalOpen, setIsGuessModalOpen] = useState(false);
  const [isRulesModalOpen, setIsRulesModalOpen] = useState(false);
  const [isCreditsModalOpen, setIsCreditsModalOpen] = useState(false);
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [toastMessages, setToastMessages] = useState<ToastMessage[]>([]);
  const [pendingQuestionText, setPendingQuestionText] = useState<string | null>(null);
  const [pendingGuessCode, setPendingGuessCode] = useState<string | null>(null);
  const [nextRoundDeadlineMs, setNextRoundDeadlineMs] = useState<number | null>(null);
  const [nextRoundCountdownMs, setNextRoundCountdownMs] = useState<number | null>(null);
  const [recentBoardChange, setRecentBoardChange] = useState<RecentBoardChange>(null);
  const [roundRevealPhase, setRoundRevealPhase] = useState<RoundRevealPhase>("hidden");
  const [scorePulseTarget, setScorePulseTarget] = useState<ScorePulseTarget>(null);
  const [composerModePreview, setComposerModePreview] = useState<"chat" | "question">("chat");
  const [viewportSize, setViewportSize] = useState<ViewportSize>(initialViewportSize);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(initialMapPan);
  const [isPanning, setIsPanning] = useState(false);
  const [previewedFlagCode, setPreviewedFlagCode] = useState<string | null>(null);
  const [expandedPreviewFlagCode, setExpandedPreviewFlagCode] = useState<string | null>(null);
  const [isHiddenCountryExpanded, setIsHiddenCountryExpanded] = useState(false);
  const [isRoundConsoleExpanded, setIsRoundConsoleExpanded] = useState(true);
  const [desktopWindows, setDesktopWindows] = useState(() => loadPersistedDesktopWindows(initialViewportSize.width, initialViewportSize.height));
  const [collapsedWindows, setCollapsedWindows] = useState<CollapsedWindowsState>({ intel: false, chat: false });
  const flagMarkerPositions: FlagMarkerPositions = WORLD_MAP_MARKER_POSITIONS;
  const mapViewportRef = useRef<HTMLDivElement | null>(null);
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const guessModalRef = useRef<HTMLDivElement | null>(null);
  const rulesModalRef = useRef<HTMLDivElement | null>(null);
  const creditsModalRef = useRef<HTMLDivElement | null>(null);
  const guessPickerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const guessPickerOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const guessPickerTypeaheadRef = useRef("");
  const guessPickerTypeaheadTimerRef = useRef<number | null>(null);
  const panStartRef = useRef({ x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const mapFlagPreviewTimerRef = useRef<number | null>(null);
  const mapFlagTouchPressRef = useRef<{ flagCode: string; clientX: number; clientY: number } | null>(null);
  const suppressNextMapFlagClickRef = useRef<string | null>(null);
  const pinchDistanceRef = useRef<number | null>(null);
  const inviteStatusTimerRef = useRef<number | null>(null);
  const toastTimersRef = useRef<number[]>([]);
  const feedbackResetTimerRef = useRef<number | null>(null);
  const roundRevealImpactTimerRef = useRef<number | null>(null);
  const roundRevealSettledTimerRef = useRef<number | null>(null);
  const scorePulseTimerRef = useRef<number | null>(null);
  const toastIdRef = useRef(0);
  const playerIdRef = useRef<string | null>(null);
  const pendingQuestionRef = useRef<string | null>(null);
  const askedQuestionHistoryIdRef = useRef(0);
  const scoreRef = useRef<Record<string, number>>({});
  const zoomRef = useRef(1);
  const panRef = useRef(initialMapPan);
  const pendingViewportStateRef = useRef<{ zoom: number; pan: { x: number; y: number } } | null>(null);
  const viewportFrameRef = useRef<number | null>(null);

  const triggerHaptic = (pattern: number | number[]) => {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
      return;
    }

    navigator.vibrate(pattern);
  };

  const pushToast = (text: string, tone: ToastTone = "info") => {
    const id = toastIdRef.current + 1;
    toastIdRef.current = id;
    setToastMessages((messages) => [...messages.slice(-3), { id, text, tone }]);

    const timer = window.setTimeout(() => {
      setToastMessages((messages) => messages.filter((message) => message.id !== id));
      toastTimersRef.current = toastTimersRef.current.filter((activeTimer) => activeTimer !== timer);
    }, 2600);

    toastTimersRef.current.push(timer);
  };

  const pulseConfirmedFlag = (flagCode: string, eliminated: boolean) => {
    setRecentBoardChange({ flagCode, eliminated });
    if (feedbackResetTimerRef.current) {
      window.clearTimeout(feedbackResetTimerRef.current);
    }
    feedbackResetTimerRef.current = window.setTimeout(() => {
      setRecentBoardChange(null);
    }, 1100);
  };

  const clearRoundRevealTimers = () => {
    if (roundRevealImpactTimerRef.current) {
      window.clearTimeout(roundRevealImpactTimerRef.current);
      roundRevealImpactTimerRef.current = null;
    }
    if (roundRevealSettledTimerRef.current) {
      window.clearTimeout(roundRevealSettledTimerRef.current);
      roundRevealSettledTimerRef.current = null;
    }
  };

  const pulseScore = (target: ScorePulseTarget) => {
    if (!target) {
      return;
    }

    setScorePulseTarget(target);
    if (scorePulseTimerRef.current) {
      window.clearTimeout(scorePulseTimerRef.current);
    }
    scorePulseTimerRef.current = window.setTimeout(() => {
      setScorePulseTarget(null);
      scorePulseTimerRef.current = null;
    }, 820);
  };

  const patchGameInfo = (patch: Partial<GameStartedPayload>) => {
    setGameInfo((current) => (current ? { ...current, ...patch } : current));
  };

  const applyViewportState = (nextZoom: number, nextPan: { x: number; y: number }) => {
    zoomRef.current = nextZoom;
    panRef.current = nextPan;
    setZoom(nextZoom);
    setPan(nextPan);
  };

  const scheduleViewportState = (nextZoom: number, nextPan: { x: number; y: number }) => {
    pendingViewportStateRef.current = { zoom: nextZoom, pan: nextPan };

    if (viewportFrameRef.current !== null) {
      return;
    }

    viewportFrameRef.current = window.requestAnimationFrame(() => {
      viewportFrameRef.current = null;
      const pendingViewportState = pendingViewportStateRef.current;
      pendingViewportStateRef.current = null;

      if (!pendingViewportState) {
        return;
      }

      applyViewportState(pendingViewportState.zoom, pendingViewportState.pan);
    });
  };

  useEffect(() => {
    return () => {
      if (viewportFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const roomFromQuery = new URLSearchParams(window.location.search).get("room");
    if (!roomFromQuery) {
      return;
    }

    const sanitized = roomFromQuery.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!sanitized) {
      return;
    }

    setLobby((state) => {
      if (state.roomCodeInput) {
        return state;
      }

      return {
        ...state,
        roomCodeInput: sanitized
      };
    });
  }, []);

  useEffect(() => {
    return () => {
      if (inviteStatusTimerRef.current) {
        window.clearTimeout(inviteStatusTimerRef.current);
      }
      if (guessPickerTypeaheadTimerRef.current) {
        window.clearTimeout(guessPickerTypeaheadTimerRef.current);
      }
      if (feedbackResetTimerRef.current) {
        window.clearTimeout(feedbackResetTimerRef.current);
      }
      if (scorePulseTimerRef.current) {
        window.clearTimeout(scorePulseTimerRef.current);
      }
      clearRoundRevealTimers();
      for (const timer of toastTimersRef.current) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  useEffect(() => {
    playerIdRef.current = playerId;
  }, [playerId]);

  useEffect(() => {
    pendingQuestionRef.current = pendingQuestionText;
  }, [pendingQuestionText]);

  useEffect(() => {
    if (!nextRoundDeadlineMs) {
      setNextRoundCountdownMs(null);
      return;
    }

    const updateCountdown = () => {
      const remaining = Math.max(0, nextRoundDeadlineMs - Date.now());
      setNextRoundCountdownMs(remaining);
    };

    updateCountdown();
    const interval = window.setInterval(updateCountdown, 100);
    return () => {
      window.clearInterval(interval);
    };
  }, [nextRoundDeadlineMs]);

  useEffect(() => {
    socket.connect();

    const onConnect = () => {
      setConnected(true);
      setStatus("Connected to server");
      pushToast("Uplink restored.", "success");
    };

    const onDisconnect = () => {
      setConnected(false);
      setStatus("Disconnected");
      pushToast("Signal dropped. Re-establishing uplink.", "warning");
    };

    const onConnectError = () => {
      setStatus("Connection lost. Retrying...");
    };

    const onReconnectAttempt = (attempt: number) => {
      setStatus(`Reconnecting (attempt ${attempt})...`);
    };

    const onReconnectFailed = () => {
      setStatus("Unable to reconnect to server.");
      pushToast("Reconnect failed. Refresh or create a new room.", "error");
    };

    const surfaceDesktopWindow = (windowId: DesktopWindowId) => {
      const nextViewportSize = getViewportSize();
      setDesktopWindows((currentWindows) => raiseDesktopWindow(
        normalizeDesktopWindows(currentWindows, nextViewportSize.width, nextViewportSize.height),
        windowId
      ));
    };

    const manager = socket.io;

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    manager?.on("reconnect_attempt", onReconnectAttempt);
    manager?.on("reconnect_failed", onReconnectFailed);

    socket.on(SERVER_TO_CLIENT.ROOM_CREATED, (payload: RoomCreatedPayload) => {
      setPlayerId(payload.playerId);
      playerIdRef.current = payload.playerId;
      setSeat(payload.seat);
      setRoomCode(payload.roomCode);
      setRoomDifficulty(payload.difficulty);
      surfaceDesktopWindow("chat");
      setStatus(`Room ${payload.roomCode} created. Waiting for opponent.`);
      pushToast(`Room ${payload.roomCode} is live. Waiting for rival.`, "success");
    });

    socket.on(SERVER_TO_CLIENT.ROOM_JOINED, (payload: RoomCreatedPayload) => {
      setPlayerId(payload.playerId);
      playerIdRef.current = payload.playerId;
      setSeat(payload.seat);
      setRoomCode(payload.roomCode);
      setRoomDifficulty(payload.difficulty);
      surfaceDesktopWindow("chat");
      setStatus(`Joined room ${payload.roomCode}. Starting game...`);
      pushToast(`Joined room ${payload.roomCode}. Syncing mission.`, "success");
    });

    socket.on(SERVER_TO_CLIENT.GAME_STARTED, (payload: GameStartedPayload) => {
      setGameInfo(payload);
      setTurnState("awaiting-question");
      setEliminatedCodes(payload.yourBoardState.eliminatedFlagCodes);
      surfaceDesktopWindow("chat");
      setIncomingQuestion(null);
      setAskedQuestionHistory([]);
      askedQuestionHistoryIdRef.current = 0;
      setRoundResult(null);
      setMatchWinnerId(null);
      setIsRoundTransitioning(false);
      setIsGuessModalOpen(false);
      setPendingQuestionText(null);
      setPendingGuessCode(null);
      setNextRoundDeadlineMs(null);
      setNextRoundCountdownMs(null);
      setRecentBoardChange(null);
      setRoundRevealPhase("hidden");
      setScorePulseTarget(null);
      scoreRef.current = score;
      setGuessFlagCode(payload.availableFlagCodes[0] ?? DEFAULT_FLAG_CODES[0]);
      setStatus("Game started");
      pushToast(`Round ${payload.roundNumber} is live.`, "success");
    });

    socket.on(SERVER_TO_CLIENT.NEW_GAME_STARTED, (payload: GameStartedPayload) => {
      setGameInfo(payload);
      setTurnState("awaiting-question");
      setEliminatedCodes(payload.yourBoardState.eliminatedFlagCodes);
      surfaceDesktopWindow("chat");
      setIncomingQuestion(null);
      setAskedQuestionHistory([]);
      askedQuestionHistoryIdRef.current = 0;
      setRoundResult(null);
      setScore({});
      setMatchWinnerId(null);
      setIsRoundTransitioning(false);
      setIsGuessModalOpen(false);
      setPendingQuestionText(null);
      setPendingGuessCode(null);
      setNextRoundDeadlineMs(null);
      setNextRoundCountdownMs(null);
      setRecentBoardChange(null);
      setRoundRevealPhase("hidden");
      setScorePulseTarget(null);
      scoreRef.current = {};
      setGuessFlagCode(payload.availableFlagCodes[0] ?? DEFAULT_FLAG_CODES[0]);
      setStatus("New game started");
      pushToast("Rematch deployed. New intel assigned.", "success");
    });

    socket.on(SERVER_TO_CLIENT.TURN_STATE_CHANGED, (payload: { state: TurnState }) => {
      setTurnState(payload.state);
      if (payload.state === "awaiting-answer" && pendingQuestionRef.current) {
        pushToast("Question delivered. Awaiting answer.", "success");
        setPendingQuestionText(null);
      }
    });

    socket.on(SERVER_TO_CLIENT.QUESTION_ACCEPTED, (payload: QuestionAcceptedPayload) => {
      setPendingQuestionText(null);
      askedQuestionHistoryIdRef.current += 1;
      setAskedQuestionHistory((history) => appendAskedQuestionHistoryEntry(history, payload.question, askedQuestionHistoryIdRef.current));
      pushToast(`Question accepted: ${payload.question}`, "success");
    });

    socket.on(SERVER_TO_CLIENT.TURN_ENDED, (payload: { nextActivePlayerId: string }) => {
      patchGameInfo({ activePlayerId: payload.nextActivePlayerId });
      playTurnChange();
      if (payload.nextActivePlayerId === playerIdRef.current) {
        pushToast("Your turn begins.", "success");
        triggerHaptic(20);
      } else {
        pushToast("Turn handed to opponent.", "info");
      }
    });

    socket.on(SERVER_TO_CLIENT.INCOMING_QUESTION, (payload: IncomingQuestionPayload) => {
      setIncomingQuestion(payload.question);
      playIncomingQuestion();
      pushToast("Incoming interrogation.", "warning");
      triggerHaptic([18, 30, 18]);
    });

    socket.on(SERVER_TO_CLIENT.QUESTION_ANSWERED, (payload: QuestionAnsweredPayload) => {
      setAskedQuestionHistory((history) => resolveAskedQuestionHistoryAnswer(history, payload));
      setIncomingQuestion(null);
      if (payload.answeredByPlayerId === playerIdRef.current) {
        pushToast(`Answer sent: ${payload.answer.toUpperCase()}.`, "success");
      } else {
        pushToast(`Answer received: ${payload.answer.toUpperCase()}.`, "success");
      }
    });

    socket.on(SERVER_TO_CLIENT.BOARD_UPDATED, (payload: BoardUpdatedPayload) => {
      setEliminatedCodes((previousCodes) => {
        const nextCodes = payload.eliminatedFlagCodes;
        const addedCode = nextCodes.find((flagCode) => !previousCodes.includes(flagCode)) ?? null;
        const removedCode = previousCodes.find((flagCode) => !nextCodes.includes(flagCode)) ?? null;
        if (addedCode) {
          pulseConfirmedFlag(addedCode, true);
          pushToast(`${addedCode.toUpperCase()} eliminated from your board.`, "success");
          triggerHaptic(14);
        } else if (removedCode) {
          pulseConfirmedFlag(removedCode, false);
          pushToast(`${removedCode.toUpperCase()} restored to active board.`, "info");
          triggerHaptic(10);
        }
        return nextCodes;
      });
    });

    socket.on(SERVER_TO_CLIENT.CHAT_MESSAGE, (payload: ChatMessageEventPayload) => {
      setChatMessages((messages) => [...messages.slice(-39), payload]);
    });

    socket.on(SERVER_TO_CLIENT.GUESS_LOCKED, (payload: GuessLockedPayload) => {
      setPendingGuessCode(payload.guessedFlagCode);
      pushToast(`Guess locked: ${payload.guessedFlagCode.toUpperCase()}.`, "warning");
    });

    socket.on(SERVER_TO_CLIENT.SYNC_STATE, (payload: SyncStatePayload) => {
      if (payload.turnState) {
        setTurnState(payload.turnState);
      }
      if (payload.activePlayerId) {
        patchGameInfo({ activePlayerId: payload.activePlayerId });
      }
      if (payload.yourBoardState) {
        setEliminatedCodes(payload.yourBoardState.eliminatedFlagCodes);
      }
    });

    socket.on(SERVER_TO_CLIENT.ROUND_OVER, (payload: RoundOverPayload) => {
      clearRoundRevealTimers();
      setRoundResult(payload);
      setTurnState("round-over");
      setIsRoundTransitioning(true);
      setIsGuessModalOpen(false);
      setPendingQuestionText(null);
      setPendingGuessCode(null);
      setStatus(`Round over: ${payload.reason}`);
      setRoundRevealPhase("impact");
      playRoundOver();
      roundRevealImpactTimerRef.current = window.setTimeout(() => {
        setRoundRevealPhase("secrets");
      }, 260);
      roundRevealSettledTimerRef.current = window.setTimeout(() => {
        setRoundRevealPhase("settled");
      }, 820);
      if (payload.reason === "correct-guess") {
        setTimeout(playCorrectGuess, 300);
      } else {
        setTimeout(playWrongGuess, 300);
      }
      if (payload.winnerPlayerId === playerIdRef.current) {
        pushToast(payload.reason === "correct-guess" ? "Round secured with a correct guess." : "Opponent guessed wrong. Round secured.", "success");
      } else {
        pushToast(payload.reason === "wrong-guess" ? "Wrong guess. Round lost." : "Opponent identified your flag.", "error");
      }
    });

    socket.on(SERVER_TO_CLIENT.NEXT_ROUND_PENDING, (payload: NextRoundPendingPayload) => {
      setIsRoundTransitioning(true);
      setNextRoundDeadlineMs(Date.now() + payload.nextRoundStartsInMs);
      setNextRoundCountdownMs(payload.nextRoundStartsInMs);
      pushToast(`Round ${payload.upcomingRoundNumber} incoming.`, "info");
    });

    socket.on(SERVER_TO_CLIENT.SCORE_UPDATED, (payload: { matchScore: Record<string, number> }) => {
      const currentPlayerId = playerIdRef.current;
      const previousScore = scoreRef.current;
      if (currentPlayerId) {
        const previousSelf = previousScore[currentPlayerId] ?? 0;
        const nextSelf = payload.matchScore[currentPlayerId] ?? 0;
        const previousOpponent = Object.entries(previousScore)
          .filter(([scorePlayerId]) => scorePlayerId !== currentPlayerId)
          .reduce((sum, [, value]) => sum + value, 0);
        const nextOpponent = Object.entries(payload.matchScore)
          .filter(([scorePlayerId]) => scorePlayerId !== currentPlayerId)
          .reduce((sum, [, value]) => sum + value, 0);

        if (nextSelf > previousSelf) {
          pulseScore("self");
        } else if (nextOpponent > previousOpponent) {
          pulseScore("opponent");
        }
      }
      scoreRef.current = payload.matchScore;
      setScore(payload.matchScore);
    });

    socket.on(SERVER_TO_CLIENT.MATCH_OVER, (payload: { winnerPlayerId: string | null }) => {
      setMatchWinnerId(payload.winnerPlayerId ?? null);
      setIsRoundTransitioning(false);
      setNextRoundDeadlineMs(null);
      setNextRoundCountdownMs(null);
      setRoundRevealPhase("settled");
      setStatus("Match over");
      pushToast(
        payload.winnerPlayerId === playerIdRef.current ? "Championship secured." : "Opponent secured the match.",
        payload.winnerPlayerId === playerIdRef.current ? "success" : "warning"
      );
    });

    socket.on(SERVER_TO_CLIENT.ACTION_ERROR, (payload: ActionErrorPayload) => {
      setStatus(`Error: ${payload.code} - ${payload.message}`);
      pushToast(payload.message, "error");
    });

    return () => {
      socket.off?.("connect", onConnect);
      socket.off?.("disconnect", onDisconnect);
      socket.off?.("connect_error", onConnectError);
      manager?.off("reconnect_attempt", onReconnectAttempt);
      manager?.off("reconnect_failed", onReconnectFailed);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, []);

  const canJoin = useMemo(() => lobby.roomCodeInput.trim().length > 0, [lobby.roomCodeInput]);

  const inviteLink = useMemo(() => {
    if (!roomCode) {
      return "";
    }

    const inviteUrl = new URL(window.location.href);
    inviteUrl.searchParams.set("room", roomCode);
    return inviteUrl.toString();
  }, [roomCode]);

  const createRoom = () => {
    playButtonClick();
    pushToast("Creating room...", "info");
    socket.emit(CLIENT_TO_SERVER.CREATE_ROOM, {
      displayName: lobby.displayName || undefined,
      difficulty: selectedDifficulty
    });
  };

  const joinRoom = () => {
    playButtonClick();
    pushToast(`Joining room ${lobby.roomCodeInput.trim().toUpperCase()}...`, "info");
    socket.emit(CLIENT_TO_SERVER.JOIN_ROOM, {
      roomCode: lobby.roomCodeInput.trim().toUpperCase(),
      displayName: lobby.displayName || undefined
    });
  };

  const onDisplayNameChange = (event: ChangeEvent<HTMLInputElement>) => {
    setLobby((state) => ({ ...state, displayName: event.target.value }));
  };

  const onRoomCodeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const sanitized = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    setLobby((state) => ({ ...state, roomCodeInput: sanitized }));
  };

  const isYourTurn = !!(gameInfo && playerId && gameInfo.activePlayerId === playerId);
  const activeFlagCodes = gameInfo?.availableFlagCodes.length ? gameInfo.availableFlagCodes : DEFAULT_FLAG_CODES;
  const canAsk = !!(gameInfo && isYourTurn && turnState === "awaiting-question");
  const canAnswer = !!(gameInfo && !isYourTurn && turnState === "awaiting-answer" && incomingQuestion);
  const canEditBoard = !!(gameInfo && turnState && turnState !== "round-over");
  const canEndTurn = !!(gameInfo && isYourTurn && turnState === "awaiting-asker-actions");
  const canGuess = !!(
    gameInfo &&
    isYourTurn &&
    (turnState === "awaiting-question" || turnState === "awaiting-asker-actions")
  );

  useEffect(() => {
    const nextGuessOptions = activeFlagCodes.filter((flagCode) => !eliminatedCodes.includes(flagCode));
    const fallbackOptions = nextGuessOptions.length > 0 ? nextGuessOptions : activeFlagCodes;
    if (!fallbackOptions.includes(guessFlagCode)) {
      setGuessFlagCode(fallbackOptions[0]);
    }
  }, [activeFlagCodes, eliminatedCodes, guessFlagCode]);

  useEffect(() => {
    if (!canGuess) {
      setIsGuessModalOpen(false);
      setIsGuessPickerOpen(false);
    }
  }, [canGuess]);

  useEffect(() => {
    if (!isGuessModalOpen) {
      return;
    }

    const modal = guessModalRef.current;
    if (!modal) {
      return;
    }

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const getFocusableElements = () => Array.from(
      modal.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
      )
    );

    window.setTimeout(() => {
      const focusable = getFocusableElements();
      if (focusable.length > 0) {
        focusable[0].focus();
      }
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeGuessModal();
        previouslyFocused?.focus();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = getFocusableElements();
      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
        return;
      }

      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeGuessModal, isGuessModalOpen]);

  useEffect(() => {
    if (!isRulesModalOpen) {
      return;
    }

    const modal = rulesModalRef.current;
    if (!modal) {
      return;
    }

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const getFocusableElements = () => Array.from(
      modal.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
      )
    );

    window.setTimeout(() => {
      const focusable = getFocusableElements();
      if (focusable.length > 0) {
        focusable[0].focus();
      }
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsRulesModalOpen(false);
        previouslyFocused?.focus();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = getFocusableElements();
      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
        return;
      }

      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isRulesModalOpen]);

  useEffect(() => {
    if (!isCreditsModalOpen) {
      return;
    }

    const modal = creditsModalRef.current;
    if (!modal) {
      return;
    }

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const getFocusableElements = () => Array.from(
      modal.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
      )
    );

    window.setTimeout(() => {
      const focusable = getFocusableElements();
      if (focusable.length > 0) {
        focusable[0].focus();
      }
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsCreditsModalOpen(false);
        previouslyFocused?.focus();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = getFocusableElements();
      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
        return;
      }

      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isCreditsModalOpen]);

  useEffect(() => {
    if (!chatListRef.current) {
      return;
    }
    chatListRef.current.scrollTop = chatListRef.current.scrollHeight;
  }, [chatMessages]);

  const askQuestion = () => {
    if (!canAsk || !messageInput.trim()) {
      return;
    }
    const trimmedQuestion = messageInput.trim();
    playButtonClick();
    setPendingQuestionText(trimmedQuestion);
    pushToast("Sending question...", "info");
    socket.emit(CLIENT_TO_SERVER.ASK_QUESTION, { question: trimmedQuestion });
    setMessageInput("");
  };

  const answerQuestion = (answer: "yes" | "no") => {
    if (!canAnswer) {
      return;
    }
    playButtonClick();
    pushToast(`Answering ${answer.toUpperCase()}...`, "info");
    triggerHaptic(12);
    socket.emit(CLIENT_TO_SERVER.ANSWER_QUESTION, { answer });
  };

  const setFlagElimination = (flagCode: string) => {
    if (!canEditBoard) {
      return;
    }
    const eliminated = !eliminatedCodes.includes(flagCode);
    playButtonClick();
    triggerHaptic(10);
    socket.emit(CLIENT_TO_SERVER.SET_FLAG_ELIMINATION, { flagCode, eliminated });
  };

  const endTurn = () => {
    if (!canEndTurn) {
      return;
    }
    playButtonClick();
    pushToast("Ending turn...", "info");
    socket.emit(CLIENT_TO_SERVER.END_TURN, {});
  };

  const sendChat = () => {
    if (!messageInput.trim()) {
      return;
    }
    const trimmedChat = messageInput.trim();
    playButtonClick();
    pushToast("Transmitting chat...", "info");
    socket.emit(CLIENT_TO_SERVER.CHAT_MESSAGE, { text: trimmedChat });
    setMessageInput("");
  };

  function closeGuessModal() {
    setIsGuessPickerOpen(false);
    setIsGuessModalOpen(false);
  }

  const makeGuess = () => {
    if (!canGuess) {
      return;
    }
    playButtonClick();
    setPendingGuessCode(guessFlagCode);
    pushToast("Submitting guess...", "warning");
    triggerHaptic([16, 40, 16]);
    socket.emit(CLIENT_TO_SERVER.MAKE_GUESS, { guessedFlagCode: guessFlagCode });
    closeGuessModal();
  };

  const startNewGame = () => {
    playButtonClick();
    socket.emit(CLIENT_TO_SERVER.NEW_GAME, {});
  };

  const openGuessModal = () => {
    if (!canGuess) {
      return;
    }
    playButtonClick();
    setIsGuessPickerOpen(false);
    setIsGuessModalOpen(true);
  };

  const closeRulesModal = () => {
    setIsRulesModalOpen(false);
  };

  const openRulesModal = () => {
    playButtonClick();
    setIsCreditsModalOpen(false);
    setIsRulesModalOpen(true);
  };

  const closeCreditsModal = () => {
    setIsCreditsModalOpen(false);
  };

  const openCreditsModal = () => {
    playButtonClick();
    setIsRulesModalOpen(false);
    setIsCreditsModalOpen(true);
  };

  const startFreshRoom = () => {
    window.location.reload();
  };

  const copyInviteLink = async () => {
    if (!inviteLink) {
      return;
    }

    playButtonClick();

    const updateInviteStatus = (message: string) => {
      setInviteStatus(message);
      if (inviteStatusTimerRef.current) {
        window.clearTimeout(inviteStatusTimerRef.current);
      }
      inviteStatusTimerRef.current = window.setTimeout(() => {
        setInviteStatus(null);
      }, 2200);
    };

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteLink);
        updateInviteStatus("Invite copied");
        pushToast("Invite link copied.", "success");
        return;
      }

      const helper = document.createElement("textarea");
      helper.value = inviteLink;
      helper.setAttribute("readonly", "true");
      helper.style.position = "absolute";
      helper.style.left = "-10000px";
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
      updateInviteStatus("Invite copied");
      pushToast("Invite link copied.", "success");
    } catch {
      updateInviteStatus("Copy failed");
      pushToast("Copy failed.", "error");
    }
  };

  const clearMapFlagPreviewTimer = useCallback(() => {
    if (mapFlagPreviewTimerRef.current !== null) {
      window.clearTimeout(mapFlagPreviewTimerRef.current);
      mapFlagPreviewTimerRef.current = null;
    }
  }, []);

  const beginMapFlagPreview = useCallback((flagCode: string, intent: MapFlagPreviewIntent) => {
    clearMapFlagPreviewTimer();
    setPreviewedFlagCode(flagCode);
    setExpandedPreviewFlagCode((currentFlagCode) => currentFlagCode === flagCode ? currentFlagCode : null);
    mapFlagPreviewTimerRef.current = window.setTimeout(() => {
      setExpandedPreviewFlagCode(flagCode);
      if (intent === "touch") {
        suppressNextMapFlagClickRef.current = flagCode;
      }
      mapFlagPreviewTimerRef.current = null;
    }, MAP_FLAG_PREVIEW_DELAY_MS);
  }, [clearMapFlagPreviewTimer]);

  const endMapFlagPreview = useCallback((flagCode?: string) => {
    clearMapFlagPreviewTimer();
    setPreviewedFlagCode((currentFlagCode) => !flagCode || currentFlagCode === flagCode ? null : currentFlagCode);
    setExpandedPreviewFlagCode((currentFlagCode) => !flagCode || currentFlagCode === flagCode ? null : currentFlagCode);

    if (!flagCode || mapFlagTouchPressRef.current?.flagCode === flagCode) {
      mapFlagTouchPressRef.current = null;
    }
  }, [clearMapFlagPreviewTimer]);

  const handleMapFlagPreviewTouchStart = useCallback((flagCode: string, clientX: number, clientY: number) => {
    mapFlagTouchPressRef.current = { flagCode, clientX, clientY };
    suppressNextMapFlagClickRef.current = null;
    beginMapFlagPreview(flagCode, "touch");
  }, [beginMapFlagPreview]);

  const handleMapFlagPreviewTouchMove = useCallback((flagCode: string, clientX: number, clientY: number) => {
    const activeTouchPress = mapFlagTouchPressRef.current;
    if (!activeTouchPress || activeTouchPress.flagCode !== flagCode) {
      return;
    }

    if (Math.hypot(clientX - activeTouchPress.clientX, clientY - activeTouchPress.clientY) > MAP_FLAG_PREVIEW_TOUCH_MOVE_TOLERANCE_PX) {
      endMapFlagPreview(flagCode);
    }
  }, [endMapFlagPreview]);

  const handleMapFlagPreviewTouchEnd = useCallback((flagCode: string) => {
    endMapFlagPreview(flagCode);
  }, [endMapFlagPreview]);

  const handleMapFlagMarkerClick = useCallback((flagCode: string) => {
    if (suppressNextMapFlagClickRef.current === flagCode) {
      suppressNextMapFlagClickRef.current = null;
      endMapFlagPreview(flagCode);
      return;
    }

    endMapFlagPreview(flagCode);
    setFlagElimination(flagCode);
  }, [endMapFlagPreview, setFlagElimination]);

  const clampPanY = (candidateY: number, zoomLevel: number): number => {
    const viewportHeight = mapViewportRef.current?.clientHeight ?? viewportSize.height;
    return clampMapPanY(candidateY, zoomLevel, viewportHeight);
  };

  useEffect(() => {
    return () => {
      clearMapFlagPreviewTimer();
    };
  }, [clearMapFlagPreviewTimer]);

  useEffect(() => {
    const handleResize = () => {
      const nextViewportSize = getViewportSize();
      setViewportSize(nextViewportSize);
      setDesktopWindows((currentWindows) => normalizeDesktopWindows(currentWindows, nextViewportSize.width, nextViewportSize.height));

      const nextDefaultPan = getDefaultMapPan(nextViewportSize.width, nextViewportSize.height);
      const nextPan = {
        x: zoomRef.current === 1 ? nextDefaultPan.x : panRef.current.x,
        y: clampMapPanY(panRef.current.y, zoomRef.current, nextViewportSize.height)
      };

      applyViewportState(zoomRef.current, nextPan);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(DESKTOP_WINDOW_STORAGE_KEY, JSON.stringify(desktopWindows));
  }, [desktopWindows]);

  useEffect(() => {
    const viewport = mapViewportRef.current;
    if (!viewport) {
      return;
    }

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const rect = viewport.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      const currentViewportState = pendingViewportStateRef.current ?? { zoom: zoomRef.current, pan: panRef.current };
      const nextZoom = Math.max(1, Math.min(4, currentViewportState.zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
      const scaleRatio = nextZoom / currentViewportState.zoom;

      const nextPanX = offsetX - (offsetX - currentViewportState.pan.x) * scaleRatio;
      const nextPanY = clampPanY(offsetY - (offsetY - currentViewportState.pan.y) * scaleRatio, nextZoom);

      scheduleViewportState(nextZoom, { x: nextPanX, y: nextPanY });
    };

    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", onWheel);
    };
  }, []);

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isMapFlagMarkerTarget(event.target)) {
      return;
    }
    isPanningRef.current = true;
    setIsPanning(true);
    panStartRef.current = { x: event.clientX - panRef.current.x, y: event.clientY - panRef.current.y };
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isPanningRef.current) {
      return;
    }
    scheduleViewportState(zoomRef.current, {
      x: event.clientX - panStartRef.current.x,
      y: clampPanY(event.clientY - panStartRef.current.y, zoomRef.current)
    });
  };

  const handleMouseUp = () => {
    isPanningRef.current = false;
    setIsPanning(false);
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (isMapFlagMarkerTarget(event.target)) {
      return;
    }

    if (event.touches.length === 2) {
      const [touchA, touchB] = [event.touches[0], event.touches[1]];
      pinchDistanceRef.current = Math.hypot(touchB.clientX - touchA.clientX, touchB.clientY - touchA.clientY);
      return;
    }

    if (event.touches.length === 1) {
      isPanningRef.current = true;
      setIsPanning(true);
      panStartRef.current = {
        x: event.touches[0].clientX - panRef.current.x,
        y: event.touches[0].clientY - panRef.current.y
      };
    }
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2 && pinchDistanceRef.current) {
      event.preventDefault();
      const [touchA, touchB] = [event.touches[0], event.touches[1]];
      const nextDistance = Math.hypot(touchB.clientX - touchA.clientX, touchB.clientY - touchA.clientY);
      const currentViewportState = pendingViewportStateRef.current ?? { zoom: zoomRef.current, pan: panRef.current };
      const nextZoom = Math.max(1, Math.min(4, currentViewportState.zoom * (nextDistance / pinchDistanceRef.current)));
      scheduleViewportState(nextZoom, {
        ...currentViewportState.pan,
        y: clampPanY(currentViewportState.pan.y, nextZoom)
      });
      pinchDistanceRef.current = nextDistance;
      return;
    }

    if (event.touches.length === 1 && isPanningRef.current) {
      scheduleViewportState(zoomRef.current, {
        x: event.touches[0].clientX - panStartRef.current.x,
        y: clampPanY(event.touches[0].clientY - panStartRef.current.y, zoomRef.current)
      });
    }
  };

  const handleTouchEnd = () => {
    if (pinchDistanceRef.current) {
      pinchDistanceRef.current = null;
    }
    isPanningRef.current = false;
    setIsPanning(false);
  };

  const zoomIn = () => {
    const nextZoom = Math.min(4, zoomRef.current + 0.2);
    applyViewportState(nextZoom, { ...panRef.current, y: clampPanY(panRef.current.y, nextZoom) });
  };

  const zoomOut = () => {
    const nextZoom = Math.max(1, zoomRef.current - 0.2);
    applyViewportState(nextZoom, { ...panRef.current, y: clampPanY(panRef.current.y, nextZoom) });
  };

  const resetMapView = () => {
    applyViewportState(1, getDefaultMapPan(viewportSize.width, viewportSize.height));
  };

  const tileSpan = MAP_WIDTH * zoom;
  const wrappedPanX = pan.x - Math.round(pan.x / tileSpan) * tileSpan;
  const tileOffsets = (import.meta.env.MODE === "test" ? [0] : [-1, 0, 1]).map((offset) => offset * MAP_WIDTH);

  const remainingFlags = activeFlagCodes.filter((flagCode) => !eliminatedCodes.includes(flagCode));
  const intelGatheredRatio = activeFlagCodes.length > 0
    ? Math.min(1, eliminatedCodes.length / activeFlagCodes.length)
    : 0;
  const intelGatheredPercent = Math.round(intelGatheredRatio * 100);
  const guessOptions = remainingFlags.length > 0 ? remainingFlags : activeFlagCodes;
  const guessPickerMenuId = "guess-flag-options";
  const selectedGuessIndex = Math.max(0, guessOptions.indexOf(guessFlagCode));

  const focusGuessOptionAt = (index: number) => {
    if (guessOptions.length === 0) {
      return;
    }

    const boundedIndex = ((index % guessOptions.length) + guessOptions.length) % guessOptions.length;
    const nextCode = guessOptions[boundedIndex];
    setGuessFlagCode(nextCode);
    window.setTimeout(() => {
      guessPickerOptionRefs.current[boundedIndex]?.focus();
    }, 0);
  };

  const runGuessTypeahead = (typedKey: string, keepMenuOpen: boolean) => {
    if (!/^[a-z0-9]$/i.test(typedKey) || guessOptions.length === 0) {
      return;
    }

    guessPickerTypeaheadRef.current = `${guessPickerTypeaheadRef.current}${typedKey}`.toUpperCase();
    if (guessPickerTypeaheadTimerRef.current) {
      window.clearTimeout(guessPickerTypeaheadTimerRef.current);
    }
    guessPickerTypeaheadTimerRef.current = window.setTimeout(() => {
      guessPickerTypeaheadRef.current = "";
    }, 700);

    const startIndex = Math.max(0, guessOptions.indexOf(guessFlagCode));
    const orderedCodes = [...guessOptions.slice(startIndex + 1), ...guessOptions.slice(0, startIndex + 1)];
    const matchedCode = orderedCodes.find((code) => code.toUpperCase().startsWith(guessPickerTypeaheadRef.current));
    if (!matchedCode) {
      return;
    }

    const matchedIndex = guessOptions.indexOf(matchedCode);
    if (keepMenuOpen) {
      focusGuessOptionAt(matchedIndex);
      return;
    }

    setGuessFlagCode(matchedCode);
  };

  const handleGuessTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!canGuess) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isGuessPickerOpen) {
        setIsGuessPickerOpen(true);
      }
      focusGuessOptionAt(selectedGuessIndex + 1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isGuessPickerOpen) {
        setIsGuessPickerOpen(true);
      }
      focusGuessOptionAt(selectedGuessIndex - 1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!isGuessPickerOpen) {
        setIsGuessPickerOpen(true);
        window.setTimeout(() => {
          focusGuessOptionAt(selectedGuessIndex);
        }, 0);
      } else {
        setIsGuessPickerOpen(false);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setIsGuessPickerOpen(false);
      return;
    }

    if (event.key.length === 1) {
      event.preventDefault();
      runGuessTypeahead(event.key, false);
    }
  };

  const handleGuessOptionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, optionIndex: number) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusGuessOptionAt(optionIndex + 1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusGuessOptionAt(optionIndex - 1);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      focusGuessOptionAt(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      focusGuessOptionAt(guessOptions.length - 1);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setIsGuessPickerOpen(false);
      guessPickerTriggerRef.current?.focus();
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setIsGuessPickerOpen(false);
      guessPickerTriggerRef.current?.focus();
      return;
    }

    if (event.key.length === 1) {
      event.preventDefault();
      runGuessTypeahead(event.key, true);
    }
  };

  const yourScore = playerId ? (score[playerId] ?? 0) : 0;
  const totalScore = Object.values(score).reduce((sum, value) => sum + value, 0);
  const opponentScore = Math.max(0, totalScore - yourScore);
  const yourSideLabel = seat === "p1" ? "RED" : seat === "p2" ? "BLUE" : "YOU";
  const opponentSideLabel = seat === "p1" ? "BLUE" : seat === "p2" ? "RED" : "RIVAL";
  const yourSecretReveal = roundResult && playerId ? roundResult.revealedSecrets[playerId] : null;
  const opponentSecretReveal = roundResult && playerId
    ? Object.entries(roundResult.revealedSecrets).find(([revealedPlayerId]) => revealedPlayerId !== playerId)?.[1] ?? null
    : null;
  const turnBannerText = !gameInfo
    ? "WAITING FOR MATCH"
    : isYourTurn
      ? "YOUR TURN"
      : turnState === "round-over"
        ? "ROUND COMPLETE"
        : "OPPONENT TURN";
  const turnBannerClassName = isYourTurn ? "turn-banner turn-banner-active" : "turn-banner";
  const nextRoundCountdownLabel = nextRoundCountdownMs !== null
    ? `${Math.max(0.1, nextRoundCountdownMs / 1000).toFixed(1)}s`
    : null;
  const askedQuestionHistoryRows = [...askedQuestionHistory].reverse();
  const areSecretsVisible = roundRevealPhase === "secrets" || roundRevealPhase === "settled";
  const isInRoom = Boolean(roomCode && playerId);
  const hasGameStarted = Boolean(gameInfo);
  const shouldShowMissionWindow = !hasGameStarted || Boolean(matchWinnerId);
  const shouldShowIntelWindow = hasGameStarted;
  const shouldShowChatWindow = isInRoom;
  const uplinkStatusLabel = connected ? "ONLINE" : "OFFLINE";
  const isDesktopWindowing = viewportSize.width >= DESKTOP_WINDOW_BREAKPOINT;
  const resultCardClassName = roundResult
    ? roundResult.winnerPlayerId === playerId
      ? `result-card result-card-success result-card-phase-${roundRevealPhase}`
      : `result-card result-card-danger result-card-phase-${roundRevealPhase}`
    : "result-card";
  const yourScoreCardClassName = [
    seat === "p2" ? "score-card score-card-blue" : "score-card score-card-red",
    scorePulseTarget === "self" ? "score-card-pulse" : ""
  ].filter(Boolean).join(" ");
  const opponentScoreCardClassName = [
    seat === "p1" ? "score-card score-card-blue" : "score-card score-card-red",
    scorePulseTarget === "opponent" ? "score-card-pulse" : ""
  ].filter(Boolean).join(" ");
  const matchResultCardClassName = [
    "result-card",
    "result-card-match",
    matchWinnerId === playerId ? "result-card-match-win" : "result-card-match-loss"
  ].join(" ");
  const chatComposerModeClassName = [
    "chat-composer-mode-pill",
    "chat-composer-mode-pill-chat",
    composerModePreview === "chat" ? "chat-composer-mode-pill-active" : ""
  ].filter(Boolean).join(" ");
  const questionComposerModeClassName = [
    "chat-composer-mode-pill",
    "chat-composer-mode-pill-question",
    composerModePreview === "question" ? "chat-composer-mode-pill-active" : ""
  ].filter(Boolean).join(" ");
  const chatComposerActionClassName = [
    "chat-composer-action",
    "chat-composer-action-chat",
    composerModePreview === "chat" ? "chat-composer-action-active" : ""
  ].filter(Boolean).join(" ");
  const questionComposerActionClassName = [
    "chat-composer-action",
    "chat-composer-action-question",
    composerModePreview === "question" ? "chat-composer-action-active" : ""
  ].filter(Boolean).join(" ");
  const mapCanvasClassName = isPanning ? "map-stage map-stage-canvas map-stage-panning" : "map-stage map-stage-canvas";

  useEffect(() => {
    const activePreviewFlagCode = previewedFlagCode ?? expandedPreviewFlagCode;
    if (!activePreviewFlagCode) {
      return;
    }

    if (!activeFlagCodes.includes(activePreviewFlagCode)) {
      endMapFlagPreview(activePreviewFlagCode);
    }
  }, [activeFlagCodes, eliminatedCodes, endMapFlagPreview, expandedPreviewFlagCode, previewedFlagCode]);

  const focusDesktopWindow = useCallback((windowId: DesktopWindowId) => {
    setDesktopWindows((currentWindows) => raiseDesktopWindow(currentWindows, windowId));
  }, []);

  const handleDesktopWindowLayoutChange = useCallback((windowId: DesktopWindowId, nextLayout: DesktopWindowLayout) => {
    setDesktopWindows((currentWindows) => (
      updateDesktopWindowLayout(
        currentWindows, windowId, nextLayout, viewportSize.width, viewportSize.height,
        windowId !== "mission" ? collapsedWindows[windowId] : false
      )
    ));
  }, [viewportSize.height, viewportSize.width, collapsedWindows]);

  const toggleDesktopWindowCollapsed = useCallback((windowId: DesktopWindowId) => {
    if (windowId === "mission") {
      return;
    }

    setCollapsedWindows((currentWindows) => ({
      ...currentWindows,
      [windowId]: !currentWindows[windowId]
    }));
    setDesktopWindows((currentWindows) => raiseDesktopWindow(currentWindows, windowId));
  }, []);

  const toggleHiddenCountryExpanded = useCallback(() => {
    playButtonClick();
    setIsHiddenCountryExpanded((currentValue) => {
      const nextValue = !currentValue;

      if (nextValue && isDesktopWindowing) {
        setDesktopWindows((currentWindows) => {
          const intelLayout = currentWindows.intel;
          return raiseDesktopWindow(
            updateDesktopWindowLayout(
              currentWindows,
              "intel",
              {
                ...intelLayout,
                width: Math.max(intelLayout.width, EXPANDED_HIDDEN_COUNTRY_INTEL_WIDTH),
                height: Math.max(intelLayout.height, EXPANDED_HIDDEN_COUNTRY_INTEL_HEIGHT)
              },
              viewportSize.width,
              viewportSize.height
            ),
            "intel"
          );
        });
      }

      return nextValue;
    });
  }, [isDesktopWindowing, viewportSize.height, viewportSize.width]);

  const toggleRoundConsoleExpanded = useCallback(() => {
    playButtonClick();
    setIsRoundConsoleExpanded((currentValue) => !currentValue);
  }, []);

  const missionConsoleContent = (
    <div className="desktop-panel-content">
      <div className="controls controls-stack">
        <input
          value={lobby.displayName}
          onChange={onDisplayNameChange}
          placeholder="Display name"
        />
        <select
          value={selectedDifficulty}
          onChange={(event) => setSelectedDifficulty(event.target.value as RoomDifficulty)}
          aria-label="Room difficulty"
        >
          {ROOM_DIFFICULTIES.map((difficulty) => (
            <option key={difficulty} value={difficulty}>{formatDifficultyLabel(difficulty)}</option>
          ))}
        </select>
        <button onClick={createRoom}>Create Room</button>
      </div>

      <div className="controls controls-stack">
        <input
          value={lobby.roomCodeInput}
          onChange={onRoomCodeChange}
          placeholder="Room code"
        />
        <button onClick={joinRoom} disabled={!canJoin}>
          Join Room
        </button>
      </div>

      <div className="invite-strip" aria-live="polite">
        <input value={inviteLink || "Create a room to generate invite link"} readOnly />
        <button onClick={copyInviteLink} disabled={!inviteLink}>
          Copy Invite Link
        </button>
      </div>
      <div className="mission-console-footer" aria-live="polite">
        <p className="mission-console-room">
          Room <strong data-testid="mission-room-code">{roomCode ?? "none"}</strong>
        </p>
        <p className="mission-console-status">{status}</p>
      </div>
      {inviteStatus ? <p className="invite-status">{inviteStatus}</p> : null}
    </div>
  );

  const intelDeskContent = (
    <div className="desktop-panel-content desktop-panel-content-intel">
      {!gameInfo ? (
        <p>Waiting for game start...</p>
      ) : (
        <>
          <section className="score-ribbon intel-round-overview" data-testid="intel-round-overview">
            <article className={yourScoreCardClassName}>
              <span className="score-label">{yourSideLabel} CELL</span>
              <strong>{yourScore}</strong>
              <span className="score-name">{lobby.displayName || "You"}</span>
            </article>

            <div className="score-center intel-round-center">
              <p className={turnBannerClassName} data-testid="turn-status">{turnBannerText}</p>
              <p className="score-subtitle" data-testid="round-status">
                Round {gameInfo.roundNumber} · First to {CHAMPIONSHIP_TARGET_WINS} wins
              </p>
              {isRoundTransitioning && !matchWinnerId ? (
                <p className="round-transition-banner" data-testid="round-transition-banner" aria-live="polite">
                  {nextRoundCountdownLabel ? `NEXT ROUND IN ${nextRoundCountdownLabel}` : "NEXT ROUND INITIALIZING..."}
                </p>
              ) : null}
            </div>

            <article className={opponentScoreCardClassName}>
              <span className="score-label">{opponentSideLabel} CELL</span>
              <strong>{opponentScore}</strong>
              <span className="score-name">Opponent</span>
            </article>
          </section>

          <HiddenCountryPanel
            flagCode={gameInfo.yourSecretFlag}
            isExpanded={isHiddenCountryExpanded}
            onToggleExpanded={toggleHiddenCountryExpanded}
          />

          <div className="round-detail-grid">
            <article className="detail-card intel-progress-card">
              <span className="slot-label">Intel Gathered</span>
              <strong className="intel-progress-value">{intelGatheredPercent}%</strong>
              <div
                className="intel-progress-track"
                role="progressbar"
                aria-label="Intel gathered"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={intelGatheredPercent}
              >
                <span className="intel-progress-fill" style={{ width: `${intelGatheredPercent}%` }} />
              </div>
              <span className="intel-progress-caption">
                {eliminatedCodes.length} / {activeFlagCodes.length} flags eliminated
              </span>
            </article>
            <div className="detail-card">
              <span className="slot-label">Uplink</span>
              <strong className="detail-value">{uplinkStatusLabel}</strong>
            </div>
            <div className="detail-card">
              <span className="slot-label">Operation State</span>
              <strong>{formatTurnState(turnState)}</strong>
            </div>
          </div>

          <IntelSubpanel
            title={matchWinnerId ? "Match Console" : "Round Console"}
            isExpanded={isRoundConsoleExpanded}
            onToggleExpanded={toggleRoundConsoleExpanded}
            dataTestId="round-console-panel"
          >
            <div className="intel-command-panel">
              {askedQuestionHistoryRows.length > 0 ? (
                <div className="intel-history-wrap">
                  <table className="intel-history-table" aria-label="Question and answer history">
                    <thead>
                      <tr>
                        <th scope="col">Question</th>
                        <th scope="col">Answer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {askedQuestionHistoryRows.map((entry) => (
                        <tr key={entry.id}>
                          <td>{entry.question}</td>
                          <td className="intel-history-answer-cell">
                            <span
                              className={entry.answer === null
                                ? "answer-badge answer-badge-pending"
                                : entry.answer === "yes"
                                  ? "answer-badge answer-badge-yes"
                                  : "answer-badge answer-badge-no"}
                            >
                              {entry.answer ? entry.answer.toUpperCase() : "PENDING"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="intel-empty-line">Only your accepted questions appear here.</p>
              )}

              {matchWinnerId ? (
                <p className="intel-empty-line">Round controls are locked. Use rematch or start a fresh room below.</p>
              ) : (
                <section className="intel-action-panel" aria-label="Round actions">
                  {pendingGuessCode || recentBoardChange ? (
                    <div className="feedback-chip-row" aria-live="polite">
                      {pendingGuessCode ? <p className="feedback-chip feedback-chip-warning">Guess locked: {pendingGuessCode.toUpperCase()}</p> : null}
                      {recentBoardChange ? (
                        <p className={`feedback-chip ${recentBoardChange.eliminated ? "feedback-chip-success" : "feedback-chip-info"}`}>
                          {recentBoardChange.eliminated ? "Confirmed eliminated" : "Returned to active board"}: {recentBoardChange.flagCode.toUpperCase()}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="intel-action-grid">
                    <button className="intel-action-button intel-action-button-secondary" onClick={endTurn} disabled={!canEndTurn}>End Turn</button>
                    <button className="intel-action-button intel-action-button-primary" onClick={openGuessModal} disabled={!canGuess}>Make Guess</button>
                  </div>
                </section>
              )}
            </div>
          </IntelSubpanel>

          {roundResult ? (
            <div className={resultCardClassName}>
              <p className="result-title">Round result: {formatRoundReason(roundResult.reason)}</p>
              {roundRevealPhase === "impact" ? (
                <p className="result-subtitle">Decrypting field intel...</p>
              ) : null}
              <p className={areSecretsVisible ? "reveal-line" : "reveal-line reveal-line-hidden"}>
                Your location was {areSecretsVisible ? yourSecretReveal?.toUpperCase() ?? "hidden" : "CLASSIFIED"}.
              </p>
              <p className={areSecretsVisible ? "reveal-line" : "reveal-line reveal-line-hidden"}>
                Opponent location was {areSecretsVisible ? opponentSecretReveal?.toUpperCase() ?? "hidden" : "CLASSIFIED"}.
              </p>
              {roundRevealPhase === "settled" ? (
                <p className="result-verdict">{roundResult.winnerPlayerId === playerId ? "Intel confirmed. Round secured." : "Cover blown. Regroup for the next round."}</p>
              ) : null}
            </div>
          ) : null}

          {matchWinnerId ? (
            <div className={matchResultCardClassName}>
              <p className="result-title">Match winner: {matchWinnerId === playerId ? "You" : "Opponent"}</p>
              <p className="result-verdict">{matchWinnerId === playerId ? "Operation complete. Championship secured." : "Operation lost. Queue another rematch."}</p>
              <div className="controls controls-stack">
                <button onClick={startNewGame}>Rematch</button>
                <button onClick={startFreshRoom}>New Room</button>
              </div>
            </div>
          ) : null}

        </>
      )}
    </div>
  );

  const chatWindowContent = (
    <div className="desktop-panel-content desktop-panel-content-chat">
      {!gameInfo ? (
        <div className="incoming-card">
          <p className="incoming-label">Intercept standby</p>
          <p className="section-subtitle">Room is live. The channel unlocks fully when the second player joins.</p>
        </div>
      ) : null}

      {incomingQuestion ? (
        <div className="incoming-card incoming-card-alert">
          <p className="incoming-label">Incoming interrogation</p>
          <strong data-testid="incoming-question">{incomingQuestion}</strong>
          <div className="controls controls-stack">
            <button onClick={() => answerQuestion("yes")} disabled={!canAnswer}>Answer Yes</button>
            <button onClick={() => answerQuestion("no")} disabled={!canAnswer}>Answer No</button>
          </div>
        </div>
      ) : null}

      <div className="chat-list" ref={chatListRef} role="log" aria-live="polite" aria-relevant="additions text">
        {chatMessages.length === 0 ? <p className="chat-empty-state">No messages yet.</p> : null}
        {chatMessages.map((message, index) => (
          <article
            key={`${message.createdAt}-${index}`}
            className={message.fromPlayerId === playerId ? "chat-bubble chat-bubble-self" : "chat-bubble chat-bubble-opponent"}
          >
            <span className="chat-bubble-author">{message.fromPlayerId === playerId ? "You" : "Opponent"}</span>
            <p className="chat-bubble-text">{message.text}</p>
          </article>
        ))}
      </div>

      <div className="chat-composer">
        {pendingQuestionText ? (
          <div className="feedback-chip-row chat-composer-feedback" aria-live="polite">
            <p className="feedback-chip feedback-chip-info">Question in flight</p>
          </div>
        ) : null}

        <div className="chat-composer-main">
          <div id="intercept-composer-shortcuts" className="chat-composer-modebar">
            <span className={chatComposerModeClassName}>chat / Enter</span>
            <span className={questionComposerModeClassName}>question / Ctrl+Enter</span>
          </div>
          <input
            aria-label="Intercept composer"
            aria-describedby="intercept-composer-shortcuts"
            value={messageInput}
            onChange={(event) => setMessageInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Control" || event.key === "Meta") {
                setComposerModePreview("question");
                return;
              }

              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();

                if (event.ctrlKey || event.metaKey) {
                  askQuestion();
                  return;
                }

                sendChat();
              }
            }}
            onKeyUp={(event) => {
              if (event.key === "Control" || event.key === "Meta") {
                setComposerModePreview("chat");
              }
            }}
            onBlur={() => setComposerModePreview("chat")}
            placeholder="Type a chat message or yes-or-no question"
          />
          <div className="chat-composer-actions">
            <button className={questionComposerActionClassName} onClick={askQuestion} disabled={!canAsk || !messageInput.trim()}>Ask Question</button>
            <button className={chatComposerActionClassName} onClick={sendChat} disabled={!messageInput.trim()}>Send Chat</button>
          </div>
        </div>
      </div>
    </div>
  );

  const interceptChannelTitle = roomCode ? `Intercept Channel: ${roomCode}` : "Intercept Channel";

  return (
    <main className="app-shell">
      <div className="app-canvas-noise" aria-hidden="true" />
      <div
        ref={mapViewportRef}
        className={mapCanvasClassName}
        data-testid="map-canvas"
        aria-label={`${activeFlagCodes.length} flag cards`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className="map-world-layer"
          style={{
            transform: `translate(${wrappedPanX}px, ${pan.y}px) scale(${zoom})`,
            "--marker-scale": `${1 / zoom}`
          } as CSSProperties}
        >
          {tileOffsets.map((tileOffset) => (
            <div key={tileOffset} className="map-tile" style={{ left: `${tileOffset}px` }}>
              <WorldMapBackdrop />
            </div>
          ))}
          {activeFlagCodes.map((flagCode) => {
            const marker = getMarkerForFlag(flagCode, flagMarkerPositions);
            return (
              <FlagMarker
                key={`${flagCode}-marker`}
                flagCode={flagCode}
                marker={marker}
                isEliminated={eliminatedCodes.includes(flagCode)}
                canEditBoard={canEditBoard}
                isPreviewActive={previewedFlagCode === flagCode}
                isPreviewExpanded={expandedPreviewFlagCode === flagCode}
                previewAlignment={getMapFlagPreviewAlignment(marker)}
                previewPlacement={getMapFlagPreviewPlacement(marker)}
                onMarkerClick={handleMapFlagMarkerClick}
                onPreviewEnd={endMapFlagPreview}
                onPreviewStart={beginMapFlagPreview}
                onPreviewTouchEnd={handleMapFlagPreviewTouchEnd}
                onPreviewTouchMove={handleMapFlagPreviewTouchMove}
                onPreviewTouchStart={handleMapFlagPreviewTouchStart}
              />
            );
          })}
        </div>
      </div>

      <div className="app-chrome">
        <div className="hud-shell">
          <header className="panel panel-wide hero-panel">
            <div>
              <h1>.false_flag//GLOBAL SIGNAL</h1>
            </div>
            <div className="hero-actions">
              <button type="button" onClick={openRulesModal}>How to Play</button>
              <button type="button" onClick={openCreditsModal}>Credits</button>
            </div>
          </header>

          {toastMessages.length > 0 ? (
            <div className="toast-stack" aria-live="polite" aria-relevant="additions text">
              {toastMessages.map((message) => (
                <p key={message.id} className={`toast toast-${message.tone}`}>{message.text}</p>
              ))}
            </div>
          ) : null}
        </div>

        <section className="map-hud" data-testid="map-hud">
          <div className="map-hud-copy">
            <p className="desktop-window-kicker">atlas.kernel::world-grid</p>
            <h2>World Signal Grid</h2>
            <p className="section-subtitle">Hold Ctrl and scroll to zoom. Drag exposed canvas to pan. Move windows to uncover markers.</p>
          </div>
          <div className="map-hud-toolbar">
            <p className="board-meta" data-testid="candidate-count">{remainingFlags.length} candidate locations remaining</p>
            <div className="map-zoom-controls" aria-label="Map zoom controls">
              <button type="button" onClick={zoomOut} aria-label="Zoom out">-</button>
              <button type="button" onClick={resetMapView} aria-label="Reset map view">o</button>
              <button type="button" onClick={zoomIn} aria-label="Zoom in">+</button>
            </div>
          </div>
          <div className="map-legend">
            <span><i className="legend-dot legend-dot-live" /> Active candidate</span>
            <span><i className="legend-dot legend-dot-dead" /> Eliminated candidate</span>
          </div>
        </section>

        <div className={isDesktopWindowing ? "desktop-window-stage" : "desktop-window-stage desktop-window-stage-stacked"}>
          {shouldShowMissionWindow ? (
            <DesktopWindow
              windowId="mission"
              title="Mission Console"
              subtitle={matchWinnerId ? "room setup, invite routing, and post-match reset" : "room setup, difficulty selection, and uplink routing"}
              layout={desktopWindows.mission}
              interactive={isDesktopWindowing}
              className="mission-window"
              dataTestId="mission-window"
              onFocus={focusDesktopWindow}
              onLayoutChange={handleDesktopWindowLayoutChange}
            >
              {missionConsoleContent}
            </DesktopWindow>
          ) : null}

          {shouldShowIntelWindow ? (
            <DesktopWindow
              windowId="intel"
              title="Intel Desk"
              subtitle="round telemetry, questioning, reveal sequence, and strike controls"
              layout={desktopWindows.intel}
              interactive={isDesktopWindowing}
              canCollapse={isDesktopWindowing}
              isCollapsed={collapsedWindows.intel}
              className="round-panel intel-window"
              dataTestId="intel-window"
              onFocus={focusDesktopWindow}
              onToggleCollapsed={toggleDesktopWindowCollapsed}
              onLayoutChange={handleDesktopWindowLayoutChange}
            >
              {intelDeskContent}
            </DesktopWindow>
          ) : null}

          {shouldShowChatWindow ? (
            <DesktopWindow
              windowId="chat"
              title={interceptChannelTitle}
              subtitle="questions, answers, and field chatter"
              layout={desktopWindows.chat}
              interactive={isDesktopWindowing}
              canCollapse={isDesktopWindowing}
              isCollapsed={collapsedWindows.chat}
              className="chat-panel chat-window"
              dataTestId="chat-window"
              onFocus={focusDesktopWindow}
              onToggleCollapsed={toggleDesktopWindowCollapsed}
              onLayoutChange={handleDesktopWindowLayoutChange}
            >
              {chatWindowContent}
            </DesktopWindow>
          ) : null}
        </div>
      </div>

      {isGuessModalOpen ? (
        <div
          className="modal-scrim"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeGuessModal();
            }
          }}
        >
          <div ref={guessModalRef} className="guess-modal" role="dialog" aria-modal="true" aria-labelledby="guess-modal-title">
            <h2 id="guess-modal-title">Make Guess</h2>
            <p className="section-subtitle">Only remaining flags are shown. A wrong guess ends the round immediately.</p>
            <div className="guess-picker">
              <button
                type="button"
                className="guess-picker-trigger"
                ref={guessPickerTriggerRef}
                role="combobox"
                aria-label="Guess flag"
                aria-haspopup="listbox"
                aria-controls={guessPickerMenuId}
                aria-expanded={isGuessPickerOpen}
                aria-activedescendant={isGuessPickerOpen ? `guess-option-${guessFlagCode}` : undefined}
                onClick={() => setIsGuessPickerOpen((open) => !open)}
                onKeyDown={handleGuessTriggerKeyDown}
                disabled={!canGuess}
              >
                <img src={toFlagImage(guessFlagCode)} alt="" loading="lazy" />
                <span>{guessFlagCode.toUpperCase()}</span>
              </button>
              {isGuessPickerOpen ? (
                <div id={guessPickerMenuId} className="guess-picker-menu" role="listbox" aria-label="Guess flag options">
                  {guessOptions.map((flagCode, optionIndex) => (
                    <button
                      id={`guess-option-${flagCode}`}
                      key={flagCode}
                      type="button"
                      role="option"
                      ref={(element) => {
                        guessPickerOptionRefs.current[optionIndex] = element;
                      }}
                      tabIndex={flagCode === guessFlagCode ? 0 : -1}
                      aria-selected={flagCode === guessFlagCode}
                      className={flagCode === guessFlagCode ? "guess-picker-option guess-picker-option-selected" : "guess-picker-option"}
                      onClick={() => {
                        setGuessFlagCode(flagCode);
                        setIsGuessPickerOpen(false);
                        guessPickerTriggerRef.current?.focus();
                      }}
                      onKeyDown={(event) => handleGuessOptionKeyDown(event, optionIndex)}
                    >
                      <img src={toFlagImage(flagCode)} alt="" loading="lazy" />
                      <span>{flagCode.toUpperCase()}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="controls controls-stack modal-actions">
              <button onClick={makeGuess} disabled={!canGuess}>Confirm Guess</button>
              <button onClick={closeGuessModal}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isRulesModalOpen ? (
        <div
          className="modal-scrim"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeRulesModal();
            }
          }}
        >
          <div ref={rulesModalRef} className="guess-modal rules-modal" role="dialog" aria-modal="true" aria-labelledby="rules-modal-title">
            <h2 id="rules-modal-title">How to Play</h2>
            <div className="rules-modal-content">
              <p>You and one opponent each get a secret country flag. The first player to win 3 rounds wins the match.</p>

              <h3>Round Flow</h3>
              <ol>
                <li>On your turn, ask one yes-or-no question about your opponent&apos;s secret country.</li>
                <li>Your opponent answers yes or no.</li>
                <li>Use the answer to eliminate flags on your board.</li>
                <li>End your turn, or make a guess if you are confident.</li>
              </ol>

              <h3>Board Controls</h3>
              <ul>
                <li>Click a flag card on the map to eliminate it.</li>
                <li>Drag to pan the map.</li>
                <li>Use Ctrl + mouse wheel (or pinch on touch devices) to zoom.</li>
                <li>Use the + / o / - buttons to zoom in, reset, and zoom out.</li>
              </ul>

              <h3>Winning and Losing a Round</h3>
              <ul>
                <li>Correct guess: you win the round.</li>
                <li>Wrong guess: you lose the round immediately.</li>
                <li>After each round, both secret flags are revealed.</li>
              </ul>

              <h3>Quick Tips</h3>
              <ul>
                <li>Ask broad questions first to remove many possibilities.</li>
                <li>Track eliminated flags carefully before guessing.</li>
                <li>Use chat for coordination and mind games.</li>
              </ul>
            </div>
            <div className="controls controls-stack modal-actions">
              <button onClick={closeRulesModal}>Close</button>
            </div>
          </div>
        </div>
      ) : null}

      {isCreditsModalOpen ? (
        <div
          className="modal-scrim"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeCreditsModal();
            }
          }}
        >
          <div ref={creditsModalRef} className="guess-modal credits-modal" role="dialog" aria-modal="true" aria-labelledby="credits-modal-title">
            <h2 id="credits-modal-title">Credits</h2>
            <p className="section-subtitle">Source acknowledgements for the typography, map, flag imagery, and country data used by .false_flag//GLOBAL SIGNAL.</p>
            <div className="credits-modal-content">
              <section className="credits-resource">
                <p className="credits-resource-label">SVG World Map</p>
                <h3>SimpleMaps Free World SVG Map</h3>
                <p>The world backdrop is based on the SimpleMaps Free World SVG Map.</p>
                <div className="credits-resource-links">
                  <a href="https://simplemaps.com/resources/svg-world" target="_blank" rel="noreferrer">SimpleMaps map source</a>
                  <a href="https://simplemaps.com/resources/svg-license" target="_blank" rel="noreferrer">SimpleMaps license</a>
                </div>
              </section>

              <section className="credits-resource">
                <p className="credits-resource-label">Flag Images</p>
                <h3>Flagcdn by Flagpedia</h3>
                <p>Flag thumbnails are loaded at runtime from Flagcdn, the free service created by Flagpedia.net.</p>
                <div className="credits-resource-links">
                  <a href="https://flagcdn.com/" target="_blank" rel="noreferrer">Flagcdn</a>
                  <a href="https://flagpedia.net/" target="_blank" rel="noreferrer">Flagpedia</a>
                  <a href="https://commons.wikimedia.org/wiki/Category:SVG_flags_by_country" target="_blank" rel="noreferrer">Wikimedia Commons flag sources</a>
                </div>
              </section>

              <section className="credits-resource">
                <p className="credits-resource-label">Country Information</p>
                <h3>Wikipedia Contributors</h3>
                <p>Country metadata is adapted from Wikipedia contributors under CC BY-SA 4.0 and modified for gameplay metadata.</p>
                <div className="credits-resource-links">
                  <a href="https://www.wikipedia.org/" target="_blank" rel="noreferrer">Wikipedia</a>
                  <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0 license</a>
                </div>
              </section>

              <section className="credits-resource">
                <p className="credits-resource-label">Typography</p>
                <h3>Special Gothic Expanded One and Share Tech Mono</h3>
                <p>Title text uses Special Gothic Expanded One, Copyright 2023 The Special Gothic Project Authors. Body text uses Share Tech Mono, Copyright (c) 2012 Carrois Type Design and Ralph du Carrois. Both fonts are served via Google Fonts under the SIL Open Font License, Version 1.1.</p>
                <div className="credits-resource-links">
                  <a href="https://fonts.google.com/specimen/Special+Gothic+Expanded+One" target="_blank" rel="noreferrer">Special Gothic Expanded One source</a>
                  <a href="https://fonts.google.com/specimen/Special+Gothic+Expanded+One/license" target="_blank" rel="noreferrer">Special Gothic Expanded One license</a>
                  <a href="https://fonts.google.com/specimen/Share+Tech+Mono" target="_blank" rel="noreferrer">Share Tech Mono source</a>
                  <a href="https://fonts.google.com/specimen/Share+Tech+Mono/license" target="_blank" rel="noreferrer">Share Tech Mono license</a>
                </div>
              </section>
            </div>
            <div className="controls controls-stack modal-actions">
              <button onClick={closeCreditsModal}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

