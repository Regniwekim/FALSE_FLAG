Gathering key project files and current backend architecture so ticket estimates match the actual codebase.

Read [](file:///c%3A/Users/regni/Desktop/Guess%20Where/backend/src/server.ts#1-1), lines 1 to 220

Read [](file:///c%3A/Users/regni/Desktop/Guess%20Where/package.json)

Read [](file:///c%3A/Users/regni/Desktop/Guess%20Where/backend/package.json)

Read [](file:///c%3A/Users/regni/Desktop/Guess%20Where/backend/src/room-manager.ts)

Read [](file:///c%3A/Users/regni/Desktop/Guess%20Where/backend/src/event-validator.ts)

I found the backend architecture and validation flow; next I’m checking automation and deployment config so the task breakdown includes real repo needs.

Searched for regex `github actions|workflow|render.yaml|deploy|CI|typecheck|build|test`, 100 results

I found deployment configuration references and the repo already has Render service definitions; now I’m confirming exact deployment and docs details for story sizing.

Read [](file:///c%3A/Users/regni/Desktop/Guess%20Where/render.yaml)

Read [](file:///c%3A/Users/regni/Desktop/Guess%20Where/README.md#60-60), lines 60 to 180

I’ve confirmed Render deployment config and README local run commands. Now I’m checking whether CI workflow files already exist so ticket scope is accurate.

Read [](file:///c%3A/Users/regni/Desktop/Guess%20Where)

I’ve mapped the week 4 scope to the repo state; storing the ticket breakdown now and then I’ll show you the full list with story points.

Created memory file [](file:///c%3A/Users/regni/AppData/Roaming/Code/User/workspaceStorage/c6f6b626a63194fb131f281cea73001e/GitHub.copilot-chat/memory-tool/memories/YjJlMTcwZTktYzQ5YS00NWQxLWFmMTgtZWQ2OGNlZDc0YTkw/plan.md)

## Week 4 Ticket Breakdown (with story points)

**Total estimate: 24 points**

1. **Socket event rate limiting** — 3 points
   - Add backend-side throttling for Socket.IO messages.
   - Enforce per-socket and per-room limits.
   - Return explicit rate-limit error code for clients.
   - Add tests for throttled actions.

2. **Backend input sanitization + audit logging** — 3 points
   - Harden event-validator.ts for chat/question text.
   - Add audit logging for invalid action attempts, malformed payloads, and rate-limit hits.
   - Keep logs safe and avoid leaking opponent secrets.

3. **Reconnect/session token room rejoin** — 5 points
   - Persist player session state across disconnect/reconnect.
   - Update room-manager.ts and server.ts.
   - Restore socket membership and private view after reconnect.
   - Add tests for reconnect flows.

4. **Heartbeat / stale connection cleanup** — 3 points
   - Implement disconnect grace timeout and cleanup logic.
   - Remove stale room/player state safely.
   - Add tests for timeout-driven cleanup.

5. **Idempotency for duplicate events** — 2 points
   - Add duplicate-event protection in backend handling.
   - Prevent repeated socket messages from replaying the same action.
   - Add dedupe tests.

6. **CI workflow creation/finalization** — 3 points
   - Add GitHub Actions pipeline if missing.
   - Cover install, `typecheck`, `build`, backend tests, frontend tests, and smoke checks.
   - Make sure package.json commands are the source of truth.

7. **Update release and deployment docs** — 2 points
   - Document Week 4 production readiness in README.md and/or roadmap.md.
   - Include staging deployment validation and Render env var setup.

8. **Basic observability / metrics hooks** — 2 points
   - Add simple counters for rooms, disconnects, and round duration.
   - Expose metrics or status info alongside `/health`.
   - Document in README.

9. **Staging soak test + release checklist** — 1 point
   - Run full stack in staging.
   - Validate reconnect/retry, rate limits, invalid actions, and match completion.
   - Confirm backend logs and live behavior.

---

### Key files
- server.ts
- room-manager.ts
- event-validator.ts
- game-engine.ts
- README.md
- render.yaml
- package.json
- `.github/workflows/ci.yml` (new)