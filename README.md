# FALSE_FLAG

Server-authoritative, real-time 1v1 deduction game inspired by Guess Who, built as a TypeScript monorepo.

Players create or join a room, ask yes-or-no questions, eliminate candidates on their own board, and make guesses. Matches run as a best-of-5 championship with automatic next-round transitions.

## Terminology
- Room: The pre-game session players create or join.
- Match: A best-of-5 series.
- Round: A single game within a match.

## Current Status
- Week 3 complete and sign-off ready.
- Championship loop implemented end-to-end.
- UI is fully themed (vaporwave/retro), mobile-aware, and LAN-testable.

## Monorepo Structure
- frontend: React + TypeScript + Vite client.
- backend: Node + Express + Socket.io real-time server.
- shared: Shared types, event names, and validation contracts used by both frontend and backend.

## Implemented Gameplay Features
- 2-player room lifecycle: create-room and join-room.
- Full ask/answer/eliminate/end-turn/guess loop.
- Server-side action validation for actor and state correctness.
- Wrong-guess immediate loss behavior.
- Match score tracking across rounds (best of 5).
- Auto next-round initialization with short transition delay.
- Match-over result card with Rematch and New Room.

## Week 3 UI/UX Highlights
- Interactive world map board with pan/zoom and fixed-size country tags.
- Guess modal with icon-enhanced custom picker (flag image + country code).
- Native-like keyboard picker behavior (arrow keys, Home/End, Enter/Space, typeahead).
- Modal accessibility improvements (focus trap, Escape close, outside-click close).
- Transition banner between rounds: NEXT ROUND INITIALIZING...
- Mobile portrait layout refinements and LAN/mobile testing support.

## Prerequisites
- Node.js 20+ recommended.
- npm 10+ recommended.

## Quick Start
1. Install dependencies:
   npm install
2. Start frontend and backend in one command:
   npm run dev

Default local URLs:
- Frontend: http://127.0.0.1:5173
- Backend health: http://127.0.0.1:3001/health

## Scripts
From repository root:

- Start both services:
  npm run dev
- Typecheck all packages:
  npm run typecheck
- Build all packages:
  npm run build
- Run backend tests:
  npm run test
- Run frontend unit tests:
  npm run test:frontend
- Run Playwright E2E tests:
  npm run test:e2e

## Local Network Testing (Phones/Tablets)
1. Start services:
   npm run dev
2. Find your machine LAN IP (example: 192.168.1.42).
3. Open on device browser:
   http://<YOUR_LAN_IP>:5173

Notes:
- Frontend binds to 0.0.0.0:5173.
- Backend binds to 0.0.0.0:3001.
- Client socket target defaults to current browser hostname on port 3001.
- Optional override for backend URL:
  set VITE_SOCKET_URL=http://<HOST>:<PORT>

## Quality Gates (Current)
- Backend tests: 22/22 passing.
- Frontend unit tests: 10/10 passing.
- E2E tests: 3/3 passing.
- Workspace typecheck and build: passing.

## Security/Architecture Notes
- Server is the source of truth for room and round state.
- Clients are gated from invalid actions based on turn/state.
- Opponent secret is not exposed before round-over.

## Deploying to Render
This repo is configured for a two-service Render deployment:
- Backend: Render Web Service (Node + Express + Socket.io)
- Frontend: Render Static Site (Vite build output)

### Why this topology
- Frontend is served over Render's CDN as static assets.
- Backend can scale independently for real-time Socket.io traffic.
- Clear separation keeps runtime and troubleshooting simpler.

### Render Blueprint
- Infrastructure-as-code is defined in `render.yaml` at repo root.
- Sync this Blueprint from the Render dashboard to create/update both services.
- Blueprint defaults include:
  - Explicit service plans (`starter` backend, `free` static frontend).
  - Build filters that ignore docs/reference-only changes to reduce unnecessary deploys.
  - Static-site security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`).

### Required environment variables
Set these in Render before the first production deploy:

- Backend service
  - `NODE_ENV=production`
  - `HOST=0.0.0.0`
  - `CORS_ORIGINS=https://<your-frontend-domain>`
    - Use comma-separated values for multiple origins.
    - Optional: set `*` to allow all origins (not recommended for production).

