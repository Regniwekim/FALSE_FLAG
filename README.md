# FALSE_FLAG

FALSE_FLAG is a real-time, server-authoritative 1v1 deduction game built as a TypeScript monorepo. Each player receives a secret country flag, asks yes-or-no questions in live chat, eliminates candidates on a private board, and tries to land the correct guess before the opponent. The project combines a React/Vite frontend, an Express/Socket.IO backend, and a shared package for event contracts and flag data.

## What ships today

- 2-player rooms with shareable 6-character room codes
- Four board sizes: `easy` (24), `medium` (36), `hard` (48), `007` (full catalog)
- Strict turn loop: ask -> answer -> eliminate -> end turn
- Guess-on-your-turn rule, with immediate loss on wrong guess
- Best-of-5 championship flow with automatic next-round transitions
- World-map-based board with pan/zoom, keyboard-friendly guess picker, chat, haptics/audio cues, and mobile-aware layout
- Render deployment blueprint for separate frontend and backend services

## Match rules

1. One player creates a room and shares the code or invite link.
2. A second player joins. The server assigns both players unique secret flags from the same board.
3. The active player asks one yes-or-no question.
4. The opponent answers.
5. The asker can eliminate flags on their own board, then end the turn.
6. The active player can guess during their turn. A correct guess wins the round; a wrong guess loses the round immediately.
7. First player to 3 round wins takes the match. If the match is still live, the next round auto-starts after a short transition.

## Repo layout

```text
frontend/             React 18 + Vite client
backend/              Express + Socket.IO server
shared/               shared event names, payload types, errors, flag catalog
docs/week0/           architecture freeze, protocol, state model, validation rules
scripts/              deployment smoke check and map-marker generation
references/           visual reference material
render.yaml           Render blueprint for frontend/backend deployment
roadmap.md            milestone plan and remaining hardening work
plan.html             original hand-off / build spec
```

## Architecture

```text
React client <-> Socket.IO <-> Express/Socket.IO server <-> in-memory room state
                   ^
                   |
             shared TypeScript contracts
```

Key design choices:

- The server is the source of truth for room state, turn state, scoring, and round resolution.
- Opponent secrets and private eliminated-board state are never emitted before round-over.
- The shared package keeps event names and payload shapes aligned across frontend and backend.
- The board UI uses generated marker positions over a world SVG rather than a fixed grid.
- Rooms are currently in-memory. A server restart ends active sessions.

Useful implementation entry points:

- [backend/src/server.ts](backend/src/server.ts)
- [backend/src/game-engine.ts](backend/src/game-engine.ts)
- [backend/src/event-validator.ts](backend/src/event-validator.ts)
- [frontend/src/App.tsx](frontend/src/App.tsx)
- [scripts/recalculate-flag-centroids.mjs](scripts/recalculate-flag-centroids.mjs)

The map-marker pipeline reads [frontend/src/world-country-flag-anchors.json](frontend/src/world-country-flag-anchors.json), normalizes playable ISO codes, and writes marker positions into [frontend/src/world-map-marker-positions.ts](frontend/src/world-map-marker-positions.ts). The gameplay board itself renders [frontend/public/world.svg](frontend/public/world.svg).

That same anchor JSON can also carry cached country metadata under each entry's `country_info` object. Run `npm run enrich:country-data` to refresh the checked-in Wikipedia summary and Wikidata facts without doing live lookups at runtime.

## Local development

Prerequisites:

- Node.js 20+ recommended
- npm 10+ recommended

Install dependencies:

```bash
npm install
```

Start the full stack:

```bash
npm run dev
```

Local URLs:

- Frontend: `http://127.0.0.1:5173`
- Backend health: `http://127.0.0.1:3001/health`

LAN testing:

- Both dev servers bind to `0.0.0.0`, so phones and tablets on the same network can open `http://<your-lan-ip>:5173`.
- By default the frontend connects to `http://<current-browser-hostname>:3001`, which makes local network testing work without extra setup in most cases.
- Set `VITE_SOCKET_URL` if you need the client to target a different backend.

## Commands

From the repository root:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start frontend and backend together |
| `npm run typecheck` | Type-check `shared`, `backend`, and `frontend` |
| `npm run build` | Build the whole workspace in dependency order |
| `npm run enrich:country-data` | Fetch Wikipedia/Wikidata country metadata and write it into `frontend/src/world-country-flag-anchors.json` |
| `npm run validate:flag-data` | Verify the generated flag catalog and marker positions still match the anchor JSON |
| `npm run test` | Run backend Vitest suites |
| `npm run test:frontend` | Run frontend Vitest suites |
| `npm run test:e2e` | Run Playwright browser flows |
| `npm run smoke:render` | Check deployed backend and frontend reachability |

