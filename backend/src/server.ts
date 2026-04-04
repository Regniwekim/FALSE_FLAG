import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";
import {
  CLIENT_TO_SERVER,
  ERROR_CODES,
  ROOM_DIFFICULTIES,
  SERVER_TO_CLIENT,
  type CreateRoomPayload,
  type RoomDifficulty,
  type JoinRoomPayload,
  type ReconnectRoomPayload,
  type AskQuestionPayload,
  type AnswerQuestionPayload,
  type MakeGuessPayload,
  type SetFlagEliminationPayload,
  type ChatMessagePayload
} from "@flagwho/shared";
import { RoomManager } from "./room-manager.js";
import { GameEngine } from "./game-engine.js";
import { EventValidator } from "./event-validator.js";
import { auditLog } from "./audit-logger.js";
import type { RoomState } from "./types.js";

const NEXT_ROUND_TRANSITION_MS = 1200;

function getAllowedOrigins() {
  return (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

function isAllowedOrigin(origin: string | undefined, allowedOrigins: string[]) {
  if (!origin) {
    return true;
  }

  if (allowedOrigins.length === 0) {
    return true;
  }

  if (allowedOrigins.includes("*")) {
    return true;
  }

  return allowedOrigins.includes(origin);
}

function emitError(socket: Socket, code: string, message: string, details: Record<string, unknown> = {}) {
  auditLog("action_error", { socketId: socket.id, code, message, ...details });
  socket.emit(SERVER_TO_CLIENT.ACTION_ERROR, { code, message });
}

function getRoomCleanupGraceMs() {
  if (typeof process.env.ROOM_CLEANUP_GRACE_MS === "string" && process.env.ROOM_CLEANUP_GRACE_MS.trim().length > 0) {
    const parsed = Number(process.env.ROOM_CLEANUP_GRACE_MS);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return 30_000;
}

const RATE_LIMIT_WINDOW_MS = 1000;
const MAX_EVENTS_PER_WINDOW = 8;

const roomCleanupTimers = new Map<string, NodeJS.Timeout>();
const eventRateState = new Map<string, { windowStart: number; count: number }>();
const processedEventIds = new Map<string, Set<string>>();
let totalDisconnects = 0;
let totalRateLimited = 0;
let totalDuplicateEvents = 0;
let totalRoomsClosed = 0;

function shouldRateLimit(socket: Socket) {
  const now = Date.now();
  const state = eventRateState.get(socket.id);
  if (!state || now - state.windowStart >= RATE_LIMIT_WINDOW_MS) {
    eventRateState.set(socket.id, { windowStart: now, count: 1 });
    return false;
  }

  state.count += 1;
  if (state.count > MAX_EVENTS_PER_WINDOW) {
    totalRateLimited += 1;
    auditLog("rate_limited", { socketId: socket.id, count: state.count });
    return true;
  }

  return false;
}

function isDuplicateEvent(socket: Socket, payload: { clientEventId?: string }, actorPlayerId?: string) {
  const eventId = payload?.clientEventId;
  if (!eventId) {
    return false;
  }

  const dedupeKey = actorPlayerId ?? socket.id;
  let idSet = processedEventIds.get(dedupeKey);
  if (!idSet) {
    idSet = new Set();
    processedEventIds.set(dedupeKey, idSet);
  }

  if (idSet.has(eventId)) {
    totalDuplicateEvents += 1;
    auditLog("duplicate_event", { socketId: socket.id, playerId: actorPlayerId, eventId });
    return true;
  }

  idSet.add(eventId);
  if (idSet.size > 1000) {
    const [first] = idSet;
    idSet.delete(first);
  }
  return false;
}

function cancelRoomCleanup(roomCode: string) {
  const timer = roomCleanupTimers.get(roomCode);
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  roomCleanupTimers.delete(roomCode);
}

function scheduleRoomCleanup(roomManager: RoomManager, room: RoomState) {
  cancelRoomCleanup(room.roomCode);
  const timer = setTimeout(() => {
    roomManager.closeRoom(room.roomCode);
    roomCleanupTimers.delete(room.roomCode);
    totalRoomsClosed += 1;
    auditLog("room_closed", { roomCode: room.roomCode, reason: "disconnect_timeout" });
  }, getRoomCleanupGraceMs());
  roomCleanupTimers.set(room.roomCode, timer);
}

function updateRoomCleanup(roomManager: RoomManager, room: RoomState) {
  if (room.players.every((player) => player.socketId === null)) {
    scheduleRoomCleanup(roomManager, room);
    return;
  }
  cancelRoomCleanup(room.roomCode);
}

function getStatusPayload(roomManager: RoomManager) {
  return {
    activeRooms: roomManager.getRoomCount(),
    pendingRoomCleanups: roomCleanupTimers.size,
    roomCleanupGraceMs: getRoomCleanupGraceMs(),
    roomsClosed: totalRoomsClosed,
    totalDisconnects,
    totalRateLimited,
    totalDuplicateEvents,
    timestamp: new Date().toISOString()
  };
}

function emitRoomChatMessage(io: Server, room: RoomState, fromPlayerId: string, text: string) {
  const message = {
    fromPlayerId,
    text,
    createdAt: new Date().toISOString()
  };
  room.chatLog.push(message);
  io.to(room.roomCode).emit(SERVER_TO_CLIENT.CHAT_MESSAGE, message);
}

function normalizeDifficulty(candidate: unknown): RoomDifficulty {
  if (typeof candidate !== "string") {
    return "easy";
  }
  return ROOM_DIFFICULTIES.includes(candidate as RoomDifficulty) ? (candidate as RoomDifficulty) : "easy";
}

function emitPrivateState(io: Server, gameEngine: GameEngine, room: RoomState) {
  for (const roomPlayer of room.players) {
    const targetSocket = roomPlayer.socketId ? io.sockets.sockets.get(roomPlayer.socketId) : undefined;
    const view = gameEngine.getPlayerView(room, roomPlayer.playerId);
    if (targetSocket && view) {
      targetSocket.emit(SERVER_TO_CLIENT.SYNC_STATE, {
        roundNumber: room.round?.roundNumber,
        turnState: room.round?.turnState,
        activePlayerId: room.round?.activePlayerId,
        yourSecretFlag: view.yourSecretFlag,
        availableFlagCodes: view.availableFlagCodes,
        yourBoardState: view.yourBoardState,
        roomStatus: room.status
      });
    }
  }
}

export function createRealtimeApp() {
  const app = express();
  const allowedOrigins = getAllowedOrigins();

  roomCleanupTimers.forEach((timer) => clearTimeout(timer));
  roomCleanupTimers.clear();
  eventRateState.clear();
  processedEventIds.clear();
  totalDisconnects = 0;
  totalRateLimited = 0;
  totalDuplicateEvents = 0;

  if (allowedOrigins.length === 0 && process.env.NODE_ENV !== "test") {
    console.warn("CORS_ORIGINS is not set. Allowing all origins.");
  } else if (allowedOrigins.length > 0) {
    console.log(`CORS allowlist enabled for ${allowedOrigins.length} origin(s).`);
  }

  app.use(
    cors({
      origin: (origin, callback) => {
        if (isAllowedOrigin(origin, allowedOrigins)) {
          callback(null, true);
          return;
        }

        callback(new Error("Origin not allowed by CORS policy."));
      }
    })
  );
  app.get("/health", (_req: express.Request, res: express.Response) => {
    res.json({ ok: true });
  });

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (isAllowedOrigin(origin, allowedOrigins)) {
          callback(null, true);
          return;
        }

        callback(new Error("Origin not allowed by CORS policy."), false);
      }
    }
  });

  const roomManager = new RoomManager();
  const gameEngine = new GameEngine();
  const validator = new EventValidator();

  app.get("/status", (_req: express.Request, res: express.Response) => {
    res.json(getStatusPayload(roomManager));
  });

  io.on("connection", (socket) => {
    socket.on(CLIENT_TO_SERVER.CREATE_ROOM, (payload: CreateRoomPayload = {}) => {
      if (shouldRateLimit(socket)) {
        emitError(socket, ERROR_CODES.RATE_LIMITED, "Too many actions. Please wait a moment.");
        return;
      }
      if (isDuplicateEvent(socket, payload)) {
        emitError(socket, ERROR_CODES.INVALID_STATE, "Duplicate request ignored.");
        return;
      }

      const existingRoom = roomManager.findPlayerRoom(socket.id);
      if (existingRoom) {
        emitError(socket, ERROR_CODES.ALREADY_IN_ROOM, "You are already in a room.");
        return;
      }

      const difficulty = normalizeDifficulty(payload.difficulty);
      const { room, player } = roomManager.createRoom(socket.id, payload.displayName ?? "Player 1", difficulty);
      socket.join(room.roomCode);
      socket.emit(SERVER_TO_CLIENT.ROOM_CREATED, {
        roomCode: room.roomCode,
        playerId: player.playerId,
        seat: player.seat,
        difficulty: room.difficulty
      });
    });

    socket.on(CLIENT_TO_SERVER.JOIN_ROOM, (payload: JoinRoomPayload) => {
      if (shouldRateLimit(socket)) {
        console.log(`[RECONNECT_ROOM] Received from socket ${socket.id}:`, payload);
        emitError(socket, ERROR_CODES.RATE_LIMITED, "Too many actions. Please wait a moment.");
        return;
      }
      if (isDuplicateEvent(socket, payload)) {
        emitError(socket, ERROR_CODES.INVALID_STATE, "Duplicate request ignored.");
        return;
      }
      const existingRoom = roomManager.findPlayerRoom(socket.id);
      if (existingRoom) {
        emitError(socket, ERROR_CODES.ALREADY_IN_ROOM, "You are already in a room.");
        return;
      }

      const result = roomManager.joinRoom(payload.roomCode, socket.id, payload.displayName ?? "Player 2");
      if ("error" in result) {
        const errorCode = result.error === "ROOM_FULL" ? ERROR_CODES.ROOM_FULL : ERROR_CODES.ROOM_NOT_FOUND;
        const message = result.error === "ROOM_FULL" ? "Room is full." : "Room not found.";
        emitError(socket, errorCode, message);
        return;
      }

      const { room, player } = result;
      socket.join(room.roomCode);
      socket.emit(SERVER_TO_CLIENT.ROOM_JOINED, {
        roomCode: room.roomCode,
        playerId: player.playerId,
        seat: player.seat,
        difficulty: room.difficulty
      });

        // Backend logging: Reconnect result sent
        console.log(`[RECONNECT_ROOM] RECONNECT_SUCCESS sent to socket ${socket.id} for playerId=${player.playerId}, roomCode=${room.roomCode}`);
      io.to(room.roomCode).emit(SERVER_TO_CLIENT.PLAYER_JOINED, {
        playerId: player.playerId,
        seat: player.seat
      });

      if (room.players.length === 2) {
        gameEngine.initializeRound(room);
        for (const roomPlayer of room.players) {
          const targetSocket = roomPlayer.socketId ? io.sockets.sockets.get(roomPlayer.socketId) : undefined;
          const view = gameEngine.getPlayerView(room, roomPlayer.playerId);
          if (targetSocket && view) {
            targetSocket.emit(SERVER_TO_CLIENT.GAME_STARTED, view);
          }
        }
      }

    socket.on(CLIENT_TO_SERVER.RECONNECT_ROOM, (payload: ReconnectRoomPayload) => {
      if (shouldRateLimit(socket)) {
        emitError(socket, ERROR_CODES.RATE_LIMITED, "Too many actions. Please wait a moment.");
        return;
      }
      if (isDuplicateEvent(socket, payload, payload.playerId)) {
        emitError(socket, ERROR_CODES.INVALID_STATE, "Duplicate request ignored.");
        return;
      }

      const room = roomManager.getRoom(payload.roomCode);
      if (!room) {
        emitError(socket, ERROR_CODES.ROOM_NOT_FOUND, "Room not found.");
        return;
      }

      const player = room.players.find((player) => player.playerId === payload.playerId);
      if (!player) {
        emitError(socket, ERROR_CODES.INVALID_STATE, "Player session not found.");
        return;
      }

      player.socketId = socket.id;
      socket.join(room.roomCode);
      cancelRoomCleanup(room.roomCode);

      socket.emit(SERVER_TO_CLIENT.RECONNECT_SUCCESS, {
        roomCode: room.roomCode,
        playerId: player.playerId,
        seat: player.seat,
        difficulty: room.difficulty,
        roomStatus: room.status
      });

      if (room.players.some((roomPlayer) => roomPlayer.playerId !== player.playerId && roomPlayer.socketId)) {
        socket.to(room.roomCode).emit(SERVER_TO_CLIENT.PLAYER_JOINED, {
          playerId: player.playerId,
          seat: player.seat
        });
      }

      emitPrivateState(io, gameEngine, room);
    });

    socket.on(CLIENT_TO_SERVER.ASK_QUESTION, (payload: AskQuestionPayload) => {
      if (shouldRateLimit(socket)) {
        emitError(socket, ERROR_CODES.RATE_LIMITED, "Too many actions. Please wait a moment.");
        return;
      }

      const room = roomManager.findPlayerRoom(socket.id);
      if (!room || !room.round) {
        emitError(socket, ERROR_CODES.INVALID_STATE, "No active game room.");
        return;
      }

      const actor = room.players.find((player) => player.socketId === socket.id);
      if (!actor) {
        emitError(socket, ERROR_CODES.INVALID_STATE, "Player not found in room.");
        return;
      }
      if (isDuplicateEvent(socket, payload, actor.playerId)) {
        emitError(socket, ERROR_CODES.INVALID_STATE, "Duplicate request ignored.");
        return;
      }

      const validation = validator.validateAskQuestion(room, actor.playerId, payload?.question as string);
      if (!validation.ok) {
        emitError(socket, validation.code ?? ERROR_CODES.INVALID_STATE, validation.message ?? "Invalid action.");
        return;
      }

      const question = payload.question.trim();
      room.round.pendingQuestion = { askedByPlayerId: actor.playerId, text: question };
      room.round.turnState = "awaiting-answer";

      socket.emit(SERVER_TO_CLIENT.QUESTION_ACCEPTED, {
        question
      });
      socket.to(room.roomCode).emit(SERVER_TO_CLIENT.INCOMING_QUESTION, {
        fromPlayerId: actor.playerId,
        question
      });
      emitRoomChatMessage(io, room, actor.playerId, question);
      io.to(room.roomCode).emit(SERVER_TO_CLIENT.TURN_STATE_CHANGED, { state: room.round.turnState });
    });

    socket.on(CLIENT_TO_SERVER.ANSWER_QUESTION, (payload: AnswerQuestionPayload) => {
      if (shouldRateLimit(socket)) {
        emitError(socket, ERROR_CODES.RATE_LIMITED, "Too many actions. Please wait a moment.");
        return;
      }

      const room = roomManager.findPlayerRoom(socket.id);
      if (!room || !room.round || !room.round.pendingQuestion) {
        emitError(socket, ERROR_CODES.INVALID_STATE, "No question is awaiting an answer.");
        return;
      }

      const actor = room.players.find((player) => player.socketId === socket.id);
      if (!actor) {
        emitError(socket, ERROR_CODES.INVALID_STATE, "Player not found in room.");
        return;
      }
      if (isDuplicateEvent(socket, payload, actor.playerId)) {
        emitError(socket, ERROR_CODES.INVALID_STATE, "Duplicate request ignored.");
        return;
      }

      const validation = validator.validateAnswerQuestion(room, actor.playerId, payload?.answer);
      if (!validation.ok) {
        emitError(socket, validation.code ?? ERROR_CODES.INVALID_STATE, validation.message ?? "Invalid action.");
        return;
      }

      const answer = payload.answer;
      const question = room.round.pendingQuestion.text;
      gameEngine.resolveAnswer(room, answer);

      io.to(room.roomCode).emit(SERVER_TO_CLIENT.QUESTION_ANSWERED, {
        question,
        answer,
        answeredByPlayerId: actor.playerId
      });
      emitRoomChatMessage(io, room, actor.playerId, `Answer: ${answer.toUpperCase()}`);
      io.to(room.roomCode).emit(SERVER_TO_CLIENT.TURN_STATE_CHANGED, { state: room.round.turnState });
    });

    socket.on(CLIENT_TO_SERVER.END_TURN, () => {
      if (shouldRateLimit(socket)) {
        emitError(socket, ERROR_CODES.RATE_LIMITED, "Too many actions. Please wait a moment.");
        return;
      }

      const room = roomManager.findPlayerRoom(socket.id);
      if (!room || !room.round) {
        emitError(socket, ERROR_CODES.INVALID_STATE, "No active game room.");
        return;
      }

      const actor = room.players.find((player) => player.socketId === socket.id);
      if (!actor) {
        emitError(socket, ERROR_CODES.INVALID_STATE, "Player not found in room.");
        return;
      }

      const validation = validator.validateEndTurn(room, actor.playerId);
      if (!validation.ok) {
        emitError(socket, validation.code ?? ERROR_CODES.INVALID_STATE, validation.message ?? "Invalid action.");
        return;
      }

      gameEngine.endTurn(room);
      io.to(room.roomCode).emit(SERVER_TO_CLIENT.TURN_ENDED, {
        nextActivePlayerId: room.round.activePlayerId
      });
      io.to(room.roomCode).emit(SERVER_TO_CLIENT.TURN_STATE_CHANGED, { state: room.round.turnState });
    });

    socket.on(CLIENT_TO_SERVER.MAKE_GUESS, (payload: MakeGuessPayload) => {
      if (shouldRateLimit(socket)) {
        emitError(socket, ERROR_CODES.RATE_LIMITED, "Too many actions. Please wait a moment.");
        return;
      }

      const room = roomManager.findPlayerRoom(socket.id);
      if (!room || !room.round) {
        emitError(socket, ERROR_CODES.INVALID_STATE, "No active game room.");
        return;
      }

      const actor = room.players.find((player) => player.socketId === socket.id);
      if (!actor) {
        emitError(socket, ERROR_CODES.INVALID_STATE, "Player not found in room.");
        return;
      }
      if (isDuplicateEvent(socket, payload, actor.playerId)) {
        emitError(socket, ERROR_CODES.INVALID_STATE, "Duplicate request ignored.");
        return;
      }

      const validation = validator.validateMakeGuess(room, actor.playerId, payload?.guessedFlagCode);
      if (!validation.ok) {
        emitError(socket, validation.code ?? ERROR_CODES.INVALID_STATE, validation.message ?? "Invalid action.");
        return;
      }

      socket.emit(SERVER_TO_CLIENT.GUESS_LOCKED, {
        guessedFlagCode: payload.guessedFlagCode
      });
      const result = gameEngine.resolveGuess(room, actor.playerId, payload.guessedFlagCode);

      io.to(room.roomCode).emit(SERVER_TO_CLIENT.ROUND_OVER, {
        winnerPlayerId: result.winnerPlayerId,
        loserPlayerId: result.loserPlayerId,
        reason: result.reason,
        revealedSecrets: {
          [room.players[0].playerId]: room.players[0].secretFlagCode,
          [room.players[1].playerId]: room.players[1].secretFlagCode
        }
      });
      io.to(room.roomCode).emit(SERVER_TO_CLIENT.SCORE_UPDATED, {
        matchScore: room.championship.winsByPlayerId,
        roundsPlayed: room.championship.roundsPlayed
      });
      if (result.matchOver) {
        io.to(room.roomCode).emit(SERVER_TO_CLIENT.MATCH_OVER, {
          winnerPlayerId: room.championship.matchWinnerPlayerId,
          finalScore: room.championship.winsByPlayerId
        });
      } else {
        io.to(room.roomCode).emit(SERVER_TO_CLIENT.NEXT_ROUND_PENDING, {
          nextRoundStartsInMs: NEXT_ROUND_TRANSITION_MS,
          upcomingRoundNumber: room.championship.roundsPlayed + 1
        });
        setTimeout(() => {
          if (!room.players.every((roomPlayer) => roomPlayer.socketId && io.sockets.sockets.has(roomPlayer.socketId))) {
            return;
          }

          gameEngine.initializeRound(room);
          for (const roomPlayer of room.players) {
            const targetSocket = roomPlayer.socketId ? io.sockets.sockets.get(roomPlayer.socketId) : undefined;
            const view = gameEngine.getPlayerView(room, roomPlayer.playerId);
            if (targetSocket && view) {
              targetSocket.emit(SERVER_TO_CLIENT.GAME_STARTED, view);
            }
          }
          emitPrivateState(io, gameEngine, room);
        }, NEXT_ROUND_TRANSITION_MS);
      }
      if (result.matchOver) {
        emitPrivateState(io, gameEngine, room);
      }
    });

    socket.on(CLIENT_TO_SERVER.SET_FLAG_ELIMINATION, (payload: SetFlagEliminationPayload) => {
      if (shouldRateLimit(socket)) {
        emitError(socket, ERROR_CODES.RATE_LIMITED, "Too many actions. Please wait a moment.");
        return;
      }

      const room = roomManager.findPlayerRoom(socket.id);
      if (!room || !room.round) {
        emitError(socket, ERROR_CODES.INVALID_STATE, "No active game room.");
        return;
      }

      const actor = room.players.find((player) => player.socketId === socket.id);
      if (!actor) {
        emitError(socket, ERROR_CODES.INVALID_STATE, "Player not found in room.");
        return;
      }

      const validation = validator.validateSetFlagElimination(room, actor.playerId, payload?.flagCode, payload?.eliminated);
      if (!validation.ok) {
        emitError(socket, validation.code ?? ERROR_CODES.INVALID_STATE, validation.message ?? "Invalid action.");
        return;
      }

      const nextEliminatedCodes = payload.eliminated
        ? Array.from(new Set([...actor.eliminatedFlagCodes, payload.flagCode]))
        : actor.eliminatedFlagCodes.filter((flagCode) => flagCode !== payload.flagCode);

      actor.eliminatedFlagCodes = nextEliminatedCodes;
      socket.emit(SERVER_TO_CLIENT.BOARD_UPDATED, {
        eliminatedFlagCodes: actor.eliminatedFlagCodes
      });
      emitPrivateState(io, gameEngine, room);
    });

    socket.on(CLIENT_TO_SERVER.CHAT_MESSAGE, (payload: ChatMessagePayload) => {
      if (shouldRateLimit(socket)) {
        emitError(socket, ERROR_CODES.RATE_LIMITED, "Too many actions. Please wait a moment.");
        return;
      }

      const room = roomManager.findPlayerRoom(socket.id);
      if (!room) {
        emitError(socket, ERROR_CODES.INVALID_STATE, "No active game room.");
        return;
      }
      const actor = room.players.find((player) => player.socketId === socket.id);
      if (!actor) {
        emitError(socket, ERROR_CODES.INVALID_STATE, "Player not found in room.");
        return;
      }
      if (isDuplicateEvent(socket, payload, actor.playerId)) {
        emitError(socket, ERROR_CODES.INVALID_STATE, "Duplicate request ignored.");
        return;
      }

      const validation = validator.validateChatMessage(payload?.text);
      if (!validation.ok) {
        emitError(socket, validation.code ?? ERROR_CODES.INVALID_TEXT, validation.message ?? "Invalid chat text.");
        return;
      }

      emitRoomChatMessage(io, room, actor.playerId, payload.text.trim());
    });

    socket.on(CLIENT_TO_SERVER.NEW_GAME, () => {
      if (shouldRateLimit(socket)) {
        emitError(socket, ERROR_CODES.RATE_LIMITED, "Too many actions. Please wait a moment.");
        return;
      }

      const room = roomManager.findPlayerRoom(socket.id);
      if (!room) {
        emitError(socket, ERROR_CODES.INVALID_STATE, "No active game room.");
        return;
      }
      const validation = validator.validateNewGame(room);
      if (!validation.ok) {
        emitError(socket, validation.code ?? ERROR_CODES.INVALID_STATE, validation.message ?? "Invalid action.");
        return;
      }

      gameEngine.resetMatch(room);
      for (const roomPlayer of room.players) {
        const targetSocket = roomPlayer.socketId ? io.sockets.sockets.get(roomPlayer.socketId) : undefined;
        const view = gameEngine.getPlayerView(room, roomPlayer.playerId);
        if (targetSocket && view) {
          targetSocket.emit(SERVER_TO_CLIENT.NEW_GAME_STARTED, view);
        }
      }
      emitPrivateState(io, gameEngine, room);
    });

    socket.on("disconnect", () => {
      const room = roomManager.findPlayerRoom(socket.id);
      if (!room) {
        return;
      }
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player) {
        return;
      }

      player.socketId = null;
      totalDisconnects += 1;
      auditLog("player_disconnected", { roomCode: room.roomCode, playerId: player.playerId });
      socket.to(room.roomCode).emit(SERVER_TO_CLIENT.PLAYER_LEFT, { playerId: player.playerId });
      updateRoomCleanup(roomManager, room);
    });
  });

  return { app, io, httpServer };
export function startServer(
  port = Number(process.env.PORT ?? 3001),
  host = process.env.HOST ?? "0.0.0.0"
) {
  const { httpServer, io } = createRealtimeApp();
  return new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
    httpServer.listen(port, host, () => {
      const address = httpServer.address();
      const runningPort = typeof address === "object" && address ? address.port : port;
      console.log(`Backend listening on http://${host}:${runningPort}`);
      resolve({
        port: runningPort,
        close: async () => {
          await io.close();
          await new Promise<void>((done, reject) => {
            httpServer.close((err) => (err ? reject(err) : done()));
          });
        }
      });
    });
  });
}

if (process.env.NODE_ENV !== "test") {
  void (async () => {
    const runningServer = await startServer();
    let isShuttingDown = false;

    const shutdown = (signal: NodeJS.Signals) => {
      if (isShuttingDown) {
        return;
      }

      isShuttingDown = true;
      console.log(`Received ${signal}. Closing server gracefully...`);
      void runningServer
        .close()
        .then(() => {
          console.log("Server closed successfully.");
          process.exit(0);
        })
        .catch((error) => {
          console.error("Server shutdown failed.", error);
          process.exit(1);
        });
    };

    process.once("SIGTERM", () => {
      shutdown("SIGTERM");
    });

    process.once("SIGINT", () => {
      shutdown("SIGINT");
    });
  })();
}
