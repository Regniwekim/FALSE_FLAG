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

describe("Socket integration full turn loop", () => {
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

  it("plays ask -> answer -> end-turn flow and switches active player", async () => {
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
    await roomJoinedPromise;
    const [p1GameStarted, p2GameStarted] = await Promise.all([p1GameStartedPromise, p2GameStartedPromise]);

    const activePlayerAtStart = p1GameStarted.activePlayerId;
    const isP1Active = activePlayerAtStart === roomCreated.playerId;
    const asker = isP1Active ? p1 : p2;
    const responder = isP1Active ? p2 : p1;

    const incomingQuestionPromise = waitForEvent<{ question: string }>(responder, SERVER_TO_CLIENT.INCOMING_QUESTION);
    const awaitingAnswerStatePromise = waitForEvent<{ state: string }>(p1, SERVER_TO_CLIENT.TURN_STATE_CHANGED);
    asker.emit(CLIENT_TO_SERVER.ASK_QUESTION, { question: "Is your flag in Europe?" });

    const incoming = await incomingQuestionPromise;
    expect(incoming.question).toBe("Is your flag in Europe?");
    expect((await awaitingAnswerStatePromise).state).toBe("awaiting-answer");

    const answeredPromise = waitForEvent<{ answer: "yes" | "no" }>(asker, SERVER_TO_CLIENT.QUESTION_ANSWERED);
    const askerActionStatePromise = waitForEvent<{ state: string }>(p2, SERVER_TO_CLIENT.TURN_STATE_CHANGED);
    responder.emit(CLIENT_TO_SERVER.ANSWER_QUESTION, { answer: "yes" });

    expect((await answeredPromise).answer).toBe("yes");
    expect((await askerActionStatePromise).state).toBe("awaiting-asker-actions");

    const turnEndedPromise = waitForEvent<{ nextActivePlayerId: string }>(p1, SERVER_TO_CLIENT.TURN_ENDED);
    const nextStatePromise = waitForEvent<{ state: string }>(p2, SERVER_TO_CLIENT.TURN_STATE_CHANGED);
    asker.emit(CLIENT_TO_SERVER.END_TURN, {});

    const turnEnded = await turnEndedPromise;
    expect(turnEnded.nextActivePlayerId).not.toBe(activePlayerAtStart);
    expect((await nextStatePromise).state).toBe("awaiting-question");

    expect(p2GameStarted.yourSecretFlag).toBeTruthy();
  });
});
