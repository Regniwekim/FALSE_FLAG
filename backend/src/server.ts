import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";
import {
  CLIENT_TO_SERVER,
  ERROR_CODES,
  SERVER_TO_CLIENT,
  type CreateRoomPayload,
  type JoinRoomPayload,
  type AskQuestionPayload,
  type AnswerQuestionPayload,
  type MakeGuessPayload,
  type EliminateFlagPayload,
  type ChatMessagePayload
} from "@flagwho/shared";
import { RoomManager } from "./room-manager.js";
import { GameEngine } from "./game-engine.js";
import { EventValidator } from "./event-validator.js";
import type { RoomState } from "./types.js";

const NEXT_ROUND_TRANSITION_MS = 1200;

function getAllowedOrigins() {
  return (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

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

function emitError(socket: Socket, code: string, message: string) {
  socket.emit(SERVER_TO_CLIENT.ACTION_ERROR, { code, message });
}

function emitPrivateState(io: Server, gameEngine: GameEngine, room: RoomState) {
  for (const roomPlayer of room.players) {
    const targetSocket = io.sockets.sockets.get(roomPlayer.socketId);
    const view = gameEngine.getPlayerView(room, roomPlayer.playerId);
    if (targetSocket && view) {
      targetSocket.emit(SERVER_TO_CLIENT.SYNC_STATE, {
        turnState: room.round?.turnState,
        activePlayerId: room.round?.activePlayerId,
        yourBoardState: view.yourBoardState,
        roomStatus: room.status
      });
    }
  }
}

export function createRealtimeApp() {
  const app = express();
  const allowedOrigins = getAllowedOrigins();

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

  io.on("connection", (socket) => {
    socket.on(CLIENT_TO_SERVER.CREATE_ROOM, (payload: CreateRoomPayload = {}) => {
      const existingRoom = roomManager.findPlayerRoom(socket.id);
      if (existingRoom) {
        emitError(socket, ERROR_CODES.ALREADY_IN_ROOM, "You are already in a room.");
        return;
      }

      const { room, player } = roomManager.createRoom(socket.id, payload.displayName ?? "Player 1");
      socket.join(room.roomCode);
      socket.emit(SERVER_TO_CLIENT.ROOM_CREATED, {
        roomCode: room.roomCode,
        playerId: player.playerId,
        seat: player.seat
      });
    });

    socket.on(CLIENT_TO_SERVER.JOIN_ROOM, (payload: JoinRoomPayload) => {
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
        seat: player.seat
      });

      io.to(room.roomCode).emit(SERVER_TO_CLIENT.PLAYER_JOINED, {
        playerId: player.playerId,
        seat: player.seat
      });

      if (room.players.length === 2) {
        gameEngine.initializeRound(room);
        for (const roomPlayer of room.players) {
          const targetSocket = io.sockets.sockets.get(roomPlayer.socketId);
          const view = gameEngine.getPlayerView(room, roomPlayer.playerId);
          if (targetSocket && view) {
            targetSocket.emit(SERVER_TO_CLIENT.GAME_STARTED, view);
          }
        }
      }
    });

    socket.on(CLIENT_TO_SERVER.ASK_QUESTION, (payload: AskQuestionPayload) => {
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

      const validation = validator.validateAskQuestion(room, actor.playerId, payload?.question as string);
      if (!validation.ok) {
        emitError(socket, validation.code ?? ERROR_CODES.INVALID_STATE, validation.message ?? "Invalid action.");
        return;
      }

      const question = payload.question.trim();
      room.round.pendingQuestion = { askedByPlayerId: actor.playerId, text: question };
      room.round.turnState = "awaiting-answer";

      socket.to(room.roomCode).emit(SERVER_TO_CLIENT.INCOMING_QUESTION, {
        fromPlayerId: actor.playerId,
        question
      });
      io.to(room.roomCode).emit(SERVER_TO_CLIENT.TURN_STATE_CHANGED, { state: room.round.turnState });
    });

    socket.on(CLIENT_TO_SERVER.ANSWER_QUESTION, (payload: AnswerQuestionPayload) => {
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
      io.to(room.roomCode).emit(SERVER_TO_CLIENT.TURN_STATE_CHANGED, { state: room.round.turnState });
    });

    socket.on(CLIENT_TO_SERVER.END_TURN, () => {
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

      const validation = validator.validateMakeGuess(room, actor.playerId, payload?.guessedFlagCode);
      if (!validation.ok) {
        emitError(socket, validation.code ?? ERROR_CODES.INVALID_STATE, validation.message ?? "Invalid action.");
        return;
      }

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
        setTimeout(() => {
          if (!room.players.every((roomPlayer) => io.sockets.sockets.has(roomPlayer.socketId))) {
            return;
          }

          gameEngine.initializeRound(room);
          for (const roomPlayer of room.players) {
            const targetSocket = io.sockets.sockets.get(roomPlayer.socketId);
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

    socket.on(CLIENT_TO_SERVER.ELIMINATE_FLAG, (payload: EliminateFlagPayload) => {
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

      const validation = validator.validateEliminateFlag(room, actor.playerId, payload?.flagCode);
      if (!validation.ok) {
        emitError(socket, validation.code ?? ERROR_CODES.INVALID_STATE, validation.message ?? "Invalid action.");
        return;
      }

      actor.eliminatedFlagCodes.push(payload.flagCode);
      socket.emit(SERVER_TO_CLIENT.BOARD_UPDATED, {
        eliminatedFlagCodes: actor.eliminatedFlagCodes
      });
      emitPrivateState(io, gameEngine, room);
    });

    socket.on(CLIENT_TO_SERVER.CHAT_MESSAGE, (payload: ChatMessagePayload) => {
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

      const validation = validator.validateChatMessage(payload?.text);
      if (!validation.ok) {
        emitError(socket, validation.code ?? ERROR_CODES.INVALID_TEXT, validation.message ?? "Invalid chat text.");
        return;
      }

      const text = payload.text.trim();
      const message = {
        fromPlayerId: actor.playerId,
        text,
        createdAt: new Date().toISOString()
      };
      room.chatLog.push(message);
      io.to(room.roomCode).emit(SERVER_TO_CLIENT.CHAT_MESSAGE, message);
    });

    socket.on(CLIENT_TO_SERVER.NEW_GAME, () => {
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
        const targetSocket = io.sockets.sockets.get(roomPlayer.socketId);
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
      socket.to(room.roomCode).emit(SERVER_TO_CLIENT.PLAYER_LEFT, { playerId: player.playerId });
    });
  });

  return { app, io, httpServer };
}

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