- Frontend service
  - `VITE_SOCKET_URL=https://<your-backend-domain>`

For local development, use `.env.example` as a template.

### Render deployment checklist
1. Push latest code to `main`.
2. In Render, create a new Blueprint instance from this repository.
3. Confirm both services are created from `render.yaml`.
4. Set required environment variables for each service.
5. Trigger deploy and confirm:
   - Backend health check passes at `/health`.
   - Frontend loads and can connect to backend socket endpoint.
6. Validate deep links (refresh on non-root route) to confirm SPA rewrite is active.
7. Optional: open a pull request and manually generate service previews (Blueprint defaults previews to manual).

### Fast launch path (friends-ready)
Use this when your goal is to play quickly, not run full production operations.

1. Deploy with Blueprint as-is.
2. Set only one required variable on frontend service:
  - `VITE_SOCKET_URL=https://<your-backend-service>.onrender.com`
3. Do not set `CORS_ORIGINS` yet.
  - Backend allows all origins if this variable is missing, which is fine for casual testing with friends.
4. Wait for both services to show healthy/active.
5. Share frontend URL and play.

Practical notes for friend sessions:
1. Free plans can sleep after inactivity, so first load may take a short warm-up.
2. If socket connection fails, verify frontend `VITE_SOCKET_URL` exactly matches backend HTTPS URL.
3. Keep only one active backend/frontend pair while testing to avoid sharing the wrong URL.

### Staged rollout (recommended)
1. Deploy backend first and wait for healthy status.
2. Run smoke check against backend:
  - PowerShell: `$env:BACKEND_HEALTH_URL='https://<backend-domain>/health'; npm run smoke:render`
3. Deploy frontend and validate live app path.
4. Run full smoke check:
  - PowerShell: `$env:BACKEND_HEALTH_URL='https://<backend-domain>/health'; $env:FRONTEND_URL='https://<frontend-domain>'; npm run smoke:render`
5. Run a live two-player gameplay check (create/join room, one round, rematch/new game).

### Rollback playbook
1. In Render dashboard, open the failing service and select Rollback to previous healthy deploy.
2. Re-run smoke checks immediately after rollback.
3. If backend was rolled back, verify frontend still points to compatible backend endpoint.
4. If frontend was rolled back, verify socket connectivity and room flow from two clients.
5. Capture the failing deploy logs and events before reattempting.

### Post-deploy smoke test
- Open frontend URL and create a room.
- Join from a second browser/device.
- Verify ask/answer/end-turn/guess loop.
- Verify rematch/new-game and round transitions.

You can also run an automated reachability check from your terminal:

1. Backend only:
  - `npm run smoke:render`
2. Backend + frontend:
  - PowerShell: `$env:BACKEND_HEALTH_URL='https://<backend-domain>/health'; $env:FRONTEND_URL='https://<frontend-domain>'; npm run smoke:render`

The smoke script validates more than status codes:
- Backend must return JSON with `{ "ok": true }` from the health endpoint.
- Frontend must return an HTML document response.

### Troubleshooting on Render
- Build fails early:
  - Ensure npm dependencies install successfully and workspace builds pass locally with `npm run build`.
- Backend unhealthy:
  - Confirm service is binding to `HOST=0.0.0.0` and `PORT` from environment.
  - Confirm `/health` returns 2xx quickly.
- Frontend cannot connect to socket:
  - Confirm `VITE_SOCKET_URL` points to backend public HTTPS URL.
  - Confirm backend `CORS_ORIGINS` includes frontend exact origin.
- WebSocket disconnects during deploy:
  - Expected during instance replacement; backend now performs graceful SIGTERM shutdown.

## Next Phase
Week 4 hardening:
- Rate limits.
- Reconnect/session continuity.
- Input sanitization and audit logging.
- Reliability and production readiness work.

