import { ERROR_CODES, type ErrorCode } from "@flagwho/shared";
import type { RoomState } from "./types.js";
import { isFlagCodeInList } from "./flag-catalog.js";

interface ValidationResult {
  ok: boolean;
  code?: ErrorCode;
  message?: string;
}

function fail(code: ErrorCode, message: string): ValidationResult {
  return { ok: false, code, message };
}

export class EventValidator {
  validateAskQuestion(room: RoomState, actorPlayerId: string, question: string): ValidationResult {
    if (!room.round || room.round.turnState !== "awaiting-question") {
      return fail(ERROR_CODES.INVALID_STATE, "Question cannot be asked in the current state.");
    }
    if (room.round.activePlayerId !== actorPlayerId) {
      return fail(ERROR_CODES.NOT_YOUR_TURN, "Only the active player can ask a question.");
    }
    if (typeof question !== "string") {
      return fail(ERROR_CODES.INVALID_QUESTION_FORMAT, "Question must be a string ending with a question mark.");
    }
    const trimmed = question.trim();
    if (!trimmed || !trimmed.endsWith("?")) {
      return fail(ERROR_CODES.INVALID_QUESTION_FORMAT, "Question must end with a question mark.");
    }
    if (trimmed.length > 200) {
      return fail(ERROR_CODES.INVALID_QUESTION_FORMAT, "Question is too long.");
    }
    if (/\r?\n/.test(trimmed)) {
      return fail(ERROR_CODES.INVALID_QUESTION_FORMAT, "Question must be a single line.");
    }
    return { ok: true };
  }

  validateAnswerQuestion(room: RoomState, actorPlayerId: string, answer: unknown): ValidationResult {
    if (!room.round || room.round.turnState !== "awaiting-answer") {
      return fail(ERROR_CODES.INVALID_STATE, "Answer cannot be submitted in the current state.");
    }
    if (room.round.activePlayerId === actorPlayerId) {
      return fail(ERROR_CODES.NOT_ALLOWED_ACTOR, "Active player cannot answer their own question.");
    }
    if (answer !== "yes" && answer !== "no") {
      return fail(ERROR_CODES.INVALID_ANSWER, "Answer must be 'yes' or 'no'.");
    }
    return { ok: true };
  }

  validateEndTurn(room: RoomState, actorPlayerId: string): ValidationResult {
    if (!room.round || room.round.turnState !== "awaiting-asker-actions") {
      return fail(ERROR_CODES.INVALID_STATE, "Turn cannot be ended in the current state.");
    }
    if (room.round.activePlayerId !== actorPlayerId) {
      return fail(ERROR_CODES.NOT_YOUR_TURN, "Only the active player can end their turn.");
    }
    return { ok: true };
  }

  validateMakeGuess(room: RoomState, actorPlayerId: string, guessedFlagCode: unknown): ValidationResult {
    if (!room.round || (room.round.turnState !== "awaiting-question" && room.round.turnState !== "awaiting-asker-actions")) {
      return fail(ERROR_CODES.INVALID_STATE, "Guess is not allowed in the current state.");
    }
    if (room.round.activePlayerId !== actorPlayerId) {
      return fail(ERROR_CODES.NOT_YOUR_TURN, "Only the active player can make a guess.");
    }
    if (!isFlagCodeInList(guessedFlagCode, room.availableFlagCodes)) {
      return fail(ERROR_CODES.INVALID_FLAG, "Guessed flag code is invalid.");
    }
    return { ok: true };
  }

  validateSetFlagElimination(room: RoomState, actorPlayerId: string, flagCode: unknown, eliminated: unknown): ValidationResult {
    if (room.status !== "in-game" || !room.round || room.round.turnState === "round-over") {
      return fail(ERROR_CODES.INVALID_STATE, "Board editing is not allowed in the current state.");
    }
    if (!isFlagCodeInList(flagCode, room.availableFlagCodes)) {
      return fail(ERROR_CODES.INVALID_FLAG, "Flag code is invalid.");
    }
    if (typeof eliminated !== "boolean") {
      return fail(ERROR_CODES.INVALID_STATE, "Elimination state must be a boolean.");
    }

    const actor = room.players.find((player) => player.playerId === actorPlayerId);
    if (!actor) {
      return fail(ERROR_CODES.INVALID_STATE, "Player not found in room.");
    }
    return { ok: true };
  }

  validateChatMessage(text: unknown): ValidationResult {
    if (typeof text !== "string") {
      return fail(ERROR_CODES.INVALID_TEXT, "Chat text must be a string.");
    }
    const trimmed = text.trim();
    if (!trimmed) {
      return fail(ERROR_CODES.INVALID_TEXT, "Chat text cannot be empty.");
    }
    if (/\r?\n/.test(trimmed)) {
      return fail(ERROR_CODES.INVALID_TEXT, "Chat text must be a single line.");
    }
    if (trimmed.length > 200) {
      return fail(ERROR_CODES.TEXT_TOO_LONG, "Chat text is too long.");
    }
    return { ok: true };
  }

  validateNewGame(room: RoomState): ValidationResult {
    if (room.status !== "match-over") {
      return fail(ERROR_CODES.INVALID_STATE, "New game is only allowed after the match is over.");
    }
    return { ok: true };
  }
}
