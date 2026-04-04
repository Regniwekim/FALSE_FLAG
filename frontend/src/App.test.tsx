import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  const onceWrappers = new Map<Listener, Listener>();
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
    once(event: string, listener: Listener) {
      const wrapper: Listener = (payload) => {
        listener(payload);
        socket.off(event, listener);
      };
      onceWrappers.set(listener, wrapper);
      socket.on(event, wrapper);
    },
    off(event: string, listener: Listener) {
      const eventListeners = listeners.get(event);
      if (!eventListeners) {
        return;
      }
      const wrapper = onceWrappers.get(listener);
      if (wrapper) {
        eventListeners.delete(wrapper);
        onceWrappers.delete(listener);
      }
      eventListeners.delete(listener);
    },
    removeAllListeners() {
      listeners.clear();
      onceWrappers.clear();
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
    window.localStorage.clear();
  });

  afterEach(() => {
    mocked.socket.removeAllListeners();
    vi.useRealTimers();
    window.localStorage.clear();
    cleanup();
  });

  it("keeps the title header minimal and relocates session metadata into mission and intel windows", async () => {
    const { container } = render(<App />);

    const heroPanel = container.querySelector(".hero-panel") as HTMLElement | null;
    expect(heroPanel).not.toBeNull();
    expect(within(heroPanel as HTMLElement).getByRole("heading", { name: /\.false_flag\/\/GLOBAL SIGNAL/i })).toBeInTheDocument();
    expect(within(heroPanel as HTMLElement).getByRole("button", { name: "How to Play" })).toBeInTheDocument();
    expect(within(heroPanel as HTMLElement).getByRole("button", { name: "Credits" })).toBeInTheDocument();
    expect(within(heroPanel as HTMLElement).queryByText(/Week 3 Build In Progress/i)).not.toBeInTheDocument();
    expect(within(heroPanel as HTMLElement).queryByText(/Disconnected/i)).not.toBeInTheDocument();
    expect((heroPanel as HTMLElement).querySelector(".hero-meta")).toBeNull();

    mocked.socket.emitLocal(SERVER_TO_CLIENT.ROOM_CREATED, {
      roomCode: "ABC123",
      playerId: "p1",
      seat: "p1",
      difficulty: "easy"
    });

    await waitFor(() => {
      const missionWindow = screen.getByTestId("mission-window");
      const chatWindow = screen.getByTestId("chat-window");
      expect(within(missionWindow).queryByText("Mission Briefing")).not.toBeInTheDocument();
      expect(screen.getByTestId("mission-room-code")).toHaveTextContent("ABC123");
      expect(within(missionWindow).getByText("Room ABC123 created. Waiting for opponent.")).toBeInTheDocument();
      expect(within(chatWindow).getByRole("heading", { name: "Intercept Channel: ABC123" })).toBeInTheDocument();
    });

    mocked.socket.emitLocal(SERVER_TO_CLIENT.GAME_STARTED, {
      roundNumber: 1,
      activePlayerId: "p1",
      yourSecretFlag: "us",
      availableFlagCodes: TEST_FLAGS,
      yourBoardState: { eliminatedFlagCodes: [] }
    });

    await waitFor(() => {
      const intelWindow = screen.getByTestId("intel-window");
      const intelProgress = within(intelWindow).getByRole("progressbar", { name: "Intel gathered" });
      const hiddenCountryPanel = within(intelWindow).getByTestId("hidden-country-panel");
      const roundConsolePanel = within(intelWindow).getByTestId("round-console-panel");
      expect(screen.queryByTestId("score-ribbon")).not.toBeInTheDocument();
      expect(within(intelWindow).getByTestId("intel-round-overview")).toBeInTheDocument();
      expect(within(intelWindow).getByTestId("turn-status")).toHaveTextContent(/YOUR TURN|OPPONENT TURN/i);
      expect(within(intelWindow).queryByText("Active Agent")).not.toBeInTheDocument();
      expect(within(intelWindow).queryByText("Round Result")).not.toBeInTheDocument();
      expect(within(intelWindow).queryByText("Difficulty")).not.toBeInTheDocument();
      expect(intelProgress).toHaveAttribute("aria-valuenow", "0");
      expect(within(intelWindow).getByText(/0\s*\/\s*24\s*flags eliminated/i)).toBeInTheDocument();
      expect(within(intelWindow).getByText("Uplink")).toBeInTheDocument();
      expect(within(intelWindow).getByText("OFFLINE")).toBeInTheDocument();
      expect(within(hiddenCountryPanel).getByTestId("hidden-country-iso")).toHaveTextContent("US");
      expect(within(hiddenCountryPanel).getByRole("button", { name: "Expand hidden country details" })).toBeInTheDocument();
      expect(within(roundConsolePanel).getByRole("button", { name: "Collapse Round Console" })).toHaveAttribute("aria-expanded", "true");
      expect(within(intelWindow).getByRole("button", { name: "Minimize Intel Desk" })).toBeInTheDocument();
    });
  });

  it("restores an in-progress game from sync state after reconnect", async () => {
    render(<App />);

    expect(screen.queryByTestId("intel-window")).not.toBeInTheDocument();

    mocked.socket.emitLocal(SERVER_TO_CLIENT.SYNC_STATE, {
      roomStatus: "in-game",
      roundNumber: 2,
      activePlayerId: "p2",
      yourSecretFlag: "ca",
      availableFlagCodes: TEST_FLAGS,
      yourBoardState: { eliminatedFlagCodes: ["us", "mx"] }
    });

    await waitFor(() => {
      const intelWindow = screen.getByTestId("intel-window");
      expect(within(intelWindow).getByTestId("hidden-country-iso")).toHaveTextContent("CA");
      expect(within(intelWindow).getByText("2 / 24 flags eliminated")).toBeInTheDocument();
    });
  });

  it("persists displayName to localStorage when a room is created", async () => {
    render(<App />);

    fireEvent.change(screen.getByPlaceholderText("Display name"), { target: { value: "Agent" } });

    mocked.socket.emitLocal(SERVER_TO_CLIENT.ROOM_CREATED, {
      roomCode: "ABC123",
      playerId: "p1",
      seat: "p1",
      difficulty: "easy"
    });

    await waitFor(() => {
      expect(window.localStorage.getItem("ff_displayName")).toBe("Agent");
      expect(window.localStorage.getItem("ff_playerId")).toBe("p1");
      expect(window.localStorage.getItem("ff_roomCode")).toBe("ABC123");
    });
  });

  it("persists displayName to localStorage when a room is joined", async () => {
    render(<App />);

    fireEvent.change(screen.getByPlaceholderText("Display name"), { target: { value: "Agent" } });

    mocked.socket.emitLocal(SERVER_TO_CLIENT.ROOM_JOINED, {
      roomCode: "ABC123",
      playerId: "p1",
      seat: "p1",
      difficulty: "easy"
    });

    await waitFor(() => {
      expect(window.localStorage.getItem("ff_displayName")).toBe("Agent");
      expect(window.localStorage.getItem("ff_playerId")).toBe("p1");
      expect(window.localStorage.getItem("ff_roomCode")).toBe("ABC123");
    });
  });

  it("re-emits reconnect-room on every socket reconnect when session is stored", async () => {
    window.localStorage.setItem("ff_playerId", "p1");
    window.localStorage.setItem("ff_roomCode", "ABC123");
    window.localStorage.setItem("ff_displayName", "Agent");

    render(<App />);

    await waitFor(() => {
      expect(mocked.socket.emits.some((e) =>
        e.event === CLIENT_TO_SERVER.RECONNECT_ROOM &&
        e.payload.playerId === "p1" &&
        e.payload.roomCode === "ABC123" &&
        e.payload.displayName === "Agent"
      )).toBe(true);
    });

    mocked.socket.emitLocal(SERVER_TO_CLIENT.RECONNECT_SUCCESS, {
      roomCode: "ABC123",
      playerId: "p1",
      seat: "p1",
      difficulty: "easy",
      roomStatus: "in-game"
    });

    await waitFor(() => {
      expect(screen.getByText("Reconnected to room ABC123")).toBeInTheDocument();
    });

    mocked.socket.emits.length = 0;
    mocked.socket.disconnect();
    mocked.socket.connect();

    await waitFor(() => {
      expect(mocked.socket.emits.some((e) =>
        e.event === CLIENT_TO_SERVER.RECONNECT_ROOM &&
        e.payload.playerId === "p1" &&
        e.payload.roomCode === "ABC123" &&
        e.payload.displayName === "Agent"
      )).toBe(true);
    });

    mocked.socket.emitLocal(SERVER_TO_CLIENT.RECONNECT_SUCCESS, {
      roomCode: "ABC123",
      playerId: "p1",
      seat: "p1",
      difficulty: "easy",
      roomStatus: "in-game"
    });

    await waitFor(() => {
      expect(screen.getByText("Reconnected to room ABC123")).toBeInTheDocument();
    });
  });

  it("lets the round console collapse into its title bar and expand again", async () => {
    render(<App />);
    startAsPlayerOne();

    const intelWindow = await screen.findByTestId("intel-window");
    const roundConsolePanel = within(intelWindow).getByTestId("round-console-panel");

    expect(within(roundConsolePanel).getByRole("button", { name: "Collapse Round Console" })).toBeInTheDocument();
    expect(within(roundConsolePanel).getByRole("button", { name: "End Turn" })).toBeInTheDocument();

    fireEvent.click(within(roundConsolePanel).getByRole("button", { name: "Collapse Round Console" }));

    await waitFor(() => {
      expect(within(roundConsolePanel).getByRole("button", { name: "Expand Round Console" })).toHaveAttribute("aria-expanded", "false");
      expect(within(roundConsolePanel).queryByRole("button", { name: "End Turn" })).not.toBeInTheDocument();
      expect(within(roundConsolePanel).queryByRole("button", { name: "Make Guess" })).not.toBeInTheDocument();
    });

    fireEvent.click(within(roundConsolePanel).getByRole("button", { name: "Expand Round Console" }));

    await waitFor(() => {
      expect(within(roundConsolePanel).getByRole("button", { name: "Collapse Round Console" })).toHaveAttribute("aria-expanded", "true");
      expect(within(roundConsolePanel).getByRole("button", { name: "End Turn" })).toBeInTheDocument();
    });
  });

  it("starts the hidden country panel collapsed and preserves manual expansion across new rounds", async () => {
    render(<App />);
    startAsPlayerOne();

    const intelWindow = await screen.findByTestId("intel-window");
    const initialIntelWidth = Number.parseInt(intelWindow.style.width, 10);

    await waitFor(() => {
      const hiddenCountryPanel = screen.getByTestId("hidden-country-panel");
      expect(within(hiddenCountryPanel).getByRole("button", { name: "Expand hidden country details" })).toHaveAttribute("aria-expanded", "false");
      expect(within(hiddenCountryPanel).getByTestId("hidden-country-details")).toHaveAttribute("aria-hidden", "true");
      expect(within(hiddenCountryPanel).getByTestId("hidden-country-iso")).toHaveTextContent("US");
    });

    fireEvent.click(screen.getByRole("button", { name: "Expand hidden country details" }));

    await waitFor(() => {
      const hiddenCountryPanel = screen.getByTestId("hidden-country-panel");
      expect(within(hiddenCountryPanel).getByRole("button", { name: "Collapse hidden country details" })).toHaveAttribute("aria-expanded", "true");
      expect(within(hiddenCountryPanel).getByTestId("hidden-country-details")).toHaveAttribute("aria-hidden", "false");
      expect(within(hiddenCountryPanel).getByTestId("hidden-country-summary")).toBeInTheDocument();
      expect(within(hiddenCountryPanel).getByTestId("hidden-country-infobox")).toBeInTheDocument();
      expect(within(hiddenCountryPanel).getByText("Country Summary")).toBeInTheDocument();
      expect(within(hiddenCountryPanel).getByText("Capital")).toBeInTheDocument();
      expect(Number.parseInt(screen.getByTestId("intel-window").style.width, 10)).toBeGreaterThan(initialIntelWidth);
    });

    mocked.socket.emitLocal(SERVER_TO_CLIENT.NEW_GAME_STARTED, {
      roundNumber: 2,
      activePlayerId: "p1",
      yourSecretFlag: "ca",
      availableFlagCodes: TEST_FLAGS,
      yourBoardState: { eliminatedFlagCodes: [] }
    });

    await waitFor(() => {
      const hiddenCountryPanel = screen.getByTestId("hidden-country-panel");
      expect(within(hiddenCountryPanel).getByRole("button", { name: "Collapse hidden country details" })).toBeInTheDocument();
      expect(within(hiddenCountryPanel).getByTestId("hidden-country-details")).toHaveAttribute("aria-hidden", "false");
      expect(within(hiddenCountryPanel).getByTestId("hidden-country-iso")).toHaveTextContent("CA");
    });

    fireEvent.click(screen.getByRole("button", { name: "Collapse hidden country details" }));

    await waitFor(() => {
      const hiddenCountryPanel = screen.getByTestId("hidden-country-panel");
      expect(within(hiddenCountryPanel).getByRole("button", { name: "Expand hidden country details" })).toHaveAttribute("aria-expanded", "false");
      expect(within(hiddenCountryPanel).getByTestId("hidden-country-details")).toHaveAttribute("aria-hidden", "true");
    });
  });

  it("lets desktop intel and chat windows collapse into title bars and expand again", async () => {
    render(<App />);
    startAsPlayerOne();

    const intelWindow = await screen.findByTestId("intel-window");
    const chatWindow = await screen.findByTestId("chat-window");

    fireEvent.click(within(intelWindow).getByRole("button", { name: "Expand hidden country details" }));

    await waitFor(() => {
      const hiddenCountryPanel = within(screen.getByTestId("intel-window")).getByTestId("hidden-country-panel");
      expect(within(hiddenCountryPanel).getByTestId("hidden-country-details")).toHaveAttribute("aria-hidden", "false");
    });

    fireEvent.click(within(intelWindow).getByRole("button", { name: "Minimize Intel Desk" }));

    await waitFor(() => {
      expect(within(intelWindow).getByRole("button", { name: "Expand Intel Desk" })).toBeInTheDocument();
      expect(within(intelWindow).queryByText("Intel Gathered")).not.toBeInTheDocument();
      expect(intelWindow.className.includes("desktop-window-collapsed")).toBe(true);
      expect(intelWindow.style.height).toBe("64px");
    });

    fireEvent.click(within(chatWindow).getByRole("button", { name: "Minimize Intercept Channel: ABC123" }));

    await waitFor(() => {
      expect(within(chatWindow).getByRole("button", { name: "Expand Intercept Channel: ABC123" })).toBeInTheDocument();
      expect(within(chatWindow).queryByLabelText("Intercept composer")).not.toBeInTheDocument();
      expect(chatWindow.className.includes("desktop-window-collapsed")).toBe(true);
      expect(chatWindow.style.height).toBe("64px");
    });

    fireEvent.click(within(intelWindow).getByRole("button", { name: "Expand Intel Desk" }));
    fireEvent.click(within(chatWindow).getByRole("button", { name: "Expand Intercept Channel: ABC123" }));

    await waitFor(() => {
      expect(within(intelWindow).getByRole("button", { name: "Minimize Intel Desk" })).toBeInTheDocument();
      expect(within(intelWindow).getByText("Intel Gathered")).toBeInTheDocument();
      expect(within(within(intelWindow).getByTestId("hidden-country-panel")).getByTestId("hidden-country-details")).toHaveAttribute("aria-hidden", "false");
      expect(within(chatWindow).getByRole("button", { name: "Minimize Intercept Channel: ABC123" })).toBeInTheDocument();
      expect(within(chatWindow).getByLabelText("Intercept composer")).toBeInTheDocument();
    });
  });

  it("opens a centered credits window with source-specific attribution links", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Credits" }));

    const creditsDialog = await screen.findByRole("dialog", { name: "Credits" });
    expect(within(creditsDialog).getByText("SimpleMaps Free World SVG Map")).toBeInTheDocument();
    expect(within(creditsDialog).getByText("Flagcdn by Flagpedia")).toBeInTheDocument();
    expect(within(creditsDialog).getByText("Wikipedia Contributors")).toBeInTheDocument();
    expect(within(creditsDialog).getByText(/modified for gameplay metadata/i)).toBeInTheDocument();
    expect(within(creditsDialog).getByRole("link", { name: "Wikimedia Commons flag sources" })).toHaveAttribute("href", "https://commons.wikimedia.org/wiki/Category:SVG_flags_by_country");
    expect(within(creditsDialog).getByRole("link", { name: "SimpleMaps license" })).toHaveAttribute("href", "https://simplemaps.com/resources/svg-license");
    expect(within(creditsDialog).getByRole("link", { name: "CC BY-SA 4.0 license" })).toHaveAttribute("href", "https://creativecommons.org/licenses/by-sa/4.0/");

    fireEvent.click(within(creditsDialog).getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Credits" })).not.toBeInTheDocument();
    });
  });

  it("shows the lobby window before game start, hides it during the match, and restores it after match over", async () => {
    render(<App />);

    expect(screen.getByTestId("mission-window")).toBeInTheDocument();
    expect(screen.queryByTestId("intel-window")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chat-window")).not.toBeInTheDocument();

    mocked.socket.emitLocal(SERVER_TO_CLIENT.ROOM_CREATED, {
      roomCode: "ABC123",
      playerId: "p1",
      seat: "p1",
      difficulty: "easy"
    });

    await waitFor(() => {
      expect(screen.getByTestId("mission-window")).toBeInTheDocument();
      expect(screen.queryByTestId("intel-window")).not.toBeInTheDocument();
      expect(screen.getByTestId("chat-window")).toBeInTheDocument();
      expect(screen.getByText(/Intercept standby/i)).toBeInTheDocument();
    });

    expect(Number(screen.getByTestId("chat-window").style.zIndex)).toBeGreaterThan(
      Number(screen.getByTestId("mission-window").style.zIndex)
    );

    mocked.socket.emitLocal(SERVER_TO_CLIENT.GAME_STARTED, {
      roundNumber: 1,
      activePlayerId: "p1",
      yourSecretFlag: "us",
      availableFlagCodes: TEST_FLAGS,
      yourBoardState: { eliminatedFlagCodes: [] }
    });

    await waitFor(() => {
      expect(screen.queryByTestId("mission-window")).not.toBeInTheDocument();
      expect(screen.getByTestId("intel-window")).toBeInTheDocument();
      expect(screen.getByTestId("chat-window")).toBeInTheDocument();
      expect(screen.getByLabelText("Intercept composer")).toBeInTheDocument();
    });

    expect(Number(screen.getByTestId("chat-window").style.zIndex)).toBeGreaterThan(
      Number(screen.getByTestId("intel-window").style.zIndex)
    );

    mocked.socket.emitLocal(SERVER_TO_CLIENT.MATCH_OVER, { winnerPlayerId: "p1" });

    await waitFor(() => {
      expect(screen.getByTestId("mission-window")).toBeInTheDocument();
      expect(screen.getByTestId("intel-window")).toBeInTheDocument();
      expect(screen.getByTestId("chat-window")).toBeInTheDocument();
      expect(screen.getByText(/Round controls are locked/i)).toBeInTheDocument();
    });
  });

  it("enables ask only for active player in awaiting-question", async () => {
    render(<App />);

    startAsPlayerOne();

    const input = await screen.findByLabelText("Intercept composer");
    fireEvent.change(input, { target: { value: "Is it in Europe?" } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Ask Question" })).not.toBeDisabled();
    });

    expect(screen.queryByRole("button", { name: "Answer Yes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Answer No" })).not.toBeInTheDocument();
  });

  it("emits ask-question when ask is submitted", async () => {
    render(<App />);
    startAsPlayerOne();

    const input = await screen.findByLabelText("Intercept composer");
    fireEvent.change(input, { target: { value: "Is it in Europe?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask Question" }));

    await waitFor(() => {
      expect(mocked.socket.emits.some((e) => e.event === CLIENT_TO_SERVER.ASK_QUESTION)).toBe(true);
    });

    expect(screen.getByText("Question in flight")).toBeInTheDocument();

    mocked.socket.emitLocal(SERVER_TO_CLIENT.QUESTION_ACCEPTED, {
      question: "Is it in Europe?"
    });

    await waitFor(() => {
      expect(screen.queryByText("Question in flight")).not.toBeInTheDocument();
    });
  });

  it("sends chat on Enter from the shared intercept composer", async () => {
    render(<App />);
    startAsPlayerOne();

    const input = await screen.findByLabelText("Intercept composer");
    fireEvent.change(input, { target: { value: "hello from keyboard" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(
        mocked.socket.emits.some(
          (e) => e.event === CLIENT_TO_SERVER.CHAT_MESSAGE && e.payload.text === "hello from keyboard"
        )
      ).toBe(true);
    });
  });

  it("asks a question on Ctrl+Enter from the shared intercept composer", async () => {
    render(<App />);
    startAsPlayerOne();

    const input = await screen.findByLabelText("Intercept composer");
    fireEvent.keyDown(input, { key: "Control" });
    fireEvent.change(input, { target: { value: "Is it in Europe?" } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Ask Question" })).not.toBeDisabled();
    });

    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    fireEvent.keyUp(input, { key: "Control" });

    await waitFor(() => {
      expect(
        mocked.socket.emits.some(
          (e) => e.event === CLIENT_TO_SERVER.ASK_QUESTION && e.payload.question === "Is it in Europe?"
        )
      ).toBe(true);
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
    expect(screen.getByRole("button", { name: "Ask Question" })).toBeDisabled();
  });

  it("updates active player on turn-ended and disables ask for previous active player", async () => {
    render(<App />);
    startAsPlayerOne();

    const input = await screen.findByLabelText("Intercept composer");
    fireEvent.change(input, { target: { value: "Is it in Europe?" } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Ask Question" })).not.toBeDisabled();
    });

    mocked.socket.emitLocal(SERVER_TO_CLIENT.TURN_ENDED, { nextActivePlayerId: "p2" });
    mocked.socket.emitLocal(SERVER_TO_CLIENT.TURN_STATE_CHANGED, { state: "awaiting-question" });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Ask Question" })).toBeDisabled();
    });
  });

  it("lets players toggle flags off-turn and waits for board-updated before changing marker state", async () => {
    render(<App />);
    startAsPlayerOne();

    mocked.socket.emitLocal(SERVER_TO_CLIENT.TURN_ENDED, { nextActivePlayerId: "p2" });
    mocked.socket.emitLocal(SERVER_TO_CLIENT.TURN_STATE_CHANGED, { state: "awaiting-question" });

    await waitFor(() => {
      const usCardButton = screen.getByAltText("US").closest("button");
      expect(usCardButton).not.toBeNull();
      expect(usCardButton).not.toBeDisabled();
    });
    const usCard = screen.getByAltText("US").closest("button") as HTMLButtonElement | null;
    expect(usCard).not.toBeNull();
    const usCardButton = usCard as HTMLButtonElement;

    fireEvent.click(usCardButton);

    expect(
      mocked.socket.emits.some(
        (e) => e.event === CLIENT_TO_SERVER.SET_FLAG_ELIMINATION && e.payload.flagCode === "us" && e.payload.eliminated === true
      )
    ).toBe(true);
    expect(usCardButton.className.includes("flag-card-eliminated")).toBe(false);

    mocked.socket.emitLocal(SERVER_TO_CLIENT.BOARD_UPDATED, { eliminatedFlagCodes: ["us"] });

    await waitFor(() => {
      const updatedUsCard = screen.getByAltText("US").closest("button") as HTMLButtonElement | null;
      expect(updatedUsCard).not.toBeNull();
      expect((updatedUsCard as HTMLButtonElement).className.includes("flag-card-eliminated")).toBe(true);
      expect(screen.getByRole("progressbar", { name: "Intel gathered" })).toHaveAttribute("aria-valuenow", "4");
      expect(screen.getByText((content) => /1\s*\/\s*24\s*flags eliminated/i.test(content))).toBeInTheDocument();
    });

    fireEvent.click(screen.getByAltText("US").closest("button") as HTMLButtonElement);

    expect(
      mocked.socket.emits.some(
        (e) => e.event === CLIENT_TO_SERVER.SET_FLAG_ELIMINATION && e.payload.flagCode === "us" && e.payload.eliminated === false
      )
    ).toBe(true);

    mocked.socket.emitLocal(SERVER_TO_CLIENT.BOARD_UPDATED, { eliminatedFlagCodes: [] });

    await waitFor(() => {
      const restoredUsCard = screen.getByAltText("US").closest("button") as HTMLButtonElement | null;
      expect(restoredUsCard).not.toBeNull();
      expect((restoredUsCard as HTMLButtonElement).className.includes("flag-card-eliminated")).toBe(false);
      expect(screen.getByText((content) => /0\s*\/\s*24\s*flags eliminated/i.test(content))).toBeInTheDocument();
    });
  });

  it("locks board edits during round-over", async () => {
    render(<App />);
    startAsPlayerOne();

    mocked.socket.emitLocal(SERVER_TO_CLIENT.ROUND_OVER, {
      winnerPlayerId: "p2",
      loserPlayerId: "p1",
      reason: "wrong-guess",
      revealedSecrets: {
        p1: "us",
        p2: "ca"
      }
    });

    await waitFor(() => {
      const usCardButton = screen.getByAltText("US").closest("button");
      expect(usCardButton).not.toBeNull();
      expect(usCardButton).toBeDisabled();
    });
  });

  it("expands a compact map preview after sustained hover and removes it on leave", async () => {
    render(<App />);
    startAsPlayerOne();

    const usButton = await screen.findByRole("button", { name: "US" });
    const usMarker = usButton.closest(".map-flag-marker") as HTMLDivElement | null;
    expect(usMarker).not.toBeNull();

    vi.useFakeTimers();

    fireEvent.mouseEnter(usMarker as HTMLDivElement);
    expect(usButton.className.includes("map-flag-card-preview-active")).toBe(true);

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(screen.queryByTestId("map-flag-preview")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("map-flag-preview")).toHaveTextContent("Capital");
    expect(screen.getByTestId("map-flag-preview")).toHaveTextContent("Population");

    fireEvent.mouseLeave(usMarker as HTMLDivElement);
    expect(screen.queryByTestId("map-flag-preview")).not.toBeInTheDocument();
  });

  it("suppresses elimination on long press but still eliminates on short tap", async () => {
    render(<App />);
    startAsPlayerOne();

    const usButton = await screen.findByRole("button", { name: "US" });
    const usMarker = usButton.closest(".map-flag-marker") as HTMLDivElement | null;
    expect(usMarker).not.toBeNull();

    const countEliminateEmits = () => mocked.socket.emits.filter((event) => event.event === CLIENT_TO_SERVER.SET_FLAG_ELIMINATION).length;

    vi.useFakeTimers();

    fireEvent.touchStart(usMarker as HTMLDivElement, {
      touches: [{ identifier: 1, clientX: 240, clientY: 240 }]
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByTestId("map-flag-preview")).toBeInTheDocument();

    fireEvent.touchEnd(usMarker as HTMLDivElement, {
      changedTouches: [{ identifier: 1, clientX: 240, clientY: 240 }]
    });
    fireEvent.click(usButton);
    expect(countEliminateEmits()).toBe(0);
    expect(screen.queryByTestId("map-flag-preview")).not.toBeInTheDocument();

    fireEvent.touchStart(usMarker as HTMLDivElement, {
      touches: [{ identifier: 1, clientX: 240, clientY: 240 }]
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.touchEnd(usMarker as HTMLDivElement, {
      changedTouches: [{ identifier: 1, clientX: 240, clientY: 240 }]
    });
    fireEvent.click(usButton);

    expect(countEliminateEmits()).toBe(1);
    const eliminateEvents = mocked.socket.emits.filter((event) => event.event === CLIENT_TO_SERVER.SET_FLAG_ELIMINATION);
    expect(eliminateEvents[eliminateEvents.length - 1]?.payload).toEqual({ flagCode: "us", eliminated: true });
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

    mocked.socket.emitLocal(SERVER_TO_CLIENT.QUESTION_ACCEPTED, {
      question: "Is it in Europe?"
    });

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

  it("shows only your asked questions in the intel history table", async () => {
    render(<App />);
    startAsPlayerOne();

    const input = await screen.findByLabelText("Intercept composer");
    fireEvent.change(input, { target: { value: "Is it in Europe?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask Question" }));

    mocked.socket.emitLocal(SERVER_TO_CLIENT.QUESTION_ACCEPTED, {
      question: "Is it in Europe?"
    });

    mocked.socket.emitLocal(SERVER_TO_CLIENT.QUESTION_ANSWERED, {
      question: "Is it in Europe?",
      answer: "yes",
      answeredByPlayerId: "p2"
    });

    mocked.socket.emitLocal(SERVER_TO_CLIENT.INCOMING_QUESTION, {
      fromPlayerId: "p2",
      question: "Is it north of the equator?"
    });

    mocked.socket.emitLocal(SERVER_TO_CLIENT.QUESTION_ANSWERED, {
      question: "Is it north of the equator?",
      answer: "no",
      answeredByPlayerId: "p1"
    });

    await waitFor(() => {
      const historyTable = screen.getByRole("table", { name: "Question and answer history" });
      expect(within(historyTable).getByRole("columnheader", { name: "Question" })).toBeInTheDocument();
      expect(within(historyTable).getByRole("columnheader", { name: "Answer" })).toBeInTheDocument();
      expect(within(historyTable).getByText("Is it in Europe?")).toBeInTheDocument();
      expect(within(historyTable).getByText("YES")).toBeInTheDocument();
      expect(within(historyTable).queryByText("Is it north of the equator?")).not.toBeInTheDocument();
    });
  });

  it("shows countdown banner when next round is pending", async () => {
    render(<App />);
    startAsPlayerOne();

    mocked.socket.emitLocal(SERVER_TO_CLIENT.ROUND_OVER, {
      winnerPlayerId: "p1",
      loserPlayerId: "p2",
      reason: "correct-guess",
      revealedSecrets: {
        p1: "us",
        p2: "ca"
      }
    });

    mocked.socket.emitLocal(SERVER_TO_CLIENT.NEXT_ROUND_PENDING, {
      nextRoundStartsInMs: 1200,
      upcomingRoundNumber: 2
    });

    await waitFor(() => {
      expect(screen.getByText(/NEXT ROUND IN/i)).toBeInTheDocument();
    });
  });

  it("stages round-over reveal before showing both secrets", async () => {
    render(<App />);
    startAsPlayerOne();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Make Guess" })).toBeInTheDocument();
    });

    mocked.socket.emitLocal(SERVER_TO_CLIENT.ROUND_OVER, {
      winnerPlayerId: "p1",
      loserPlayerId: "p2",
      reason: "correct-guess",
      revealedSecrets: {
        p1: "us",
        p2: "ca"
      }
    });

    await waitFor(() => {
      expect(screen.getByText("Decrypting field intel...")).toBeInTheDocument();
      expect(screen.getByText("Your location was CLASSIFIED.")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText("Your location was US.")).toBeInTheDocument();
      expect(screen.getByText("Opponent location was CA.")).toBeInTheDocument();
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

  it("renders the updated intel round overview when score changes arrive", async () => {
    render(<App />);
    startAsPlayerOne();

    mocked.socket.emitLocal(SERVER_TO_CLIENT.SCORE_UPDATED, {
      matchScore: { p1: 2, p2: 1 },
      roundsPlayed: 3
    });

    await waitFor(() => {
      expect(screen.getByText(/First to\s*3\s*wins/i)).toBeInTheDocument();
    });

    const intelRoundOverview = screen.getByTestId("intel-round-overview");
    expect(screen.queryByTestId("score-ribbon")).not.toBeInTheDocument();
    expect(within(intelRoundOverview).getByText(/RED\s+CELL/i)).toBeInTheDocument();
    expect(within(intelRoundOverview).getByText(/BLUE\s+CELL/i)).toBeInTheDocument();

    await waitFor(() => {
      const selfScoreCard = within(intelRoundOverview).getByText(/RED\s+CELL/i).closest("article");
      expect(selfScoreCard?.className.includes("score-card-pulse")).toBe(true);
    });
  });
});
