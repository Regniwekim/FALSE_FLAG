import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLIENT_TO_SERVER,
  SERVER_TO_CLIENT,
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

describe("Socket privacy rules", () => {
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

  it("does not leak opponent secret before round-over", async () => {
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
    p2.emit(CLIENT_TO_SERVER.JOIN_ROOM, { roomCode: roomCreated.roomCode, displayName: "P2" } satisfies JoinRoomPayload);

    const [p1Start, p2Start] = await Promise.all([p1StartPromise, p2StartPromise]);

    // Before round-over each player only receives own secret in game-started payload.
    expect(p1Start).toHaveProperty("yourSecretFlag");
    expect(p2Start).toHaveProperty("yourSecretFlag");
    expect(Object.prototype.hasOwnProperty.call(p1Start as unknown as object, "revealedSecrets")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(p2Start as unknown as object, "revealedSecrets")).toBe(false);

    const roundOverP1 = waitForEvent<{ revealedSecrets: Record<string, string> }>(p1, SERVER_TO_CLIENT.ROUND_OVER);
    const roundOverP2 = waitForEvent<{ revealedSecrets: Record<string, string> }>(p2, SERVER_TO_CLIENT.ROUND_OVER);

    // Use own secret as wrong guess to force round-over and verify reveal happens only then.
    p1.emit(CLIENT_TO_SERVER.MAKE_GUESS, { guessedFlagCode: p1Start.yourSecretFlag });

    expect(Object.keys((await roundOverP1).revealedSecrets).length).toBe(2);
    expect(Object.keys((await roundOverP2).revealedSecrets).length).toBe(2);
  });
});
