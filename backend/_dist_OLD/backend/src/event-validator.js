import { ERROR_CODES } from "@flagwho/shared";
import { isFlagCodeInList } from "./flag-catalog.js";
function fail(code, message) {
    return { ok: false, code, message };
}
export class EventValidator {
    validateAskQuestion(room, actorPlayerId, question) {
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
        return { ok: true };
    }
    validateAnswerQuestion(room, actorPlayerId, answer) {
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
    validateEndTurn(room, actorPlayerId) {
        if (!room.round || room.round.turnState !== "awaiting-asker-actions") {
            return fail(ERROR_CODES.INVALID_STATE, "Turn cannot be ended in the current state.");
        }
        if (room.round.activePlayerId !== actorPlayerId) {
            return fail(ERROR_CODES.NOT_YOUR_TURN, "Only the active player can end their turn.");
        }
        return { ok: true };
    }
    validateMakeGuess(room, actorPlayerId, guessedFlagCode) {
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
    validateSetFlagElimination(room, actorPlayerId, flagCode, eliminated) {
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
    validateChatMessage(text) {
        if (typeof text !== "string") {
            return fail(ERROR_CODES.INVALID_TEXT, "Chat text must be a string.");
        }
        const trimmed = text.trim();
        if (!trimmed) {
            return fail(ERROR_CODES.INVALID_TEXT, "Chat text cannot be empty.");
        }
        if (trimmed.length > 200) {
            return fail(ERROR_CODES.TEXT_TOO_LONG, "Chat text is too long.");
        }
        return { ok: true };
    }
    validateNewGame(room) {
        if (room.status !== "match-over") {
            return fail(ERROR_CODES.INVALID_STATE, "New game is only allowed after the match is over.");
        }
        return { ok: true };
    }
}
