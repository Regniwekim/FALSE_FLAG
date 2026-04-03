import { describe, expect, it } from "vitest";
import { GameEngine } from "./game-engine.js";
import type { RoomState } from "./types.js";

function buildRoom(): RoomState {
  return {
    roomCode: "ABC123",
    difficulty: "easy",
    availableFlagCodes: ["us", "ca", "mx", "br", "fr", "de"],
    status: "waiting",
    players: [
      {
        playerId: "p1",
        socketId: "s1",
        seat: "p1",
        displayName: "One",
        secretFlagCode: null,
        eliminatedFlagCodes: []
      },
      {
        playerId: "p2",
        socketId: "s2",
        seat: "p2",
        displayName: "Two",
        secretFlagCode: null,
        eliminatedFlagCodes: []
      }
    ],
    championship: {
      targetWins: 3,
      winsByPlayerId: { p1: 0, p2: 0 },
      roundsPlayed: 0,
      matchWinnerPlayerId: null
    },
    round: null,
    chatLog: []
  };
}

describe("GameEngine state transitions", () => {
  it("initializes round with unique secrets and awaiting-question", () => {
    const engine = new GameEngine();
    const room = buildRoom();

    engine.initializeRound(room);

    expect(room.round).not.toBeNull();
    expect(room.round?.turnState).toBe("awaiting-question");
    expect(room.players[0].secretFlagCode).toBeTruthy();
    expect(room.players[1].secretFlagCode).toBeTruthy();
    expect(room.players[0].secretFlagCode).not.toBe(room.players[1].secretFlagCode);
  });

  it("moves from awaiting-answer to awaiting-asker-actions when resolved", () => {
    const engine = new GameEngine();
    const room = buildRoom();
    engine.initializeRound(room);

    if (!room.round) {
      throw new Error("Round missing");
    }

    room.round.pendingQuestion = { askedByPlayerId: "p1", text: "Is it in Europe?" };
    room.round.turnState = "awaiting-answer";

    engine.resolveAnswer(room, "yes");

    expect(room.round.turnState).toBe("awaiting-asker-actions");
    expect(room.round.pendingQuestion?.answer).toBe("yes");
  });

  it("switches active player and resets state on end turn", () => {
    const engine = new GameEngine();
    const room = buildRoom();
    engine.initializeRound(room);

    if (!room.round) {
      throw new Error("Round missing");
    }

    room.round.pendingQuestion = { askedByPlayerId: room.players[0].playerId, text: "Question?", answer: "no" };
    room.round.turnState = "awaiting-asker-actions";
    const previous = room.round.activePlayerId;

    engine.endTurn(room);

    expect(room.round.turnState).toBe("awaiting-question");
    expect(room.round.pendingQuestion).toBeNull();
    expect(room.round.activePlayerId).not.toBe(previous);
  });
});
