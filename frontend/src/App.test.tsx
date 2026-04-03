import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";
import { CLIENT_TO_SERVER, SERVER_TO_CLIENT } from "@flagwho/shared";

const TEST_FLAGS = [
  "us", "ca", "mx", "cu", "br", "ar",
  "co", "pe", "gb", "fr", "de", "it",
  "za", "ng", "eg", "ke", "cn", "in",
  "jp", "kr", "au", "nz", "tr", "sa"
];

type Listener = (payload?: any) => void;

const mocked = vi.hoisted(() => {
  const listeners = new Map<string, Set<Listener>>();
  const emits: Array<{ event: string; payload: any }> = [];

  const socket = {
    emits,
    connect() {
      for (const listener of listeners.get("connect") ?? []) {
        listener();
      }
    },
    disconnect() {
      for (const listener of listeners.get("disconnect") ?? []) {
        listener();
      }
    },
    on(event: string, listener: Listener) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)?.add(listener);
    },
    removeAllListeners() {
      listeners.clear();
      emits.length = 0;
    },
    emit(event: string, payload: any) {
      emits.push({ event, payload });
    },
    emitLocal(event: string, payload?: any) {
      for (const listener of listeners.get(event) ?? []) {
        listener(payload);
      }
    }
  };

  return { socket };
});

vi.mock("./socket", () => ({ socket: mocked.socket }));

