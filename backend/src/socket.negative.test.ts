import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLIENT_TO_SERVER,
  SERVER_TO_CLIENT,
  type ActionErrorPayload,
  type GameStartedPayload,
  type RoomCreatedPayload
} from "@flagwho/shared";
import { startServer } from "./server.js";

interface RunningServer {
  port: number;
  close: () => Promise<void>;
}

function waitForEvent<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise<T>((resolve) => {
    socket.once(event, (payload: T) => resolve(payload));
  });
}

describe("Socket negative cases", () => {
  let running: RunningServer | null = null;
  const sockets: ClientSocket[] = [];

  afterEach(async () => {
    for (const socket of sockets) {
      socket.disconnect();
    }
    sockets.length = 0;
    if (running) {
      await running.close().catch(() => undefined);
      running = null;
    }
  });

  it("rejects out-of-turn question and malformed question payload", async () => {
    running = await startServer(0);
    const url = `http://localhost:${running.port}`;

    const p1 = createClient(url, { transports: ["websocket"] });
    const p2 = createClient(url, { transports: ["websocket"] });
    sockets.push(p1, p2);

    await Promise.all([waitForEvent(p1, "connect"), waitForEvent(p2, "connect")]);

    const roomCreated = waitForEvent<RoomCreatedPayload>(p1, SERVER_TO_CLIENT.ROOM_CREATED);
    p1.emit(CLIENT_TO_SERVER.CREATE_ROOM, { displayName: "P1" });
    const created = await roomCreated;

    const p1GameStarted = waitForEvent(p1, SERVER_TO_CLIENT.GAME_STARTED);
    const p2GameStarted = waitForEvent(p2, SERVER_TO_CLIENT.GAME_STARTED);
    p2.emit(CLIENT_TO_SERVER.JOIN_ROOM, { roomCode: created.roomCode, displayName: "P2" });
    await Promise.all([p1GameStarted, p2GameStarted]);

    const outOfTurn = waitForEvent<ActionErrorPayload>(p2, SERVER_TO_CLIENT.ACTION_ERROR);
    p2.emit(CLIENT_TO_SERVER.ASK_QUESTION, { question: "Is it red?" });
    expect((await outOfTurn).code).toBe("NOT_YOUR_TURN");

    const malformed = waitForEvent<ActionErrorPayload>(p1, SERVER_TO_CLIENT.ACTION_ERROR);
    p1.emit(CLIENT_TO_SERVER.ASK_QUESTION, { question: "Not valid" });
    expect((await malformed).code).toBe("INVALID_QUESTION_FORMAT");
  });

  it("rejects invalid actor/state actions for answer, guess, and chat", async () => {
    running = await startServer(0);
    const url = `http://localhost:${running.port}`;

    const p1 = createClient(url, { transports: ["websocket"] });
    const p2 = createClient(url, { transports: ["websocket"] });
    sockets.push(p1, p2);

    await Promise.all([waitForEvent(p1, "connect"), waitForEvent(p2, "connect")]);

    const roomCreated = waitForEvent<RoomCreatedPayload>(p1, SERVER_TO_CLIENT.ROOM_CREATED);
    p1.emit(CLIENT_TO_SERVER.CREATE_ROOM, { displayName: "P1" });
    const created = await roomCreated;

    const p1Start = waitForEvent<GameStartedPayload>(p1, SERVER_TO_CLIENT.GAME_STARTED);
    const p2Start = waitForEvent<GameStartedPayload>(p2, SERVER_TO_CLIENT.GAME_STARTED);
    p2.emit(CLIENT_TO_SERVER.JOIN_ROOM, { roomCode: created.roomCode, displayName: "P2" });
    const [p1Game, p2Game] = await Promise.all([p1Start, p2Start]);

    const isP1Active = p1Game.activePlayerId === created.playerId;
    const active = isP1Active ? p1 : p2;
    const nonActive = isP1Active ? p2 : p1;
    const activeSecret = isP1Active ? p1Game.yourSecretFlag : p2Game.yourSecretFlag;

    const incomingQuestion = waitForEvent(nonActive, SERVER_TO_CLIENT.INCOMING_QUESTION);
    active.emit(CLIENT_TO_SERVER.ASK_QUESTION, { question: "Is it in Europe?" });
    await incomingQuestion;

    const invalidAnswerActor = waitForEvent<ActionErrorPayload>(active, SERVER_TO_CLIENT.ACTION_ERROR);
    active.emit(CLIENT_TO_SERVER.ANSWER_QUESTION, { answer: "yes" });
    expect((await invalidAnswerActor).code).toBe("NOT_ALLOWED_ACTOR");

    const outOfTurnGuess = waitForEvent<ActionErrorPayload>(nonActive, SERVER_TO_CLIENT.ACTION_ERROR);
    nonActive.emit(CLIENT_TO_SERVER.MAKE_GUESS, { guessedFlagCode: activeSecret });
    expect((await outOfTurnGuess).code).toBe("INVALID_STATE");

    const invalidChat = waitForEvent<ActionErrorPayload>(active, SERVER_TO_CLIENT.ACTION_ERROR);
    active.emit(CLIENT_TO_SERVER.CHAT_MESSAGE, { text: "   " });
    expect((await invalidChat).code).toBe("INVALID_TEXT");
  });
});
