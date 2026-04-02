import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import {
  CLIENT_TO_SERVER,
  SERVER_TO_CLIENT,
  type RoomCreatedPayload,
  type GameStartedPayload,
  type ActionErrorPayload,
  type TurnState,
  type IncomingQuestionPayload,
  type QuestionAnsweredPayload,
  type BoardUpdatedPayload,
  type ChatMessageEventPayload,
  type SyncStatePayload,
  type RoundOverPayload
} from "@flagwho/shared";
import { socket } from "./socket";
import {
  playIncomingQuestion,
  playTurnChange,
  playRoundOver,
  playCorrectGuess,
  playWrongGuess
} from "./audio";

type LobbyState = {
  roomCodeInput: string;
  displayName: string;
};

const FLAG_CODES = [
  "us", "ca", "mx", "cu", "br", "ar",
  "co", "pe", "gb", "fr", "de", "it",
  "za", "ng", "eg", "ke", "cn", "in",
  "jp", "kr", "au", "nz", "tr", "sa"
];

const MAP_WIDTH = 2000;
const MAP_HEIGHT = 857;
type FlagMarkerPositions = Record<string, { x: number; y: number }>;

const FALLBACK_FLAG_MARKER_POSITIONS: FlagMarkerPositions = {
  us: { x: 455, y: 243 },
  ca: { x: 411, y: 162 },
  mx: { x: 433, y: 319 },
  cu: { x: 603, y: 301 },
  br: { x: 694, y: 476 },
  ar: { x: 644, y: 610 },
  co: { x: 585, y: 438 },
  pe: { x: 565, y: 516 },
  gb: { x: 983, y: 166 },
  fr: { x: 1011, y: 210 },
  de: { x: 1056, y: 186 },
  it: { x: 1069, y: 226 },
  za: { x: 1133, y: 571 },
  ng: { x: 1008, y: 394 },
  eg: { x: 1142, y: 313 },
  ke: { x: 1188, y: 462 },
  cn: { x: 1572, y: 262 },
  in: { x: 1433, y: 324 },
  jp: { x: 1767, y: 257 },
  kr: { x: 1711, y: 257 },
  au: { x: 1739, y: 548 },
  nz: { x: 1967, y: 624 },
  tr: { x: 1194, y: 243 },
  sa: { x: 1262, y: 355 }
};

const COUNTRY_GEOMETRY_SELECTORS: Record<string, string[]> = {
  us: [
    '[id="US"]',
    '[name="United States of America"]',
    '[name="United States"]',
    '[class~="United"][class~="States"]'
  ],
  ca: ['[id="CA"]', '[name="Canada"]', '[class~="Canada"]'],
  mx: ['[id="MX"]', '[name="Mexico"]', '[class~="Mexico"]'],
  cu: ['[id="CU"]', '[name="Cuba"]', '[class~="Cuba"]'],
  br: ['[id="BR"]', '[name="Brazil"]', '[class~="Brazil"]'],
  ar: ['[id="AR"]', '[name="Argentina"]', '[class~="Argentina"]'],
  co: ['[id="CO"]', '[name="Colombia"]', '[class~="Colombia"]'],
  pe: ['[id="PE"]', '[name="Peru"]', '[class~="Peru"]'],
  gb: ['[id="GB"]', '[name="United Kingdom"]', '[class~="United"][class~="Kingdom"]'],
  fr: ['[id="FR"]', '[name="France"]', '[class~="France"]'],
  de: ['[id="DE"]', '[name="Germany"]', '[class~="Germany"]'],
  it: ['[id="IT"]', '[name="Italy"]', '[class~="Italy"]'],
  za: ['[id="ZA"]', '[name="South Africa"]', '[class~="South"][class~="Africa"]'],
  ng: ['[id="NG"]', '[name="Nigeria"]', '[class~="Nigeria"]'],
  eg: ['[id="EG"]', '[name="Egypt"]', '[class~="Egypt"]'],
  ke: ['[id="KE"]', '[name="Kenya"]', '[class~="Kenya"]'],
  cn: ['[id="CN"]', '[name="China"]', '[class~="China"]'],
  in: ['[id="IN"]', '[name="India"]', '[class~="India"]'],
  jp: ['[id="JP"]', '[name="Japan"]', '[class~="Japan"]'],
  kr: ['[id="KR"]', '[name="Republic of Korea"]', '[name="South Korea"]', '[class~="Korea"]'],
  au: ['[id="AU"]', '[name="Australia"]', '[class~="Australia"]'],
  nz: ['[id="NZ"]', '[name="New Zealand"]', '[class~="New"][class~="Zealand"]'],
  tr: ['[id="TR"]', '[name="Turkey"]', '[name="TÃ¼rkiye"]', '[class~="Turkey"]'],
  sa: ['[id="SA"]', '[name="Saudi Arabia"]', '[class~="Saudi"][class~="Arabia"]']
};

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

