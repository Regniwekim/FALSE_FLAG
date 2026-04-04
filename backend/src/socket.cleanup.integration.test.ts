import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CLIENT_TO_SERVER,
  SERVER_TO_CLIENT,
  type JoinRoomPayload,
  type RoomCreatedPayload,
  type ActionErrorPayload
} from "@flagwho/shared";

let startServer: (port?: number) => Promise<{ port: number; close: () => Promise<void> }>;

async function loadServer() {
  if (!startServer) {
    ({ startServer } = await import("./server.js"));
  }
  return startServer;
}

interface RunningServer {
  port: number;
  close: () => Promise<void>;
}

function waitForEvent<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise<T>((resolve) => {
    socket.once(event, (payload: T) => resolve(payload));
  });
}

describe("Socket cleanup after disconnect", () => {
  let running: RunningServer | null = null;
  const sockets: ClientSocket[] = [];

  beforeEach(() => {
    process.env.ROOM_CLEANUP_GRACE_MS = "200";
  });

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

  it("closes a room after all players disconnect and prevents rejoin", async () => {
    const serverFactory = await loadServer();
    running = await serverFactory(0);
    const url = `http://localhost:${running.port}`;

    const p1 = createClient(url, { transports: ["websocket"] });
    const p2 = createClient(url, { transports: ["websocket"] });
    sockets.push(p1, p2);

    await Promise.all([waitForEvent<void>(p1, "connect"), waitForEvent<void>(p2, "connect")]);

    const roomCreatedPromise = waitForEvent<RoomCreatedPayload>(p1, SERVER_TO_CLIENT.ROOM_CREATED);
    p1.emit(CLIENT_TO_SERVER.CREATE_ROOM, { displayName: "P1" });
    const roomCreated = await roomCreatedPromise;

    const roomJoinedPromise = waitForEvent<RoomCreatedPayload>(p2, SERVER_TO_CLIENT.ROOM_JOINED);
    p2.emit(CLIENT_TO_SERVER.JOIN_ROOM, { roomCode: roomCreated.roomCode, displayName: "P2" } satisfies JoinRoomPayload);
    await roomJoinedPromise;

    p1.disconnect();
    p2.disconnect();

    await new Promise((resolve) => setTimeout(resolve, 300));

    const p3 = createClient(url, { transports: ["websocket"] });
    sockets.push(p3);
    await waitForEvent<void>(p3, "connect");

    const errorPromise = waitForEvent<ActionErrorPayload>(p3, SERVER_TO_CLIENT.ACTION_ERROR);
    p3.emit(CLIENT_TO_SERVER.JOIN_ROOM, { roomCode: roomCreated.roomCode, displayName: "P3" } satisfies JoinRoomPayload);

    const error = await errorPromise;
    expect(error.code).toBe("ROOM_NOT_FOUND");
  });
});