Useful package-level commands:

| Command | Purpose |
| --- | --- |
| `npm run dev -w frontend` | Start only the Vite client |
| `npm run dev -w backend` | Start only the backend with `tsx watch` |
| `npm run build:prod -w frontend` | Optimize `public/world.svg` with SVGO, then build the frontend |
| `node scripts/enrich-country-metadata.mjs --codes=AF,CZ,KP,KR,MK,PS,CG,BQ --write` | Refresh a focused subset of country metadata while iterating on resolver overrides |
| `node scripts/recalculate-flag-centroids.mjs --check` | Validate generated outputs against `frontend/src/world-country-flag-anchors.json` |
| `node scripts/recalculate-flag-centroids.mjs --write` | Regenerate `shared/src/flags.ts` and `frontend/src/world-map-marker-positions.ts` from the anchor JSON |

## Configuration

Local development works without extra environment variables. The repository includes [.env.example](.env.example) as a reference for the supported settings.

| Variable | Used by | Default | Notes |
| --- | --- | --- | --- |
| `HOST` | backend | `0.0.0.0` | Backend bind host |
| `PORT` | backend | `3001` | Backend port |
| `CORS_ORIGINS` | backend | empty | Comma-separated browser allowlist; if unset, the backend allows all origins |
| `VITE_SOCKET_URL` | frontend | `http://<current-hostname>:3001` | Override Socket.IO target for deployed or split environments |

## Testing

The repo uses three layers of automated coverage:

- Backend Vitest suites cover the validator, game engine, full socket flows, privacy rules, wrong-guess handling, and round transitions.
- Frontend Vitest covers turn-state gating, score updates, guess modal behavior, and round-over UI sequencing.
- Playwright covers two-browser gameplay, round-over/rematch flow, and mobile portrait behavior.

Test locations:

- `backend/src/*.test.ts`
- `frontend/src/App.test.tsx`
- `frontend/e2e/*.spec.ts`

## Deployment

[render.yaml](render.yaml) defines a two-service Render setup:

- `false-flag-backend`: Node web service with `/health`
- `false-flag-frontend`: static site that serves the Vite build and rewrites SPA routes to `index.html`

Minimal Render setup:

1. Create services from `render.yaml`.
2. Set `VITE_SOCKET_URL=https://<backend-domain>` on the frontend service.
3. Set `CORS_ORIGINS=https://<frontend-domain>` on the backend when you want a production browser allowlist.
4. Deploy and confirm the backend health endpoint returns `{ "ok": true }`.

Optional smoke test after deploy:

```powershell
$env:BACKEND_HEALTH_URL = "https://<backend-domain>/health"
$env:FRONTEND_URL = "https://<frontend-domain>"
npm run smoke:render
```

## Additional docs

- [docs/week0/architecture-freeze.md](docs/week0/architecture-freeze.md)
- [docs/week0/protocol-spec.md](docs/week0/protocol-spec.md)
- [docs/week0/state-model.md](docs/week0/state-model.md)
- [docs/week0/validation-matrix.md](docs/week0/validation-matrix.md)
- [roadmap.md](roadmap.md)
- [plan.html](plan.html)

## Current limitations

These are already reflected in the roadmap and codebase:

- Room state is in-memory only.
- Reconnect and session continuity are not implemented yet.
- Rate limiting and audit logging are planned hardening work rather than shipped features.

## Asset and data credits

- The world map asset in [frontend/public/world.svg](frontend/public/world.svg) is based on the SimpleMaps Free World SVG Map. Source: https://simplemaps.com/resources/svg-world License: https://simplemaps.com/resources/svg-license
- Flag thumbnails are loaded at runtime from Flagcdn by Flagpedia using the country-code catalog in [shared/src/flags.ts](shared/src/flags.ts). Service: https://flagcdn.com/ Project: https://flagpedia.net/ Source vectors: https://commons.wikimedia.org/wiki/Category:SVG_flags_by_country
- Country metadata cached in [frontend/src/world-country-flag-anchors.json](frontend/src/world-country-flag-anchors.json) is adapted from Wikipedia contributors under CC BY-SA 4.0 and modified for gameplay metadata. Source: https://www.wikipedia.org/ License: https://creativecommons.org/licenses/by-sa/4.0/