function WorldMapBackdrop() {
  return (
    <svg viewBox="0 0 2000 857" className="world-map-svg" aria-hidden="true" focusable="false">
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="4" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <image className="map-source-image" href="/world.svg" x="0" y="0" width="2000" height="857" />
      <g className="map-grid" filter="url(#glow)">
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
  const [turnState, setTurnState] = useState<TurnState | null>(null);
  const [questionInput, setQuestionInput] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [incomingQuestion, setIncomingQuestion] = useState<string | null>(null);
  const [lastAnswered, setLastAnswered] = useState<string | null>(null);
  const [eliminatedCodes, setEliminatedCodes] = useState<string[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessageEventPayload[]>([]);
  const [roundResult, setRoundResult] = useState<RoundOverPayload | null>(null);
  const [score, setScore] = useState<Record<string, number>>({});
  const [matchWinnerId, setMatchWinnerId] = useState<string | null>(null);
  const [isRoundTransitioning, setIsRoundTransitioning] = useState(false);
  const [guessFlagCode, setGuessFlagCode] = useState(FLAG_CODES[0]);
  const [isGuessPickerOpen, setIsGuessPickerOpen] = useState(false);
  const [isGuessModalOpen, setIsGuessModalOpen] = useState(false);
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [flagMarkerPositions, setFlagMarkerPositions] = useState<FlagMarkerPositions>({ ...FALLBACK_FLAG_MARKER_POSITIONS });
  const mapViewportRef = useRef<HTMLDivElement | null>(null);
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const guessModalRef = useRef<HTMLDivElement | null>(null);
  const guessPickerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const guessPickerOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const guessPickerTypeaheadRef = useRef("");
  const guessPickerTypeaheadTimerRef = useRef<number | null>(null);
  const panStartRef = useRef({ x: 0, y: 0 });
  const pinchDistanceRef = useRef<number | null>(null);
  const inviteStatusTimerRef = useRef<number | null>(null);

  const patchGameInfo = (patch: Partial<GameStartedPayload>) => {
    setGameInfo((current) => (current ? { ...current, ...patch } : current));
  };

  useEffect(() => {
    let didCancel = false;

    const resolveMarkerCentroids = async () => {
      try {
        const response = await fetch("/world.svg");
        if (!response.ok) {
          return;
        }

        const svgText = await response.text();
        const parser = new DOMParser();
        const parsed = parser.parseFromString(svgText, "image/svg+xml");
        const sourceSvg = parsed.querySelector("svg");
        if (!sourceSvg) {
          return;
        }

        const mount = document.createElement("div");
        mount.style.position = "absolute";
        mount.style.left = "-10000px";
        mount.style.top = "-10000px";
        mount.style.width = "0";
        mount.style.height = "0";
        mount.style.overflow = "hidden";

        const renderSvg = document.importNode(sourceSvg, true) as SVGSVGElement;
        mount.appendChild(renderSvg);
        document.body.appendChild(mount);

        const nextPositions: FlagMarkerPositions = { ...FALLBACK_FLAG_MARKER_POSITIONS };

        for (const flagCode of FLAG_CODES) {
          const selectors = COUNTRY_GEOMETRY_SELECTORS[flagCode] ?? [];
          const shapeSet = new Set<SVGGraphicsElement>();

          for (const selector of selectors) {
            renderSvg.querySelectorAll(selector).forEach((node) => {
              if (node instanceof SVGGraphicsElement) {
                shapeSet.add(node);
              }
            });
          }

          if (shapeSet.size === 0) {
            continue;
          }

          let minX = Number.POSITIVE_INFINITY;
          let minY = Number.POSITIVE_INFINITY;
          let maxX = Number.NEGATIVE_INFINITY;
          let maxY = Number.NEGATIVE_INFINITY;

          shapeSet.forEach((shape) => {
            const box = shape.getBBox();
            minX = Math.min(minX, box.x);
            minY = Math.min(minY, box.y);
            maxX = Math.max(maxX, box.x + box.width);
            maxY = Math.max(maxY, box.y + box.height);
          });

          if (Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)) {
            const samplingStep = 3;
            let sumX = 0;
            let sumY = 0;
            let sampleCount = 0;

            for (let sampleY = minY; sampleY <= maxY; sampleY += samplingStep) {
              for (let sampleX = minX; sampleX <= maxX; sampleX += samplingStep) {
                const point = new DOMPoint(sampleX, sampleY);
                const isInside = Array.from(shapeSet).some((shape) => {
                  if (!(shape instanceof SVGGeometryElement)) {
                    return false;
                  }
                  return shape.isPointInFill(point);
                });

                if (isInside) {
                  sumX += sampleX;
                  sumY += sampleY;
                  sampleCount += 1;
                }
              }
            }

            if (sampleCount > 0) {
              nextPositions[flagCode] = {
                x: sumX / sampleCount,
                y: sumY / sampleCount
              };
            } else {
              nextPositions[flagCode] = {
                x: (minX + maxX) / 2,
                y: (minY + maxY) / 2
              };
            }
          }
        }

        mount.remove();

        if (!didCancel) {
          setFlagMarkerPositions(nextPositions);
        }
      } catch {
        // Keep fallback marker positions when SVG parsing fails.
      }
    };

    void resolveMarkerCentroids();

    return () => {
      didCancel = true;
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
    };
  }, []);

  useEffect(() => {
    socket.connect();

    const onConnect = () => {
      setConnected(true);
      setStatus("Connected to server");
    };

    const onDisconnect = () => {
      setConnected(false);
      setStatus("Disconnected");
    };

    const onConnectError = () => {
      setStatus("Connection lost. Retrying...");
    };

    const onReconnectAttempt = (attempt: number) => {
      setStatus(`Reconnecting (attempt ${attempt})...`);
    };

    const onReconnectFailed = () => {
      setStatus("Unable to reconnect to server.");
    };

    const manager = socket.io;

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    manager?.on("reconnect_attempt", onReconnectAttempt);
    manager?.on("reconnect_failed", onReconnectFailed);

    socket.on(SERVER_TO_CLIENT.ROOM_CREATED, (payload: RoomCreatedPayload) => {
      setPlayerId(payload.playerId);
      setSeat(payload.seat);
      setRoomCode(payload.roomCode);
      setStatus(`Room ${payload.roomCode} created. Waiting for opponent.`);
    });

    socket.on(SERVER_TO_CLIENT.ROOM_JOINED, (payload: RoomCreatedPayload) => {
      setPlayerId(payload.playerId);
      setSeat(payload.seat);
      setRoomCode(payload.roomCode);
      setStatus(`Joined room ${payload.roomCode}. Starting game...`);
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
      setGuessFlagCode(FLAG_CODES[0]);
      setStatus("Game started");
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
      setGuessFlagCode(FLAG_CODES[0]);
      setStatus("New game started");
    });

    socket.on(SERVER_TO_CLIENT.TURN_STATE_CHANGED, (payload: { state: TurnState }) => {
      setTurnState(payload.state);
    });

    socket.on(SERVER_TO_CLIENT.TURN_ENDED, (payload: { nextActivePlayerId: string }) => {
      patchGameInfo({ activePlayerId: payload.nextActivePlayerId });
      playTurnChange();
    });

    socket.on(SERVER_TO_CLIENT.INCOMING_QUESTION, (payload: IncomingQuestionPayload) => {
      setIncomingQuestion(payload.question);
      playIncomingQuestion();
    });

    socket.on(SERVER_TO_CLIENT.QUESTION_ANSWERED, (payload: QuestionAnsweredPayload) => {
      setLastAnswered(`${payload.question} -> ${payload.answer.toUpperCase()}`);
      setIncomingQuestion(null);
    });

    socket.on(SERVER_TO_CLIENT.BOARD_UPDATED, (payload: BoardUpdatedPayload) => {
      setEliminatedCodes(payload.eliminatedFlagCodes);
    });

    socket.on(SERVER_TO_CLIENT.CHAT_MESSAGE, (payload: ChatMessageEventPayload) => {
      setChatMessages((messages) => [...messages.slice(-39), payload]);
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
      setRoundResult(payload);
      setTurnState("round-over");
      setIsRoundTransitioning(true);
      setIsGuessModalOpen(false);
      setStatus(`Round over: ${payload.reason}`);
      playRoundOver();
      if (payload.reason === "correct-guess") {
        setTimeout(playCorrectGuess, 300);
      } else {
        setTimeout(playWrongGuess, 300);
      }
    });

    socket.on(SERVER_TO_CLIENT.SCORE_UPDATED, (payload: { matchScore: Record<string, number> }) => {
      setScore(payload.matchScore);
    });

    socket.on(SERVER_TO_CLIENT.MATCH_OVER, (payload: { winnerPlayerId: string | null }) => {
      setMatchWinnerId(payload.winnerPlayerId ?? null);
      setIsRoundTransitioning(false);
      setStatus("Match over");
    });

    socket.on(SERVER_TO_CLIENT.ACTION_ERROR, (payload: ActionErrorPayload) => {
      setStatus(`Error: ${payload.code} - ${payload.message}`);
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
    socket.emit(CLIENT_TO_SERVER.CREATE_ROOM, { displayName: lobby.displayName || undefined });
  };

  const joinRoom = () => {
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
    const nextGuessOptions = FLAG_CODES.filter((flagCode) => !eliminatedCodes.includes(flagCode));
    const fallbackOptions = nextGuessOptions.length > 0 ? nextGuessOptions : FLAG_CODES;
    if (!fallbackOptions.includes(guessFlagCode)) {
      setGuessFlagCode(fallbackOptions[0]);
    }
  }, [eliminatedCodes, guessFlagCode]);

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
    if (!chatListRef.current) {
      return;
    }
    chatListRef.current.scrollTop = chatListRef.current.scrollHeight;
  }, [chatMessages]);

  const askQuestion = () => {
    if (!canAsk || !questionInput.trim()) {
      return;
    }
    socket.emit(CLIENT_TO_SERVER.ASK_QUESTION, { question: questionInput.trim() });
    setQuestionInput("");
  };

  const answerQuestion = (answer: "yes" | "no") => {
    if (!canAnswer) {
      return;
    }
    socket.emit(CLIENT_TO_SERVER.ANSWER_QUESTION, { answer });
  };

  const eliminateFlag = (flagCode: string) => {
    if (!canEliminate) {
      return;
    }
    socket.emit(CLIENT_TO_SERVER.ELIMINATE_FLAG, { flagCode });
  };

  const endTurn = () => {
    if (!canEndTurn) {
      return;
    }
    socket.emit(CLIENT_TO_SERVER.END_TURN, {});
  };

  const sendChat = () => {
    if (!chatInput.trim()) {
      return;
    }
    socket.emit(CLIENT_TO_SERVER.CHAT_MESSAGE, { text: chatInput.trim() });
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
    socket.emit(CLIENT_TO_SERVER.MAKE_GUESS, { guessedFlagCode: guessFlagCode });
    closeGuessModal();
  };

  const startNewGame = () => {
    socket.emit(CLIENT_TO_SERVER.NEW_GAME, {});
  };

  const openGuessModal = () => {
    if (!canGuess) {
      return;
    }
    setIsGuessPickerOpen(false);
    setIsGuessModalOpen(true);
  };

  const startFreshRoom = () => {
    window.location.reload();
  };

  const copyInviteLink = async () => {
    if (!inviteLink) {
      return;
    }

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
    } catch {
      updateInviteStatus("Copy failed");
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
      const nextZoom = Math.max(1, Math.min(4, zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
      const scaleRatio = nextZoom / zoom;

      const nextPanX = offsetX - (offsetX - pan.x) * scaleRatio;
      const nextPanY = clampPanY(offsetY - (offsetY - pan.y) * scaleRatio, nextZoom);

      setZoom(nextZoom);
      setPan({ x: nextPanX, y: nextPanY });
    };

    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", onWheel);
    };
  }, [pan.x, pan.y, zoom]);

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && event.target.closest("button")) {
      return;
    }
    setIsPanning(true);
    panStartRef.current = { x: event.clientX - pan.x, y: event.clientY - pan.y };
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isPanning) {
      return;
    }
    setPan({
      x: event.clientX - panStartRef.current.x,
      y: clampPanY(event.clientY - panStartRef.current.y, zoom)
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
        x: event.touches[0].clientX - pan.x,
        y: event.touches[0].clientY - pan.y
      };
    }
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2 && pinchDistanceRef.current) {
      event.preventDefault();
      const [touchA, touchB] = [event.touches[0], event.touches[1]];
      const nextDistance = Math.hypot(touchB.clientX - touchA.clientX, touchB.clientY - touchA.clientY);
      const nextZoom = Math.max(1, Math.min(4, zoom * (nextDistance / pinchDistanceRef.current)));
      setZoom(nextZoom);
      setPan((current) => ({ ...current, y: clampPanY(current.y, nextZoom) }));
      pinchDistanceRef.current = nextDistance;
      return;
    }

    if (event.touches.length === 1 && isPanning) {
      setPan({
        x: event.touches[0].clientX - panStartRef.current.x,
        y: clampPanY(event.touches[0].clientY - panStartRef.current.y, zoom)
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
    const nextZoom = Math.min(4, zoom + 0.2);
    setZoom(nextZoom);
    setPan((current) => ({ ...current, y: clampPanY(current.y, nextZoom) }));
  };

  const zoomOut = () => {
    const nextZoom = Math.max(1, zoom - 0.2);
    setZoom(nextZoom);
    setPan((current) => ({ ...current, y: clampPanY(current.y, nextZoom) }));
  };

  const resetMapView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const tileSpan = MAP_WIDTH * zoom;
  const wrappedPanX = pan.x - Math.round(pan.x / tileSpan) * tileSpan;
  const tileOffsets = (import.meta.env.MODE === "test" ? [0] : [-1, 0, 1]).map((offset) => offset * MAP_WIDTH);

  const remainingFlags = FLAG_CODES.filter((flagCode) => !eliminatedCodes.includes(flagCode));
  const guessOptions = remainingFlags.length > 0 ? remainingFlags : FLAG_CODES;
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

  return (
    <main className="app-shell">
      <header className="panel panel-wide hero-panel">
        <div>
          <p className="eyebrow">Week 3 Build In Progress</p>
          <h1>.FALSE_FLAG//Global Signal</h1>
          <p className="status">{status}</p>
        </div>
        <div className="hero-meta">
          <span className={connected ? "meta-pill meta-pill-online" : "meta-pill"}>
            uplink {connected ? "online" : "offline"}
          </span>
          <span className="meta-pill">mission {currentMissionLabel}</span>
          <span className="meta-pill">room {roomCode ?? "none"}</span>
          <span className="meta-pill">cell {seat ?? "pending"}</span>
          <span className="meta-pill">agent {playerId ?? "pending"}</span>
        </div>
      </header>

      <section className="panel panel-wide score-ribbon">
        <article className={seat === "p2" ? "score-card score-card-blue" : "score-card score-card-red"}>
          <span className="score-label">{yourSideLabel} CELL</span>
          <strong>{yourScore}</strong>
          <span className="score-name">{lobby.displayName || "You"}</span>
        </article>

        <div className="score-center">
          <p className={turnBannerClassName}>{turnBannerText}</p>
          <p className="score-subtitle">
            Round {gameInfo?.roundNumber ?? "-"} Â· First to {CHAMPIONSHIP_TARGET_WINS} wins
          </p>
          {isRoundTransitioning && !matchWinnerId ? (
            <p className="round-transition-banner" aria-live="polite">NEXT ROUND INITIALIZING...</p>
          ) : null}
        </div>

        <article className={seat === "p1" ? "score-card score-card-blue" : "score-card score-card-red"}>
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
            Copy Invite
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
            placeholder="Ask a yes/no question"
            disabled={!canAsk}
          />
          <button onClick={askQuestion} disabled={!canAsk || !questionInput.trim()}>
            Ask
          </button>
        </div>

        <div className="status-list">
          <p>Turn state: {formatTurnState(turnState)}</p>
          <p>Eliminated flags: {eliminatedCodes.length}</p>
          <p>Round result: {roundResult ? formatRoundReason(roundResult.reason) : "pending"}</p>
        </div>
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
                <span className="slot-label">Operation State</span>
                <strong>{formatTurnState(turnState)}</strong>
              </div>
            </div>

            {lastAnswered ? <p className="event-strip">Last Q/A: {lastAnswered}</p> : null}

            {roundResult ? (
              <div className="result-card">
                <p className="result-title">Round result: {formatRoundReason(roundResult.reason)}</p>
                <p>Your location was {yourSecretReveal?.toUpperCase() ?? "hidden"}.</p>
                <p>Opponent location was {opponentSecretReveal?.toUpperCase() ?? "hidden"}.</p>
              </div>
            ) : null}

            {matchWinnerId ? (
              <div className="result-card result-card-match">
                <p className="result-title">Match winner: {matchWinnerId === playerId ? "You" : "Opponent"}</p>
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
          <div className="incoming-card">
            <p className="incoming-label">Incoming interrogation</p>
            <strong>{incomingQuestion}</strong>
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
            style={{ transform: `translate(${wrappedPanX}px, ${pan.y}px) scale(${zoom})` }}
          >
            {tileOffsets.map((tileOffset) => (
              <div key={tileOffset} className="map-tile" style={{ left: `${tileOffset}px` }}>
                <WorldMapBackdrop />
              </div>
            ))}
            {FLAG_CODES.map((flagCode) => {
              const marker = flagMarkerPositions[flagCode];
              return (
                <button
                  key={`${flagCode}-marker`}
                  className={eliminatedCodes.includes(flagCode) ? "flag-card map-flag-card flag-card-eliminated" : "flag-card map-flag-card"}
                  type="button"
                  aria-label={flagCode.toUpperCase()}
                  tabIndex={0}
                  style={{
                    left: `${marker.x}px`,
                    top: `${marker.y}px`,
                    "--marker-scale": `${1 / zoom}`,
                    pointerEvents: "auto"
                  } as CSSProperties}
                  onClick={() => {
                    eliminateFlag(flagCode);
                  }}
                  disabled={!canEliminate}
                >
                  <img src={toFlagImage(flagCode)} alt={flagCode.toUpperCase()} loading="lazy" />
                  <span>{flagCode.toUpperCase()}</span>
                </button>
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
          <span><i className="legend-dot legend-dot-dead" /> Eliminated lead</span>
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
    </main>
  );
}

