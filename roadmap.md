**Roadmap**
1. Week 0. Project framing and architecture freeze (0.5-1 day)
- Confirm game rules and non-negotiables from plan.html and official rules source.
- Lock stack: frontend React + TypeScript + Vite, backend Node + Express + Socket.io, server-authoritative state.
- Define source-of-truth docs:
  1. Protocol spec for all socket events.
  2. State model for room, player, round, championship.
  3. Validation matrix for anti-cheat checks.
- Week 0 artifacts (created):
  1. docs/week0/architecture-freeze.md
  2. docs/week0/protocol-spec.md
  3. docs/week0/state-model.md
  4. docs/week0/validation-matrix.md
- Week 0 sign-off checklist:
  1. Confirm final event names and payload fields match implementation intent.
  2. Confirm allowed state transitions are complete and exclusive.
  3. Confirm privacy boundaries for secret flags and eliminated sets.
  4. Confirm wrong-guess immediate-loss behavior is accepted.
- Week 0 sign-off status: Completed on 2026-04-02 (approved for Week 1 kickoff).
- Exit criteria:
  1. All event payloads and allowed transitions documented.
  2. No unresolved design ambiguity around turn flow or guessing penalties.

2. Week 1. Monorepo and core game engine (MVP foundation)
- Current status (2026-04-02): Completed and signed off. Monorepo scaffold created with frontend/backend/shared, initial room create/join plus game-start skeleton, and basic frontend board/secret-slot/turn-banner UI.
- Test status (2026-04-02): Backend Week 1 tests implemented and passing (unit validation/state transitions, socket integration turn loop, negative out-of-turn and malformed payload tests, and wrong-guess immediate-loss round-over integration coverage).
- Week 1 sign-off status: Completed on 2026-04-02.
- Create repo structure:
  1. frontend
  2. backend
  3. shared (types/constants/event contracts)
- Backend first:
  1. Room service with create/join, 2-player cap, room lifecycle.
  2. Game state model: secret flags, current turn, eliminated sets, chat log, round result, match score.
  3. Deterministic turn state machine:
     - Idle
     - Awaiting question
     - Awaiting answer
     - Awaiting asker actions
     - Turn end
     - Round over
- Frontend skeleton:
  1. Lobby screen (create room / join room code).
  2. Board grid rendering 24 flags.
  3. Secret slot and basic turn banner.
- Exit criteria:
  1. Two browser tabs can join same room.
  2. Server allocates unique secrets correctly.
  3. Turn owner is always accurate and visible on both clients.

3. Week 2. Full real-time gameplay loop (critical path)
- Current status (2026-04-03): Backend implements the Week 2 socket flow with server-side validation and championship progression, and private board editing now uses `set-flag-elimination` so either player can toggle their own eliminated flags during any live round state before `round-over`. Frontend keeps ask/answer/end-turn/guess turn gating, while board editing is room-active rather than turn-owner gated.
- Test status (2026-04-03): Workspace `typecheck`, targeted backend validation/socket/privacy tests, frontend component tests, Playwright desktop/mobile flows, and the full workspace build all pass for anytime private-board toggling, round-over lockout, actor-local `board-updated` privacy, and reversible marker state.
- Additional validation (2026-04-02): Frontend component tests added for turn/state control gating (ask/answer enablement), and backend privacy integration test added to verify opponent secret is not revealed before `round-over`.
- Additional validation (2026-04-02): Frontend component tests expanded for turn/state control gating (ask/answer, turn-owner updates, elimination confirmation behavior, and match-over new-game control), and backend privacy integration test verifies opponent secret is not revealed before `round-over`.
- Additional validation (2026-04-02): Playwright E2E test added and passing for a two-context browser flow (create/join -> ask/answer -> eliminate -> end-turn -> chat) using live frontend+backend servers.
- Additional validation (2026-04-02): Second Playwright E2E test added and passing for round-over to championship completion and `new-game` reset across two clients.
- Additional validation (2026-04-02): Post-sign-off bugfix pass completed for room join enablement, flag image rendering, and chat visibility; frontend tests were updated to match the image-backed board markup and all verification gates were rerun successfully.
- Week 2 sign-off status: Completed on 2026-04-02 with final regression pass green (`frontend` tests, `backend` tests, Playwright E2E, workspace `typecheck`, workspace `build`).
- Implement the full socket contract from plan.html:
  1. create-room, join-room
  2. ask-question
  3. answer-question
  4. set-flag-elimination
  5. end-turn
  6. make-guess
  7. chat-message
  8. new-game
- Add strict server validation:
  1. Event allowed only in correct state.
  2. Event allowed only by correct player.
  3. Question must end with question mark.
  4. Guess only on active player turn.
  5. Wrong guess causes immediate loss.
