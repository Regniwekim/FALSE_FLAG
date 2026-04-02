# FALSE_FLAG

Server-authoritative, real-time 1v1 deduction game inspired by Guess Who, built as a TypeScript monorepo.

Players create or join a room, ask yes/no questions, eliminate candidates on their own board, and make guesses. Matches run as a best-of-5 championship with automatic next-round transitions.

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

## Next Phase
Week 4 hardening:
- Rate limits.
- Reconnect/session continuity.
- Input sanitization and audit logging.
- Reliability and production readiness work.

