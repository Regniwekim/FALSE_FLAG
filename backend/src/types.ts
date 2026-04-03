import type { RoomDifficulty } from "@flagwho/shared";

export interface PlayerState {
  playerId: string;
  socketId: string;
  seat: "p1" | "p2";
  displayName: string;
  secretFlagCode: string | null;
  eliminatedFlagCodes: string[];
}

export interface RoundState {
  roundNumber: number;
  activePlayerId: string;
  turnState: "awaiting-question" | "awaiting-answer" | "awaiting-asker-actions" | "round-over";
  pendingQuestion: {
    askedByPlayerId: string;
    text: string;
    answer?: "yes" | "no";
  } | null;
  winnerPlayerId: string | null;
  loserPlayerId: string | null;
  roundOverReason: "correct-guess" | "wrong-guess" | null;
}

export interface ChatMessage {
  fromPlayerId: string;
  text: string;
  createdAt: string;
}

export interface RoomState {
  roomCode: string;
  difficulty: RoomDifficulty;
  availableFlagCodes: string[];
  players: PlayerState[];
  status: "waiting" | "in-game" | "match-over" | "closed";
  championship: {
    targetWins: number;
    winsByPlayerId: Record<string, number>;
    roundsPlayed: number;
    matchWinnerPlayerId: string | null;
  };
  round: RoundState | null;
  chatLog: ChatMessage[];
}