describe("App turn/state control gating", () => {
  function startAsPlayerOne() {
    mocked.socket.emitLocal(SERVER_TO_CLIENT.ROOM_CREATED, {
      roomCode: "ABC123",
      playerId: "p1",
      seat: "p1",
      difficulty: "easy"
    });

    mocked.socket.emitLocal(SERVER_TO_CLIENT.GAME_STARTED, {
      roundNumber: 1,
      activePlayerId: "p1",
      yourSecretFlag: "us",
      availableFlagCodes: TEST_FLAGS,
      yourBoardState: { eliminatedFlagCodes: [] }
    });
  }

  beforeEach(() => {
    mocked.socket.removeAllListeners();
  });

  afterEach(() => {
    mocked.socket.removeAllListeners();
    cleanup();
  });

  it("enables ask only for active player in awaiting-question", async () => {
    render(<App />);

    startAsPlayerOne();

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Ask a yes-or-no question")).not.toBeDisabled();
    });

    expect(screen.queryByRole("button", { name: "Answer Yes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Answer No" })).not.toBeInTheDocument();
  });

  it("emits ask-question when ask is submitted", async () => {
    render(<App />);
    startAsPlayerOne();

    const input = screen.getByPlaceholderText("Ask a yes-or-no question");
    fireEvent.change(input, { target: { value: "Is it in Europe?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() => {
      expect(mocked.socket.emits.some((e) => e.event === CLIENT_TO_SERVER.ASK_QUESTION)).toBe(true);
    });

    expect(screen.getByText("Question in flight")).toBeInTheDocument();

    mocked.socket.emitLocal(SERVER_TO_CLIENT.TURN_STATE_CHANGED, {
      state: "awaiting-answer"
    });

    await waitFor(() => {
      expect(screen.queryByText("Question in flight")).not.toBeInTheDocument();
    });
  });

  it("enables answer buttons for non-active player in awaiting-answer with incoming question", async () => {
    render(<App />);

    mocked.socket.emitLocal(SERVER_TO_CLIENT.ROOM_JOINED, {
      roomCode: "ABC123",
      playerId: "p2",
      seat: "p2",
      difficulty: "easy"
    });

    mocked.socket.emitLocal(SERVER_TO_CLIENT.GAME_STARTED, {
      roundNumber: 1,
      activePlayerId: "p1",
      yourSecretFlag: "ca",
      availableFlagCodes: TEST_FLAGS,
      yourBoardState: { eliminatedFlagCodes: [] }
    });

    mocked.socket.emitLocal(SERVER_TO_CLIENT.TURN_STATE_CHANGED, {
      state: "awaiting-answer"
    });

    mocked.socket.emitLocal(SERVER_TO_CLIENT.INCOMING_QUESTION, {
      fromPlayerId: "p1",
      question: "Is it in Europe?"
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Answer Yes" })).not.toBeDisabled();
    });

    expect(screen.getByRole("button", { name: "Answer No" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
  });

  it("updates active player on turn-ended and disables ask for previous active player", async () => {
    render(<App />);
    startAsPlayerOne();

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Ask a yes-or-no question")).not.toBeDisabled();
    });

    mocked.socket.emitLocal(SERVER_TO_CLIENT.TURN_ENDED, { nextActivePlayerId: "p2" });
    mocked.socket.emitLocal(SERVER_TO_CLIENT.TURN_STATE_CHANGED, { state: "awaiting-question" });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Ask a yes-or-no question")).toBeDisabled();
    });
  });

  it("keeps flag card visible until board-updated confirms elimination", async () => {
    render(<App />);
    startAsPlayerOne();

    mocked.socket.emitLocal(SERVER_TO_CLIENT.TURN_STATE_CHANGED, { state: "awaiting-asker-actions" });
    await waitFor(() => {
      const usCardButton = screen.getByAltText("US").closest("button");
      expect(usCardButton).not.toBeNull();
      expect(usCardButton).not.toBeDisabled();
    });
    const usCard = screen.getByAltText("US").closest("button") as HTMLButtonElement | null;
    expect(usCard).not.toBeNull();
    const usCardButton = usCard as HTMLButtonElement;

    fireEvent.click(usCardButton);

    expect(mocked.socket.emits.some((e) => e.event === CLIENT_TO_SERVER.ELIMINATE_FLAG)).toBe(true);
    expect(usCardButton.className.includes("flag-card-eliminated")).toBe(false);

    mocked.socket.emitLocal(SERVER_TO_CLIENT.BOARD_UPDATED, { eliminatedFlagCodes: ["us"] });

    await waitFor(() => {
      const updatedUsCard = screen.getByAltText("US").closest("button") as HTMLButtonElement | null;
      expect(updatedUsCard).not.toBeNull();
      expect((updatedUsCard as HTMLButtonElement).className.includes("flag-card-eliminated")).toBe(true);
    });
  });

  it("shows rematch only after match-over and emits new-game", async () => {
    render(<App />);
    startAsPlayerOne();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Make Guess" })).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: "Rematch" })).not.toBeInTheDocument();

    mocked.socket.emitLocal(SERVER_TO_CLIENT.MATCH_OVER, { winnerPlayerId: "p1" });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Rematch" })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Rematch" }));
    expect(mocked.socket.emits.some((e) => e.event === CLIENT_TO_SERVER.NEW_GAME)).toBe(true);
  });

  it("shows answer badge and action errors in the feedback layer", async () => {
    render(<App />);
    startAsPlayerOne();

    mocked.socket.emitLocal(SERVER_TO_CLIENT.QUESTION_ANSWERED, {
      question: "Is it in Europe?",
      answer: "no",
      answeredByPlayerId: "p2"
    });

    await waitFor(() => {
      expect(screen.getByText("NO")).toBeInTheDocument();
    });

    mocked.socket.emitLocal(SERVER_TO_CLIENT.ACTION_ERROR, {
      code: "INVALID_STATE",
      message: "No active game room."
    });

    await waitFor(() => {
      expect(screen.getByText("No active game room.")).toBeInTheDocument();
    });
  });

  it("filters eliminated flags from the guess modal and emits the selected guess", async () => {
    render(<App />);
    startAsPlayerOne();

    mocked.socket.emitLocal(SERVER_TO_CLIENT.BOARD_UPDATED, {
      eliminatedFlagCodes: ["us", "ca"]
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Make Guess" })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Make Guess" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Guess flag" }));

    expect(screen.queryByRole("option", { name: "US" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "CA" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: "MX" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Guess" }));

    expect(
      mocked.socket.emits.some(
        (e) => e.event === CLIENT_TO_SERVER.MAKE_GUESS && e.payload.guessedFlagCode === "mx"
      )
    ).toBe(true);
  });

  it("supports native-like letter keyboard navigation for guess picker", async () => {
    render(<App />);
    startAsPlayerOne();

    mocked.socket.emitLocal(SERVER_TO_CLIENT.BOARD_UPDATED, {
      eliminatedFlagCodes: ["us", "ca"]
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Make Guess" })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Make Guess" }));

    const guessTrigger = screen.getByRole("combobox", { name: "Guess flag" });
    fireEvent.keyDown(guessTrigger, { key: "m" });
    fireEvent.keyDown(guessTrigger, { key: "x" });

    expect(guessTrigger).toHaveTextContent("MX");

    fireEvent.click(screen.getByRole("button", { name: "Confirm Guess" }));

    expect(
      mocked.socket.emits.some(
        (e) => e.event === CLIENT_TO_SERVER.MAKE_GUESS && e.payload.guessedFlagCode === "mx"
      )
    ).toBe(true);
  });

  it("closes the guess modal on outside click and Escape", async () => {
    render(<App />);
    startAsPlayerOne();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Make Guess" })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Make Guess" }));
    const firstDialog = screen.getByRole("dialog", { name: "Make Guess" });
    fireEvent.mouseDown(firstDialog.parentElement as HTMLElement);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Make Guess" })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Make Guess" }));
    expect(screen.getByRole("dialog", { name: "Make Guess" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Make Guess" })).not.toBeInTheDocument();
    });
  });

  it("renders the updated score ribbon when score changes arrive", async () => {
    render(<App />);
    startAsPlayerOne();

    mocked.socket.emitLocal(SERVER_TO_CLIENT.SCORE_UPDATED, {
      matchScore: { p1: 2, p2: 1 },
      roundsPlayed: 3
    });

    await waitFor(() => {
      expect(screen.getByText(/First to\s*3\s*wins/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/RED\s+CELL/i)).toBeInTheDocument();
    expect(screen.getByText(/BLUE\s+CELL/i)).toBeInTheDocument();
  });
});
