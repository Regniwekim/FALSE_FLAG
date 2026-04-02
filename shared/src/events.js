export const CLIENT_TO_SERVER = {
    CREATE_ROOM: "create-room",
    JOIN_ROOM: "join-room",
    ASK_QUESTION: "ask-question",
    ANSWER_QUESTION: "answer-question",
    ELIMINATE_FLAG: "eliminate-flag",
    END_TURN: "end-turn",
    MAKE_GUESS: "make-guess",
    CHAT_MESSAGE: "chat-message",
    NEW_GAME: "new-game"
};
export const SERVER_TO_CLIENT = {
    ROOM_CREATED: "room-created",
    ROOM_JOINED: "room-joined",
    GAME_STARTED: "game-started",
    INCOMING_QUESTION: "incoming-question",
    QUESTION_ANSWERED: "question-answered",
    CHAT_MESSAGE: "chat-message",
    BOARD_UPDATED: "board-updated",
    TURN_ENDED: "turn-ended",
    TURN_STATE_CHANGED: "turn-state-changed",
    ROUND_OVER: "round-over",
    SCORE_UPDATED: "score-updated",
    MATCH_OVER: "match-over",
    NEW_GAME_STARTED: "new-game-started",
    ACTION_ERROR: "action-error",
    SYNC_STATE: "sync-state",
    PLAYER_JOINED: "player-joined",
    PLAYER_LEFT: "player-left",
    ROOM_CLOSED: "room-closed"
};
