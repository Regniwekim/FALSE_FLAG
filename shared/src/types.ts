import type { RoomDifficulty } from "./flags.js";

export type Seat = "p1" | "p2";

export type TurnState =
  | "awaiting-question"
  | "awaiting-answer"
  | "awaiting-asker-actions"
  | "round-over";

export type RoundOverReason = "correct-guess" | "wrong-guess";

export interface ActionErrorPayload {
  code: string;
  message: string;
}

export interface CreateRoomPayload {
  displayName?: string;
  difficulty?: RoomDifficulty;
}

export interface JoinRoomPayload {
  roomCode: string;
  displayName?: string;
}

export interface AskQuestionPayload {
  question: string;
}

export interface AnswerQuestionPayload {
  answer: "yes" | "no";
}

export interface SetFlagEliminationPayload {
  flagCode: string;
  eliminated: boolean;
}

export interface MakeGuessPayload {
  guessedFlagCode: string;
}

export interface ChatMessagePayload {
  text: string;
}

export interface PlayerView {
  playerId: string;
  seat: Seat;
  displayName: string;
}

export interface RoomCreatedPayload {
  roomCode: string;
  playerId: string;
  seat: Seat;
  difficulty: RoomDifficulty;
}

export interface GameStartedPayload {
  roundNumber: number;
  activePlayerId: string;
  yourSecretFlag: string;
  availableFlagCodes: string[];
  yourBoardState: {
    eliminatedFlagCodes: string[];
  };
}

export interface TurnStateChangedPayload {
  state: TurnState;
}

export interface IncomingQuestionPayload {
  fromPlayerId: string;
  question: string;
}

export interface QuestionAcceptedPayload {
  question: string;
}

export interface QuestionAnsweredPayload {
  question: string;
  answer: "yes" | "no";
  answeredByPlayerId: string;
}

export interface GuessLockedPayload {
  guessedFlagCode: string;
}

export interface NextRoundPendingPayload {
  nextRoundStartsInMs: number;
  upcomingRoundNumber: number;
}

export interface BoardUpdatedPayload {
  eliminatedFlagCodes: string[];
}

export interface ChatMessageEventPayload {
  fromPlayerId: string;
  text: string;
  createdAt: string;
}

export interface SyncStatePayload {
  turnState?: TurnState;
  activePlayerId?: string;
  yourBoardState?: {
    eliminatedFlagCodes: string[];
  };
  roomStatus?: "waiting" | "in-game" | "match-over" | "closed";
}

export interface RoundOverPayload {
  winnerPlayerId: string;
  loserPlayerId: string;
  reason: RoundOverReason;
  revealedSecrets: Record<string, string | null>;
}
