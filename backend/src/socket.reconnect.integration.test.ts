import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLIENT_TO_SERVER,
  SERVER_TO_CLIENT,
  type JoinRoomPayload,
  type ReconnectSuccessPayload,
  type RoomCreatedPayload,
  type GameStartedPayload,
  type SyncStatePayload
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

describe("Socket reconnect support", () => {
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

  it("allows a disconnected player to rejoin and restores their private state", async () => {
    running = await startServer(0);
    const url = `http://localhost:${running.port}`;

    const p1 = createClient(url, { transports: ["websocket"] });
    const p2 = createClient(url, { transports: ["websocket"] });
    sockets.push(p1, p2);

    await Promise.all([waitForEvent<void>(p1, "connect"), waitForEvent<void>(p2, "connect")]);

    const roomCreatedPromise = waitForEvent<RoomCreatedPayload>(p1, SERVER_TO_CLIENT.ROOM_CREATED);
    p1.emit(CLIENT_TO_SERVER.CREATE_ROOM, { displayName: "P1" });
    const roomCreated = await roomCreatedPromise;

    const p1GameStartedPromise = waitForEvent<GameStartedPayload>(p1, SERVER_TO_CLIENT.GAME_STARTED);
    const p2GameStartedPromise = waitForEvent<GameStartedPayload>(p2, SERVER_TO_CLIENT.GAME_STARTED);
    const roomJoinedPromise = waitForEvent<RoomCreatedPayload>(p2, SERVER_TO_CLIENT.ROOM_JOINED);
    p2.emit(CLIENT_TO_SERVER.JOIN_ROOM, { roomCode: roomCreated.roomCode, displayName: "P2" } satisfies JoinRoomPayload);
    await roomJoinedPromise;
    const [p1GameStarted, p2GameStarted] = await Promise.all([p1GameStartedPromise, p2GameStartedPromise]);

    expect(p1GameStarted.yourSecretFlag).toBeTruthy();
    expect(p2GameStarted.yourSecretFlag).toBeTruthy();

    const playerLeftPromise = waitForEvent<{ playerId: string }>(p2, SERVER_TO_CLIENT.PLAYER_LEFT);
    p1.disconnect();

    await playerLeftPromise;

    const p1Reconnect = createClient(url, { transports: ["websocket"] });
    sockets.push(p1Reconnect);
    await waitForEvent<void>(p1Reconnect, "connect");

    const reconnectSuccessPromise = waitForEvent<ReconnectSuccessPayload>(p1Reconnect, SERVER_TO_CLIENT.RECONNECT_SUCCESS);
    const reconnectedStatePromise = waitForEvent<SyncStatePayload>(p1Reconnect, SERVER_TO_CLIENT.SYNC_STATE);
    const playerJoinedPromise = waitForEvent<{ playerId: string; seat: string }>(p2, SERVER_TO_CLIENT.PLAYER_JOINED);
    p1Reconnect.emit(CLIENT_TO_SERVER.RECONNECT_ROOM, {
      roomCode: roomCreated.roomCode,
      playerId: roomCreated.playerId
    });

    const reconnectSuccess = await reconnectSuccessPromise;
    const reconnectedState = await Promise.race<SyncStatePayload | null>([
      reconnectedStatePromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 2000))
    ]);
    const playerJoined = await Promise.race< { playerId: string; seat: string } | null >([
      playerJoinedPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 2000))
    ]);

    expect(reconnectSuccess.roomCode).toBe(roomCreated.roomCode);
    expect(reconnectSuccess.playerId).toBe(roomCreated.playerId);
    expect(reconnectSuccess.roomStatus).toBe("in-game");
    expect(reconnectedState?.yourSecretFlag).toBeTruthy();
    if (playerJoined) {
      expect(playerJoined.playerId).toBe(roomCreated.playerId);
    }
  });
});
