import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLIENT_TO_SERVER,
  SERVER_TO_CLIENT,
  type GameStartedPayload,
  type RoomCreatedPayload,
  type JoinRoomPayload
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

describe("Socket integration round transition", () => {
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

  it("auto-starts next round in under 2 seconds when match is not over", async () => {
    running = await startServer(0);
    const url = `http://localhost:${running.port}`;

    const p1 = createClient(url, { transports: ["websocket"] });
    const p2 = createClient(url, { transports: ["websocket"] });
    sockets.push(p1, p2);

    await Promise.all([waitForEvent(p1, "connect"), waitForEvent(p2, "connect")]);

    const roomCreatedPromise = waitForEvent<RoomCreatedPayload>(p1, SERVER_TO_CLIENT.ROOM_CREATED);
    p1.emit(CLIENT_TO_SERVER.CREATE_ROOM, { displayName: "P1" });
    const roomCreated = await roomCreatedPromise;

    const p1StartPromise = waitForEvent<GameStartedPayload>(p1, SERVER_TO_CLIENT.GAME_STARTED);
    const p2StartPromise = waitForEvent<GameStartedPayload>(p2, SERVER_TO_CLIENT.GAME_STARTED);
    const roomJoinedPromise = waitForEvent<RoomCreatedPayload>(p2, SERVER_TO_CLIENT.ROOM_JOINED);
    p2.emit(CLIENT_TO_SERVER.JOIN_ROOM, { roomCode: roomCreated.roomCode, displayName: "P2" } satisfies JoinRoomPayload);
    const roomJoined = await roomJoinedPromise;
    const [p1Start, p2Start] = await Promise.all([p1StartPromise, p2StartPromise]);

    const activePlayerId = p1Start.activePlayerId;
    const activeSocket = activePlayerId === roomCreated.playerId ? p1 : p2;
    const activeSecret = activePlayerId === roomCreated.playerId ? p1Start.yourSecretFlag : p2Start.yourSecretFlag;

    const guessLockedPromise = waitForEvent<{ guessedFlagCode: string }>(activeSocket, SERVER_TO_CLIENT.GUESS_LOCKED);
    const roundOverPromise = waitForEvent<{ winnerPlayerId: string; reason: string }>(p1, SERVER_TO_CLIENT.ROUND_OVER);
    const nextRoundPendingPromise = waitForEvent<{ nextRoundStartsInMs: number; upcomingRoundNumber: number }>(p1, SERVER_TO_CLIENT.NEXT_ROUND_PENDING);
    const p1NextRoundPromise = waitForEvent<GameStartedPayload>(p1, SERVER_TO_CLIENT.GAME_STARTED);
    const p2NextRoundPromise = waitForEvent<GameStartedPayload>(p2, SERVER_TO_CLIENT.GAME_STARTED);

    const transitionStart = Date.now();
    activeSocket.emit(CLIENT_TO_SERVER.MAKE_GUESS, { guessedFlagCode: activeSecret });
    const guessLocked = await guessLockedPromise;
    const roundOver = await roundOverPromise;
    const nextRoundPending = await nextRoundPendingPromise;
    expect(guessLocked.guessedFlagCode).toBe(activeSecret);
    expect(roundOver.reason).toBe("wrong-guess");
    expect(nextRoundPending.nextRoundStartsInMs).toBeGreaterThan(0);
    expect(nextRoundPending.upcomingRoundNumber).toBe(p1Start.roundNumber + 1);

    const [p1NextRound, p2NextRound] = await Promise.all([p1NextRoundPromise, p2NextRoundPromise]);
    const transitionDurationMs = Date.now() - transitionStart;

    expect(transitionDurationMs).toBeLessThan(2000);
    expect(p1NextRound.roundNumber).toBe(p1Start.roundNumber + 1);
    expect(p2NextRound.roundNumber).toBe(p2Start.roundNumber + 1);

    const expectedWinner = activePlayerId === roomCreated.playerId ? roomJoined.playerId : roomCreated.playerId;
    expect(roundOver.winnerPlayerId).toBe(expectedWinner);
  });
});
