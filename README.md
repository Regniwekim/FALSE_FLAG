# FALSE_FLAG Monorepo

Week 1 foundation for the FALSE_FLAG real-time multiplayer project.

## Workspace Layout
- frontend: React + TypeScript + Vite client
- backend: Node + Express + Socket.io server
- shared: Common types, event names, and validation error codes

## Quick Start
1. Install dependencies:
   npm install
2. Start frontend and backend:
   npm run dev

## Local Network Testing (Mobile Devices)
1. Start dev servers from this machine:
   npm run dev
2. Find this machine's LAN IP (example: `192.168.1.42`).
3. Open the frontend on your phone:
   http://<YOUR_LAN_IP>:5173

Notes:
- Frontend dev server is configured to bind on `0.0.0.0:5173`.
- Backend binds on `0.0.0.0:3001`.
- Socket URL defaults to `http://<current-browser-hostname>:3001`.
- Optional override: set `VITE_SOCKET_URL` if your backend runs on a different host/port.

## Current Scope
- Room create and join flow skeleton
- Server-authoritative round state shell
- Shared event contract baseline

