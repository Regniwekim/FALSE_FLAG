import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "@flagwho/shared";
import { EventValidator } from "./event-validator.js";
import type { RoomState } from "./types.js";

function roomWithState(turnState: RoomState["round"] extends infer _ ? "awaiting-question" | "awaiting-answer" | "awaiting-asker-actions" | "round-over" : never): RoomState {
  return {
    roomCode: "RM0001",
    status: "in-game",
    players: [
      {
        playerId: "p1",
        socketId: "s1",
        seat: "p1",
        displayName: "One",
        secretFlagCode: "us",
        eliminatedFlagCodes: []
      },
      {
        playerId: "p2",
        socketId: "s2",
        seat: "p2",
        displayName: "Two",
        secretFlagCode: "ca",
        eliminatedFlagCodes: []
      }
    ],
    championship: {
      targetWins: 3,
      winsByPlayerId: { p1: 0, p2: 0 },
      roundsPlayed: 0,
      matchWinnerPlayerId: null
    },
    round: {
      roundNumber: 1,
      activePlayerId: "p1",
      turnState,
      pendingQuestion: turnState === "awaiting-answer" ? { askedByPlayerId: "p1", text: "Test?" } : null,
      winnerPlayerId: null,
      loserPlayerId: null,
      roundOverReason: null
    },
    chatLog: []
  };
}

describe("EventValidator rule validation", () => {
  it("rejects malformed question payload", () => {
    const validator = new EventValidator();
    const result = validator.validateAskQuestion(roomWithState("awaiting-question"), "p1", "Not a question");
    expect(result.ok).toBe(false);
    expect(result.code).toBe(ERROR_CODES.INVALID_QUESTION_FORMAT);
  });

  it("rejects out-of-turn question", () => {
    const validator = new EventValidator();
    const result = validator.validateAskQuestion(roomWithState("awaiting-question"), "p2", "Is it red?");
    expect(result.ok).toBe(false);
    expect(result.code).toBe(ERROR_CODES.NOT_YOUR_TURN);
  });

  it("rejects invalid answer payload", () => {
    const validator = new EventValidator();
    const result = validator.validateAnswerQuestion(roomWithState("awaiting-answer"), "p2", "maybe");
    expect(result.ok).toBe(false);
    expect(result.code).toBe(ERROR_CODES.INVALID_ANSWER);
  });

  it("rejects end-turn when not in asker-actions state", () => {
    const validator = new EventValidator();
    const result = validator.validateEndTurn(roomWithState("awaiting-question"), "p1");
    expect(result.ok).toBe(false);
    expect(result.code).toBe(ERROR_CODES.INVALID_STATE);
  });

  it("rejects make-guess for invalid flag code", () => {
    const validator = new EventValidator();
    const result = validator.validateMakeGuess(roomWithState("awaiting-question"), "p1", "zz");
    expect(result.ok).toBe(false);
    expect(result.code).toBe(ERROR_CODES.INVALID_FLAG);
  });

  it("rejects make-guess out of turn", () => {
    const validator = new EventValidator();
    const result = validator.validateMakeGuess(roomWithState("awaiting-question"), "p2", "us");
    expect(result.ok).toBe(false);
    expect(result.code).toBe(ERROR_CODES.NOT_YOUR_TURN);
  });

  it("rejects eliminate-flag outside asker-actions", () => {
    const validator = new EventValidator();
    const result = validator.validateEliminateFlag(roomWithState("awaiting-question"), "p1", "us");
    expect(result.ok).toBe(false);
    expect(result.code).toBe(ERROR_CODES.INVALID_STATE);
  });

  it("rejects duplicate eliminated flag", () => {
    const validator = new EventValidator();
    const room = roomWithState("awaiting-asker-actions");
    room.players[0].eliminatedFlagCodes.push("us");
    const result = validator.validateEliminateFlag(room, "p1", "us");
    expect(result.ok).toBe(false);
    expect(result.code).toBe(ERROR_CODES.ALREADY_ELIMINATED);
  });

  it("rejects empty chat message", () => {
    const validator = new EventValidator();
    const result = validator.validateChatMessage("   ");
    expect(result.ok).toBe(false);
    expect(result.code).toBe(ERROR_CODES.INVALID_TEXT);
  });

  it("rejects new-game when match is not over", () => {
    const validator = new EventValidator();
    const room = roomWithState("awaiting-question");
    const result = validator.validateNewGame(room);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(ERROR_CODES.INVALID_STATE);
  });
});
