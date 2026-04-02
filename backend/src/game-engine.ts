import type { RoomState } from "./types.js";
import { FLAG_CATALOG } from "./flag-catalog.js";

function pickTwoDistinctFlags() {
  const firstIndex = Math.floor(Math.random() * FLAG_CATALOG.length);
  let secondIndex = Math.floor(Math.random() * FLAG_CATALOG.length);
  while (secondIndex === firstIndex) {
    secondIndex = Math.floor(Math.random() * FLAG_CATALOG.length);
  }
  return [FLAG_CATALOG[firstIndex], FLAG_CATALOG[secondIndex]];
}

export class GameEngine {
  initializeRound(room: RoomState) {
    if (room.players.length !== 2) {
      throw new Error("Round initialization requires exactly two players");
    }

    const [flagP1, flagP2] = pickTwoDistinctFlags();
    room.players[0].secretFlagCode = flagP1;
    room.players[1].secretFlagCode = flagP2;
    room.players[0].eliminatedFlagCodes = [];
    room.players[1].eliminatedFlagCodes = [];

    room.round = {
      roundNumber: room.championship.roundsPlayed + 1,
      activePlayerId: room.players[0].playerId,
      turnState: "awaiting-question",
      pendingQuestion: null,
      winnerPlayerId: null,
      loserPlayerId: null,
      roundOverReason: null
    };
    room.status = "in-game";
  }

  getPlayerView(room: RoomState, playerId: string) {
    const player = room.players.find((p) => p.playerId === playerId);
    if (!player || !room.round) {
      return null;
    }

    return {
      roundNumber: room.round.roundNumber,
      activePlayerId: room.round.activePlayerId,
      yourSecretFlag: player.secretFlagCode,
      yourBoardState: {
        eliminatedFlagCodes: player.eliminatedFlagCodes
      }
    };
  }

  resolveAnswer(room: RoomState, answer: "yes" | "no") {
    if (!room.round || !room.round.pendingQuestion) {
      throw new Error("No pending question to resolve");
    }
    room.round.pendingQuestion.answer = answer;
    room.round.turnState = "awaiting-asker-actions";
  }

  endTurn(room: RoomState) {
    if (!room.round) {
      throw new Error("Cannot end turn without active round");
    }
    const previousActive = room.round.activePlayerId;
    const nextPlayer = room.players.find((player) => player.playerId !== previousActive);
    if (!nextPlayer) {
      throw new Error("Cannot determine next active player");
    }

    room.round.activePlayerId = nextPlayer.playerId;
    room.round.pendingQuestion = null;
    room.round.turnState = "awaiting-question";
  }

  resolveGuess(room: RoomState, actorPlayerId: string, guessedFlagCode: string) {
    if (!room.round) {
      throw new Error("Cannot resolve guess without active round");
    }
    const opponent = room.players.find((player) => player.playerId !== actorPlayerId);
    if (!opponent || !opponent.secretFlagCode) {
      throw new Error("Opponent secret is unavailable");
    }

    const isCorrectGuess = guessedFlagCode === opponent.secretFlagCode;
    const winnerPlayerId = isCorrectGuess ? actorPlayerId : opponent.playerId;
    const loserPlayerId = isCorrectGuess ? opponent.playerId : actorPlayerId;
    const reason = isCorrectGuess ? "correct-guess" : "wrong-guess" as const;

    room.round.turnState = "round-over";
    room.round.pendingQuestion = null;
    room.round.winnerPlayerId = winnerPlayerId;
    room.round.loserPlayerId = loserPlayerId;
    room.round.roundOverReason = reason;

    room.championship.roundsPlayed += 1;
    room.championship.winsByPlayerId[winnerPlayerId] = (room.championship.winsByPlayerId[winnerPlayerId] ?? 0) + 1;
    if (room.championship.winsByPlayerId[winnerPlayerId] >= room.championship.targetWins) {
      room.championship.matchWinnerPlayerId = winnerPlayerId;
      room.status = "match-over";
    }

    return {
      winnerPlayerId,
      loserPlayerId,
      reason,
      matchOver: room.status === "match-over"
    };
  }

  resetMatch(room: RoomState) {
    room.championship.roundsPlayed = 0;
    room.championship.matchWinnerPlayerId = null;
    for (const player of room.players) {
      room.championship.winsByPlayerId[player.playerId] = 0;
    }
    this.initializeRound(room);
  }
}
