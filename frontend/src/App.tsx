import { memo, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
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

const DEFAULT_FLAG_CODES = [...FULL_FLAG_CATALOG.slice(0, 24)];
const DIFFICULTY_LABELS: Record<RoomDifficulty, string> = {
  easy: "Easy (24 countries)",
  medium: "Medium (36 countries)",
  hard: "Hard (48 countries)",
  "007": "007 (Full list)"
};

const MAP_WIDTH = 2000;
const MAP_HEIGHT = 857;
const CHAMPIONSHIP_TARGET_WINS = 3;

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
  canEliminate: boolean;
  onEliminate: (flagCode: string) => void;
};

const FlagMarker = memo(function FlagMarker({
  flagCode,
  marker,
  isEliminated,
  canEliminate,
  onEliminate
}: FlagMarkerProps) {
  return (
    <button
      className={isEliminated ? "flag-card map-flag-card flag-card-eliminated" : "flag-card map-flag-card"}
      type="button"
      aria-label={flagCode.toUpperCase()}
      tabIndex={0}
      style={{
        left: `${marker.x}px`,
        top: `${marker.y}px`,
        pointerEvents: "auto"
      } as CSSProperties}
      onClick={() => {
        onEliminate(flagCode);
      }}
      disabled={!canEliminate}
    >
      <img src={toFlagImage(flagCode)} alt={flagCode.toUpperCase()} loading="lazy" />
      <span>{flagCode.toUpperCase()}</span>
    </button>
  );
}, (previousProps, nextProps) => {
  return previousProps.flagCode === nextProps.flagCode
    && previousProps.marker.x === nextProps.marker.x
    && previousProps.marker.y === nextProps.marker.y
    && previousProps.isEliminated === nextProps.isEliminated
    && previousProps.canEliminate === nextProps.canEliminate;
});

function WorldMapBackdrop() {
  return (
    <svg viewBox="0 0 2000 857" className="world-map-svg" aria-hidden="true" focusable="false">
      <image className="map-source-image" href="/world.svg" x="0" y="0" width="2000" height="857" />
      <g className="map-grid">
        <path d="M200 0v857" />
        <path d="M400 0v857" />
        <path d="M600 0v857" />
        <path d="M800 0v857" />
        <path d="M1000 0v857" />
        <path d="M1200 0v857" />
        <path d="M1400 0v857" />
        <path d="M1600 0v857" />
        <path d="M1800 0v857" />
        <path d="M0 171h2000" />
        <path d="M0 343h2000" />
        <path d="M0 515h2000" />
        <path d="M0 686h2000" />
      </g>
    </svg>
  );
}

