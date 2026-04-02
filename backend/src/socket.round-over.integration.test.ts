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

describe("Socket integration round resolution", () => {
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

  it("ends round immediately with loss on wrong guess", async () => {
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
    const roomJoinedPromise = waitForEvent<RoomCreatedPayload>(p2, SERVER_TO_CLIENT.ROOM_JOINED);
    p2.emit(CLIENT_TO_SERVER.JOIN_ROOM, { roomCode: roomCreated.roomCode, displayName: "P2" } satisfies JoinRoomPayload);
    const roomJoined = await roomJoinedPromise;
    const [p1GameStarted, p2GameStarted] = await Promise.all([p1GameStartedPromise, p2GameStartedPromise]);

    const activePlayerId = p1GameStarted.activePlayerId;
    const activeSocket = activePlayerId === roomCreated.playerId ? p1 : p2;
    const activeSecret = activePlayerId === roomCreated.playerId ? p1GameStarted.yourSecretFlag : p2GameStarted.yourSecretFlag;

    const roundOverPromiseP1 = waitForEvent<{ winnerPlayerId: string; loserPlayerId: string; reason: string }>(
      p1,
      SERVER_TO_CLIENT.ROUND_OVER
    );
    const roundOverPromiseP2 = waitForEvent<{ winnerPlayerId: string; loserPlayerId: string; reason: string }>(
      p2,
      SERVER_TO_CLIENT.ROUND_OVER
    );

    // Guessing own secret is guaranteed wrong because player secrets are unique.
    activeSocket.emit(CLIENT_TO_SERVER.MAKE_GUESS, { guessedFlagCode: activeSecret });

    const [roundOverP1, roundOverP2] = await Promise.all([roundOverPromiseP1, roundOverPromiseP2]);

    expect(roundOverP1.reason).toBe("wrong-guess");
    expect(roundOverP2.reason).toBe("wrong-guess");
    expect(roundOverP1.loserPlayerId).toBe(activePlayerId);

    const expectedWinner = activePlayerId === roomCreated.playerId ? roomJoined.playerId : roomCreated.playerId;
    expect(roundOverP1.winnerPlayerId).toBe(expectedWinner);
  });
});
