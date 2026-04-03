import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLIENT_TO_SERVER,
  SERVER_TO_CLIENT,
  type ActionErrorPayload,
  type GameStartedPayload,
  type JoinRoomPayload,
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

function waitForTurnState(socket: ClientSocket, expectedState: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const listener = (payload: { state: string }) => {
      if (payload.state === expectedState) {
        socket.off(SERVER_TO_CLIENT.TURN_STATE_CHANGED, listener);
        resolve();
      }
    };
    socket.on(SERVER_TO_CLIENT.TURN_STATE_CHANGED, listener);
  });
}

describe("Week 2 socket handlers", () => {
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

  it("rejects eliminate in invalid state and broadcasts chat", async () => {
    running = await startServer(0);
    const url = `http://localhost:${running.port}`;

    const p1 = createClient(url, { transports: ["websocket"] });
    const p2 = createClient(url, { transports: ["websocket"] });
    sockets.push(p1, p2);

    await Promise.all([waitForEvent(p1, "connect"), waitForEvent(p2, "connect")]);

    const roomCreatedPromise = waitForEvent<RoomCreatedPayload>(p1, SERVER_TO_CLIENT.ROOM_CREATED);
    p1.emit(CLIENT_TO_SERVER.CREATE_ROOM, { displayName: "P1" });
    const roomCreated = await roomCreatedPromise;

    const p1GameStartedPromise = waitForEvent<GameStartedPayload>(p1, SERVER_TO_CLIENT.GAME_STARTED);
    const p2GameStartedPromise = waitForEvent<GameStartedPayload>(p2, SERVER_TO_CLIENT.GAME_STARTED);
    p2.emit(CLIENT_TO_SERVER.JOIN_ROOM, { roomCode: roomCreated.roomCode, displayName: "P2" } satisfies JoinRoomPayload);
    await Promise.all([p1GameStartedPromise, p2GameStartedPromise]);

    const invalidEliminate = waitForEvent<ActionErrorPayload>(p1, SERVER_TO_CLIENT.ACTION_ERROR);
    p1.emit(CLIENT_TO_SERVER.ELIMINATE_FLAG, { flagCode: "us" });
    expect((await invalidEliminate).code).toBe("INVALID_STATE");

    const p1Chat = waitForEvent<{ text: string }>(p1, SERVER_TO_CLIENT.CHAT_MESSAGE);
    const p2Chat = waitForEvent<{ text: string }>(p2, SERVER_TO_CLIENT.CHAT_MESSAGE);
    p1.emit(CLIENT_TO_SERVER.CHAT_MESSAGE, { text: "hello" });

    expect((await p1Chat).text).toBe("hello");
    expect((await p2Chat).text).toBe("hello");
  });

  it("allows eliminate during asker-actions and updates actor board only", async () => {
    running = await startServer(0);
    const url = `http://localhost:${running.port}`;

    const p1 = createClient(url, { transports: ["websocket"] });
    const p2 = createClient(url, { transports: ["websocket"] });
    sockets.push(p1, p2);

    await Promise.all([waitForEvent(p1, "connect"), waitForEvent(p2, "connect")]);

    const roomCreatedPromise = waitForEvent<RoomCreatedPayload>(p1, SERVER_TO_CLIENT.ROOM_CREATED);
    p1.emit(CLIENT_TO_SERVER.CREATE_ROOM, { displayName: "P1" });
    const roomCreated = await roomCreatedPromise;

    const p1Start = waitForEvent<GameStartedPayload>(p1, SERVER_TO_CLIENT.GAME_STARTED);
    const p2Start = waitForEvent<GameStartedPayload>(p2, SERVER_TO_CLIENT.GAME_STARTED);
    p2.emit(CLIENT_TO_SERVER.JOIN_ROOM, { roomCode: roomCreated.roomCode, displayName: "P2" } satisfies JoinRoomPayload);
    const [p1Started] = await Promise.all([p1Start, p2Start]);
    const eliminatableFlag = p1Started.availableFlagCodes.find((flagCode) => flagCode !== p1Started.yourSecretFlag)
      ?? p1Started.availableFlagCodes[0];

    const incomingQuestion = waitForEvent(p2, SERVER_TO_CLIENT.INCOMING_QUESTION);
    p1.emit(CLIENT_TO_SERVER.ASK_QUESTION, { question: "Is it in Europe?" });
    await incomingQuestion;

    const askerActionsState = waitForTurnState(p1, "awaiting-asker-actions");
    p2.emit(CLIENT_TO_SERVER.ANSWER_QUESTION, { answer: "yes" });
    await askerActionsState;

    const boardUpdated = waitForEvent<{ eliminatedFlagCodes: string[] }>(p1, SERVER_TO_CLIENT.BOARD_UPDATED);
    let p2BoardUpdated = false;
    p2.once(SERVER_TO_CLIENT.BOARD_UPDATED, () => {
      p2BoardUpdated = true;
    });

    p1.emit(CLIENT_TO_SERVER.ELIMINATE_FLAG, { flagCode: eliminatableFlag });
    const update = await boardUpdated;

    expect(update.eliminatedFlagCodes).toContain(eliminatableFlag);
    expect(p2BoardUpdated).toBe(false);
  });

  it("allows new-game only after match-over", async () => {
    running = await startServer(0);
    const url = `http://localhost:${running.port}`;

    const p1 = createClient(url, { transports: ["websocket"] });
    const p2 = createClient(url, { transports: ["websocket"] });
    sockets.push(p1, p2);

    await Promise.all([waitForEvent(p1, "connect"), waitForEvent(p2, "connect")]);

    const roomCreatedPromise = waitForEvent<RoomCreatedPayload>(p1, SERVER_TO_CLIENT.ROOM_CREATED);
    p1.emit(CLIENT_TO_SERVER.CREATE_ROOM, { displayName: "P1" });
    const roomCreated = await roomCreatedPromise;

    let p1Start = waitForEvent<GameStartedPayload>(p1, SERVER_TO_CLIENT.GAME_STARTED);
    let p2Start = waitForEvent<GameStartedPayload>(p2, SERVER_TO_CLIENT.GAME_STARTED);
    p2.emit(CLIENT_TO_SERVER.JOIN_ROOM, { roomCode: roomCreated.roomCode, displayName: "P2" } satisfies JoinRoomPayload);
    let currentP1Start = await p1Start;
    await p2Start;

    const earlyNewGameError = waitForEvent<ActionErrorPayload>(p1, SERVER_TO_CLIENT.ACTION_ERROR);
    p1.emit(CLIENT_TO_SERVER.NEW_GAME, {});
    expect((await earlyNewGameError).code).toBe("INVALID_STATE");

    const matchOverEvent = waitForEvent<{ winnerPlayerId: string }>(p1, SERVER_TO_CLIENT.MATCH_OVER);

    for (let round = 0; round < 3; round += 1) {
      const roundOverP1 = waitForEvent<{ reason: string }>(p1, SERVER_TO_CLIENT.ROUND_OVER);
      const roundOverP2 = waitForEvent<{ reason: string }>(p2, SERVER_TO_CLIENT.ROUND_OVER);
      const nextP1Start = round < 2 ? waitForEvent<GameStartedPayload>(p1, SERVER_TO_CLIENT.GAME_STARTED) : undefined;
      const nextP2Start = round < 2 ? waitForEvent<GameStartedPayload>(p2, SERVER_TO_CLIENT.GAME_STARTED) : undefined;

      p1.emit(CLIENT_TO_SERVER.MAKE_GUESS, { guessedFlagCode: currentP1Start.yourSecretFlag });

      expect((await roundOverP1).reason).toBe("wrong-guess");
      expect((await roundOverP2).reason).toBe("wrong-guess");

      if (nextP1Start && nextP2Start) {
        currentP1Start = await nextP1Start;
        await nextP2Start;
      }
    }

    const matchOver = await matchOverEvent;
    expect(matchOver.winnerPlayerId).toBeTruthy();

    const newGameStartedP1 = waitForEvent<GameStartedPayload>(p1, SERVER_TO_CLIENT.NEW_GAME_STARTED);
    const newGameStartedP2 = waitForEvent<GameStartedPayload>(p2, SERVER_TO_CLIENT.NEW_GAME_STARTED);
    p1.emit(CLIENT_TO_SERVER.NEW_GAME, {});

    expect((await newGameStartedP1).roundNumber).toBe(1);
    expect((await newGameStartedP2).roundNumber).toBe(1);
  });
});