export function App() {
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
  const [questionInput, setQuestionInput] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [incomingQuestion, setIncomingQuestion] = useState<string | null>(null);
  const [lastAnswered, setLastAnswered] = useState<QuestionAnsweredPayload | null>(null);
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
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [toastMessages, setToastMessages] = useState<ToastMessage[]>([]);
  const [pendingQuestionText, setPendingQuestionText] = useState<string | null>(null);
  const [pendingGuessCode, setPendingGuessCode] = useState<string | null>(null);
  const [nextRoundDeadlineMs, setNextRoundDeadlineMs] = useState<number | null>(null);
  const [nextRoundCountdownMs, setNextRoundCountdownMs] = useState<number | null>(null);
  const [recentlyConfirmedFlagCode, setRecentlyConfirmedFlagCode] = useState<string | null>(null);
  const [roundRevealPhase, setRoundRevealPhase] = useState<RoundRevealPhase>("hidden");
  const [scorePulseTarget, setScorePulseTarget] = useState<ScorePulseTarget>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const flagMarkerPositions: FlagMarkerPositions = WORLD_MAP_MARKER_POSITIONS;
  const mapViewportRef = useRef<HTMLDivElement | null>(null);
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const guessModalRef = useRef<HTMLDivElement | null>(null);
  const rulesModalRef = useRef<HTMLDivElement | null>(null);
  const guessPickerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const guessPickerOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const guessPickerTypeaheadRef = useRef("");
  const guessPickerTypeaheadTimerRef = useRef<number | null>(null);
  const panStartRef = useRef({ x: 0, y: 0 });
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
  const scoreRef = useRef<Record<string, number>>({});
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
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

  const pulseConfirmedFlag = (flagCode: string) => {
    setRecentlyConfirmedFlagCode(flagCode);
    if (feedbackResetTimerRef.current) {
      window.clearTimeout(feedbackResetTimerRef.current);
    }
    feedbackResetTimerRef.current = window.setTimeout(() => {
      setRecentlyConfirmedFlagCode(null);
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
      setStatus(`Room ${payload.roomCode} created. Waiting for opponent.`);
      pushToast(`Room ${payload.roomCode} is live. Waiting for rival.`, "success");
    });

    socket.on(SERVER_TO_CLIENT.ROOM_JOINED, (payload: RoomCreatedPayload) => {
      setPlayerId(payload.playerId);
      playerIdRef.current = payload.playerId;
      setSeat(payload.seat);
      setRoomCode(payload.roomCode);
      setRoomDifficulty(payload.difficulty);
      setStatus(`Joined room ${payload.roomCode}. Starting game...`);
      pushToast(`Joined room ${payload.roomCode}. Syncing mission.`, "success");
    });

    socket.on(SERVER_TO_CLIENT.GAME_STARTED, (payload: GameStartedPayload) => {
      setGameInfo(payload);
      setTurnState("awaiting-question");
      setEliminatedCodes(payload.yourBoardState.eliminatedFlagCodes);
      setIncomingQuestion(null);
      setLastAnswered(null);
      setRoundResult(null);
      setMatchWinnerId(null);
      setIsRoundTransitioning(false);
      setIsGuessModalOpen(false);
      setPendingQuestionText(null);
      setPendingGuessCode(null);
      setNextRoundDeadlineMs(null);
      setNextRoundCountdownMs(null);
      setRecentlyConfirmedFlagCode(null);
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
      setIncomingQuestion(null);
      setLastAnswered(null);
      setRoundResult(null);
      setScore({});
      setMatchWinnerId(null);
      setIsRoundTransitioning(false);
      setIsGuessModalOpen(false);
      setPendingQuestionText(null);
      setPendingGuessCode(null);
      setNextRoundDeadlineMs(null);
      setNextRoundCountdownMs(null);
      setRecentlyConfirmedFlagCode(null);
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
      setLastAnswered(payload);
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
        if (addedCode) {
          pulseConfirmedFlag(addedCode);
          pushToast(`${addedCode.toUpperCase()} eliminated from your board.`, "success");
          triggerHaptic(14);
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
  const canEliminate = !!(gameInfo && isYourTurn && turnState === "awaiting-asker-actions");
  const canEndTurn = canEliminate;
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
    if (!chatListRef.current) {
      return;
    }
    chatListRef.current.scrollTop = chatListRef.current.scrollHeight;
  }, [chatMessages]);

  const askQuestion = () => {
    if (!canAsk || !questionInput.trim()) {
      return;
    }
    const trimmedQuestion = questionInput.trim();
    playButtonClick();
    setPendingQuestionText(trimmedQuestion);
    pushToast("Sending question...", "info");
    socket.emit(CLIENT_TO_SERVER.ASK_QUESTION, { question: trimmedQuestion });
    setQuestionInput("");
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

  const eliminateFlag = (flagCode: string) => {
    if (!canEliminate) {
      return;
    }
    playButtonClick();
    triggerHaptic(10);
    socket.emit(CLIENT_TO_SERVER.ELIMINATE_FLAG, { flagCode });
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
    if (!chatInput.trim()) {
      return;
    }
    const trimmedChat = chatInput.trim();
    playButtonClick();
    pushToast("Transmitting chat...", "info");
    socket.emit(CLIENT_TO_SERVER.CHAT_MESSAGE, { text: trimmedChat });
    setChatInput("");
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
    setIsRulesModalOpen(true);
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

  const clampPanY = (candidateY: number, zoomLevel: number): number => {
    const viewportHeight = mapViewportRef.current?.clientHeight ?? 520;
    const minY = Math.min(0, viewportHeight - MAP_HEIGHT * zoomLevel);
    return Math.max(minY, Math.min(0, candidateY));
  };

  useEffect(() => {
    const viewport = mapViewportRef.current;
    if (!viewport) {
      return;
    }

    const onWheel = (event: WheelEvent) => {
      if (!event.altKey) {
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
    if (event.target instanceof HTMLElement && event.target.closest("button")) {
      return;
    }
    setIsPanning(true);
    panStartRef.current = { x: event.clientX - panRef.current.x, y: event.clientY - panRef.current.y };
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isPanning) {
      return;
    }
    scheduleViewportState(zoomRef.current, {
      x: event.clientX - panStartRef.current.x,
      y: clampPanY(event.clientY - panStartRef.current.y, zoomRef.current)
    });
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2) {
      const [touchA, touchB] = [event.touches[0], event.touches[1]];
      pinchDistanceRef.current = Math.hypot(touchB.clientX - touchA.clientX, touchB.clientY - touchA.clientY);
      return;
    }

    if (event.touches.length === 1) {
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

    if (event.touches.length === 1 && isPanning) {
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
    applyViewportState(1, { x: 0, y: 0 });
  };

  const tileSpan = MAP_WIDTH * zoom;
  const wrappedPanX = pan.x - Math.round(pan.x / tileSpan) * tileSpan;
  const tileOffsets = (import.meta.env.MODE === "test" ? [0] : [-1, 0, 1]).map((offset) => offset * MAP_WIDTH);

  const remainingFlags = activeFlagCodes.filter((flagCode) => !eliminatedCodes.includes(flagCode));
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
  const currentMissionLabel = roomCode ? `operation-${roomCode.toLowerCase()}` : "operation-pending";
  const nextRoundCountdownLabel = nextRoundCountdownMs !== null
    ? `${Math.max(0.1, nextRoundCountdownMs / 1000).toFixed(1)}s`
    : null;
  const areSecretsVisible = roundRevealPhase === "secrets" || roundRevealPhase === "settled";
  const heroPanelClassName = connected
    ? /Reconnecting|Unable/.test(status)
      ? "panel panel-wide hero-panel hero-panel-warning"
      : "panel panel-wide hero-panel"
    : "panel panel-wide hero-panel hero-panel-offline";
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

  return (
    <main className="app-shell">
      <header className={heroPanelClassName}>
        <div>
          <p className="eyebrow">Week 3 Build In Progress</p>
          <h1>.FALSE_FLAG//Global Signal</h1>
          <p className="status">{status}</p>
        </div>
        <div className="hero-right-column">
          <div className="hero-actions">
            <button type="button" onClick={openRulesModal}>How to Play</button>
          </div>
          <div className="hero-meta">
          <span className={connected ? "meta-pill meta-pill-online" : "meta-pill"}>
            uplink {connected ? "online" : "offline"}
          </span>
          <span className="meta-pill">mission {currentMissionLabel}</span>
          <span className="meta-pill">difficulty {roomDifficulty}</span>
          <span className="meta-pill">room {roomCode ?? "none"}</span>
          <span className="meta-pill">cell {seat ?? "pending"}</span>
          <span className="meta-pill">agent {playerId ?? "pending"}</span>
          </div>
        </div>
      </header>

      {toastMessages.length > 0 ? (
        <div className="toast-stack" aria-live="polite" aria-relevant="additions text">
          {toastMessages.map((message) => (
            <p key={message.id} className={`toast toast-${message.tone}`}>{message.text}</p>
          ))}
        </div>
      ) : null}

      <section className="panel panel-wide score-ribbon">
        <article className={yourScoreCardClassName}>
          <span className="score-label">{yourSideLabel} CELL</span>
          <strong>{yourScore}</strong>
          <span className="score-name">{lobby.displayName || "You"}</span>
        </article>

        <div className="score-center">
          <p className={turnBannerClassName}>{turnBannerText}</p>
          <p className="score-subtitle" data-testid="round-status">
            Round {gameInfo?.roundNumber ?? "-"} Â· First to {CHAMPIONSHIP_TARGET_WINS} wins
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

      <section className="panel">
        <h2>Mission Console</h2>

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
          <p className="difficulty-hint">
            Easy starts with 24 countries, Medium with 36, Hard with 48, and 007 uses the full global list.
          </p>
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
        {inviteStatus ? <p className="invite-status">{inviteStatus}</p> : null}

        <div className="controls controls-stack">
          <input
            value={questionInput}
            onChange={(event) => setQuestionInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                askQuestion();
              }
            }}
            placeholder="Ask a yes-or-no question"
            disabled={!canAsk}
          />
          <button onClick={askQuestion} disabled={!canAsk || !questionInput.trim()}>
            Ask
          </button>
        </div>

        <div className="status-list">
          <p>Current phase: {formatTurnState(turnState)}</p>
          <p>Eliminated flags: {eliminatedCodes.length}</p>
          <p>Round result: {roundResult ? formatRoundReason(roundResult.reason) : "pending"}</p>
        </div>

        {pendingQuestionText || pendingGuessCode || recentlyConfirmedFlagCode ? (
          <div className="feedback-chip-row" aria-live="polite">
            {pendingQuestionText ? <p className="feedback-chip feedback-chip-info">Question in flight</p> : null}
            {pendingGuessCode ? <p className="feedback-chip feedback-chip-warning">Guess locked: {pendingGuessCode.toUpperCase()}</p> : null}
            {recentlyConfirmedFlagCode ? <p className="feedback-chip feedback-chip-success">Confirmed eliminated: {recentlyConfirmedFlagCode.toUpperCase()}</p> : null}
          </div>
        ) : null}
      </section>

      <section className="panel round-panel">
        <h2>Intel Desk</h2>
        {!gameInfo ? (
          <p>Waiting for game start...</p>
        ) : (
          <>
            <div className="secret-slot secret-slot-featured">
              <div>
                <span className="slot-label">Your Hidden Location</span>
                <strong>{gameInfo.yourSecretFlag.toUpperCase()}</strong>
              </div>
              <img src={toFlagImage(gameInfo.yourSecretFlag)} alt={`${gameInfo.yourSecretFlag.toUpperCase()} secret flag`} loading="lazy" />
            </div>

            <div className="round-detail-grid">
              <div className="detail-card">
                <span className="slot-label">Active Agent</span>
                <strong className="active-agent-value">{gameInfo.activePlayerId}</strong>
              </div>
              <div className="detail-card">
                <span className="slot-label">Confirmed Intel</span>
                <strong>{yourScore}</strong>
              </div>
              <div className="detail-card">
                <span className="slot-label">Interrogation Round</span>
                <strong>{gameInfo.roundNumber}</strong>
              </div>
              <div className="detail-card">
                <span className="slot-label">Difficulty</span>
                <strong>{roomDifficulty.toUpperCase()}</strong>
              </div>
              <div className="detail-card">
                <span className="slot-label">Operation State</span>
                <strong>{formatTurnState(turnState)}</strong>
              </div>
            </div>

            {lastAnswered ? (
              <p className="event-strip">
                <span>Last Q and A: {lastAnswered.question}</span>
                <span className={lastAnswered.answer === "yes" ? "answer-badge answer-badge-yes" : "answer-badge answer-badge-no"}>
                  {lastAnswered.answer.toUpperCase()}
                </span>
              </p>
            ) : null}

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

            <div className="controls controls-stack action-row">
              <button onClick={endTurn} disabled={!canEndTurn}>End Turn</button>
              <button onClick={openGuessModal} disabled={!canGuess}>Make Guess</button>
            </div>
          </>
        )}
      </section>

      <section className="panel chat-panel">
        <div className="section-heading">
          <div>
            <h2>Intercept Channel</h2>
            <p className="section-subtitle">Questions, answers, and field chatter run through the same secure line.</p>
          </div>
        </div>

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

        <div className="controls controls-stack chat-composer">
          <input
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                sendChat();
              }
            }}
            placeholder="Chat message"
          />
          <button onClick={sendChat} disabled={!chatInput.trim()}>Send Chat</button>
        </div>
      </section>

      <section className="panel panel-wide board-panel">
        <div className="section-heading">
          <div>
            <h2>World Intel Board</h2>
            <p className="section-subtitle">Trace possible locations on the map. Hold Alt + wheel to zoom, or drag to pan. Eliminations only lock in after server confirmation.</p>
          </div>
          <p className="board-meta">{remainingFlags.length} candidate locations remaining</p>
        </div>

        <div
          ref={mapViewportRef}
          className={isPanning ? "map-stage map-stage-panning" : "map-stage"}
          aria-label="24 flag cards"
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
                  canEliminate={canEliminate}
                  onEliminate={eliminateFlag}
                />
              );
            })}
          </div>

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
                <li>Use Alt + mouse wheel (or pinch on touch devices) to zoom.</li>
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
    </main>
  );
}