- Client UX:
  1. Disable invalid controls when not permitted.
  2. Render chat history and incoming question flow.
  3. Local elimination state synchronized from server confirmation only.
- Exit criteria:
  1. Complete round is playable end-to-end with no manual resets.
  2. Cheating attempts are rejected with clear errors.
  3. No opponent secret leaks in any payload.

4. Week 3. Feature complete UI and championship mode
- Current status (2026-04-02): Completed and sign-off ready. Week 3 frontend is fully landed in a vaporwave presentation (neon championship header/score ribbon, interactive world map board, intel desk framing, intercept-style chat), with LAN/mobile usability refinements and accessible custom guess picker interactions (flag icons, keyboard letter navigation, modal focus trap, and outside-click/Escape close).
- Additional progress (2026-04-02): Match-over controls now expose explicit `Rematch` and `New Room` actions in the championship result card, replacing the prior generic new-game affordance in the normal action row.
- Additional progress (2026-04-02): Round-transition UX now includes a visible `NEXT ROUND INITIALIZING...` banner between non-final rounds, with server-authoritative delayed auto-init under 2 seconds and explicit integration/E2E coverage.
- Test status (2026-04-02): Validation is fully green for Week 3 sign-off: backend tests (22/22), frontend component tests (10/10), Playwright E2E flows (3/3, including mobile portrait and transition banner lifecycle), workspace `typecheck`, and workspace `build` all pass.
- Week 3 sign-off status: Completed on 2026-04-02.
- Build components listed in plan.html:
  1. Header with player labels and score.
  2. Secret slot.
  3. Personal 6x4 grid with elimination animation.
  4. Live chat with yes/no quick actions for responder.
  5. Turn indicator.
  6. Guess modal filtered by remaining flags.
  7. Mobile portrait layout.
- Championship mode (best of 5 from plan.html):
  1. Match score tracking across rounds.
  2. Auto next-round initialization.
  3. Match over screen with rematch/new room options.
- Exit criteria:
  1. Match plays from round 1 to series win.
  2. Responsive behavior verified on desktop and phone widths.
  3. Round transitions are less than 2 seconds.

5. Week 4. Production hardening, security, and release
- Security from plan.html:
  1. Rate limits per socket and per room.
  2. Disconnect pause/resume strategy with grace timeout.
  3. Input sanitization for chat/question text.
  4. Audit logging for invalid action attempts.
- Reliability:
  1. Reconnect flow with session token and room rejoin.
  2. Heartbeat/timeout handling.
  3. Idempotency safeguards for duplicate events.
- Delivery from plan.html:
  1. Full repo with frontend/backend.
  2. README with single dev command.
  3. Deploy frontend and backend, set production env vars.
- Exit criteria:
  1. Staging soak test passes.
  2. Zero critical/high issues.
  3. Demo URL and setup docs ready.
  4. Staging soak test and release checklist completed (see README.md for validation steps).

**Detailed workstreams**
1. Backend workstream
- Modules:
  1. RoomManager
  2. GameEngine
  3. EventValidator
  4. RealtimeGateway
- Key implementation order:
  1. Types/constants
  2. State machine
  3. Event handlers
  4. Validation and guards
  5. Reconnect logic
- Tests:
  1. Unit tests for rule validation and state transitions.
  2. Integration socket tests for full turn loops.
  3. Negative tests for out-of-turn and malformed payloads.

2. Frontend workstream
- Modules:
  1. Lobby
  2. GameBoard
  3. ChatPanel
  4. GuessModal
  5. Scoreboard
  6. Socket client store
- Key implementation order:
  1. Read-only board and turn status
  2. Question/answer UX
  3. Elimination interactions
  4. Guess flow
  5. Championship and polish
- Tests:
  1. Component tests for control enable/disable by turn/state.
  2. E2E two-player flow in two browser contexts.

3. DevOps and quality workstream
- CI:
  1. Lint, typecheck, unit tests, integration tests.
  2. Build frontend and backend artifacts.
- Observability:
  1. Error tracking on both tiers.
  2. Basic metrics: room count, round duration, disconnect rate.
- Release:
  1. Staging deployment.
  2. Production deployment.
  3. Post-release monitoring window.

**Acceptance checklist**
1. Functional
- Two-player room creation and join works.
- Server-authoritative gameplay works with no rule bypass.
- Wrong guess instantly ends round with loss.
- Best-of-5 match mode works.

2. Security
- Opponent secret is never sent to unauthorized client.
- All game actions validated server-side.
- Rate limits active for spam prevention.

3. UX
- Round completes in under 60 seconds in normal play.
- Mobile portrait mode is usable without layout breakage.
- Turn and action affordances are always clear.

4. Delivery
- Repo structure and README are complete.
- One-command local run works.
- Live deployed demo is accessible.

If you want, I can next turn this into a day-by-day execution plan (with ticket-sized tasks and story points) so you can start implementation immediately.