# Chalkboard backend

Hono serves REST routes from `/api` and Socket.IO attaches to the same raw HTTP server created by `@hono/node-server`. The backend source is TypeScript, bundled with tsup, and imports app modules through the `@/*` path alias configured in `tsconfig.json`.

## Architectural decisions landed

- `owner`, `instructor`, and `viewer` are separate persisted `room_role` values. Owner is still instructor-tier for authorization.
- LiveKit is the voice SFU. The backend only mints scoped tokens: owners/instructors may publish; viewers subscribe by default.
- Existing canvas socket events are preserved: `join-room`, `room-history`, `update-users`, `stroke-start`, `stroke-draw`, `undo-stroke`, `clear-board`, `cursor-move`, `links-update`, and `user-disconnected`.
- New classroom events are namespaced to avoid collisions: `reaction:send`, `reaction:received`, `hand:raise`, `raised-hands:update`, `presence:count`, `member:kick`, and `member:kicked`.
- Reactions, raised hands, cursors, and in-process canvas history are ephemeral. Raised hands use Redis when `REDIS_URL` is configured; Postgres is reserved for users, rooms, roles, join requests, bans, settings, and debounced snapshots.

## Code organization

- `src/routers/` contains Hono route wiring only.
- `src/controllers/` handles HTTP request parsing and response shaping.
- `src/services/` owns business logic shared by REST and Socket.IO.
- `src/middlewares/` contains auth, request logging, and central error handling.
- `src/validators/` contains Zod request schemas.
- `src/utils/` contains shared helpers such as the Winston logger.

## Environment

- `PROCESS_TYPE` selects `server` (default) or `worker` for the same deployable image
- `PORT` defaults to `3001`
- `CORS_ORIGIN` comma-separated frontend origins
- `DATABASE_URL` is required for Drizzle/Postgres persistence and is validated at boot
- `REDIS_URL` is required for Redis ephemeral state, BullMQ jobs, and the Socket.IO Redis adapter
- `GOOGLE_CLIENT_ID` is required for Google Sign-In verification
- `AUTH_SESSION_SECRET` signs the HTTP-only same-origin session cookie created after Google Sign-In
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` are required for voice token issuance

The frontend uses the same-origin `/api` and `/socket.io` paths. In production, build
`frontend` first so the server can serve `frontend/dist` alongside the API. During local
development, Vite proxies those same paths to the backend on port `3001`.

Authentication is handled by `POST /api/auth/google`, which accepts a Google Identity
Services credential and sets an HTTP-only session cookie. `GET /api/auth/me` hydrates the
signed-in profile, `POST /api/auth/logout` clears it, and room/API/Socket.IO access requires
that session.

## Scripts

- `npm run dev` starts `src/index.ts` as `PROCESS_TYPE=server` through `tsx` watch mode.
- `npm run dev:worker` starts `src/index.ts` as `PROCESS_TYPE=worker` for BullMQ jobs.
- `npm run build` bundles `src/index.ts` to `dist/index.js` with tsup.
- `npm run check` runs TypeScript type checking.
- `npm run db:generate` and `npm run db:migrate` use Drizzle Kit.

## Operational hardening

- `/health` and `/api/health` both return `{ "ok": true }` for uptime checks.
- `PROCESS_TYPE=worker` starts a BullMQ worker in the same repo/image and schedules `room-snapshot-cleanup`.
- Socket disconnects use a short presence grace period (`PRESENCE_GRACE_MS`) before emitting leave/count updates, reducing flicker on transient reconnects.
- Invite/room join HTTP routes and high-fanout socket events (`reaction:send`, `hand:raise`) are rate limited with environment-tunable windows.
- Server shutdown handles `SIGTERM`/`SIGINT`, closes Socket.IO, closes HTTP, and then quits Redis.
