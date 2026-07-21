# Chalkboard

Chalkboard is a real-time collaborative canvas for shared thinking. It gives a team, classroom, workshop, or study group one room where people can draw, explain ideas, add context, and see one another’s work as it happens.

The product deliberately combines the feel of a physical classroom blackboard with the capabilities of a modern collaborative application: authenticated rooms, live cursors, synchronized strokes, room permissions, saved links, reactions, presence, and an extensible plugin platform.

![Chalkboard demo](demo-video/chalkboard-demo.gif)

## What problem does it solve?

Ideas are often developed across disconnected tools: a video call for conversation, a whiteboard for diagrams, a document for notes, and chat for links. That makes it difficult to keep the discussion, visual thinking, and next steps together.

Chalkboard solves this by providing a shared, persistent room where participants can:

- Draw and annotate the same canvas at the same time.
- Explain ideas with freehand chalk, shapes, links, notes, and built-in thinking tools.
- See who is present and where each person is working.
- Control access with open rooms, approval-based rooms, or password-protected rooms.
- Assign room roles so owners, instructors, and viewers have appropriate capabilities.
- Extend the board with trusted built-in plugins or reviewed community plugins.

## Main features

### Collaborative canvas

- Freehand chalk strokes with color, size, intensity, and chalk-dust styling.
- Eraser, selection, pan, and zoom tools.
- Shapes including lines, arrows, circles, rectangles, polygons, stars, hearts, crosses, and diamonds.
- Select, move, resize, rotate, duplicate, group, ungroup, trim, cut, copy, paste, and delete board content.
- Undo, redo, and clear-board actions synchronized to the room.
- Saved links that connect a label or reference to a location on the canvas.

### Live rooms

- Multiple users can join the same room and see updates in real time.
- Live cursors, display names, colors, presence counts, reactions, and raised hands.
- Room history is loaded when a participant joins or reconnects.
- Reconnection handling includes a short presence grace period to prevent flicker.
- Room owners can update member roles, remove members, and close rooms.
- Rooms can be open, approval-required, or password-protected.
- Rooms have themes such as classroom, workshop, brainstorm, meeting, planning, and studio.

### Authentication and access control

- Sign-in uses Google Identity Services.
- The backend verifies the Google credential and creates an HTTP-only session cookie.
- Room roles are `owner`, `instructor`, and `viewer`.
- Platform roles are `user`, `admin`, and `super_admin`.
- The admin console is protected by a separate TOTP-based two-factor session.

### Built-in and external plugins

The frontend includes a plugin runtime and bundled tools for notes, tags, statistics, and mathematical sets. The mathematical-set tools can insert items such as Venn diagrams, number lines, coordinate grids, and set symbols as normal Chalkboard strokes.

The Developer workspace also supports external plugin packages. A plugin can declare its identity, version, permissions, commands, tools, selection tools, and JavaScript entry bundle. Plugin releases move through a draft, review, approval, and publication lifecycle.

Example packages are available in [`plugin-artifacts/`](plugin-artifacts/), including [`Focus Dot`](plugin-artifacts/focus-dot/README.md) and [`Inscribed Circles`](plugin-artifacts/inscribed-circles/README.md).

## How the application works

```mermaid
flowchart LR
    Browser["React + TypeScript browser"]
    Vite["Vite dev server\n5173"]
    Backend["Node.js backend\nHono + Socket.IO\n3001"]
    Postgres[("PostgreSQL\nusers, rooms, plugins")]
    Redis[("Redis\ncanvas and live room state")]
    LiveKit["LiveKit\nvoice token service"]
    Storage["Local storage or\nCloudflare R2\nplugin assets"]

    Browser --> Vite
    Vite -->|"/api proxy"| Backend
    Vite -->|"/socket.io WebSocket proxy"| Backend
    Backend --> Postgres
    Backend --> Redis
    Backend --> LiveKit
    Backend --> Storage
```

The frontend talks to the backend through same-origin `/api` and `/socket.io` paths. In development, Vite proxies those paths to `http://localhost:3001`. In a production build, the backend can serve the compiled frontend from `frontend/dist` alongside the API and Socket.IO server.

The data responsibilities are intentionally split:

- PostgreSQL stores users, room metadata, room members, join requests, bans, plugin metadata, plugin versions, reviews, installations, and admin 2FA records.
- Redis stores the active room canvas strokes, saved links, Socket.IO adapter data, presence-related room state, raised hands, and BullMQ job data.
- LiveKit is used by the backend to mint scoped voice tokens for voice-enabled rooms.
- Plugin files are stored locally during development by default. Cloudflare R2 is supported for shared or production asset storage.

Because open-room canvas state is held in Redis rather than PostgreSQL, production Redis must be operated with an appropriate persistence and backup strategy.

## Repository structure

```text
chalkboard/
├── backend/                    # Hono API, Socket.IO server, workers, database access
│   ├── src/controllers/        # HTTP request parsing and response shaping
│   ├── src/db/                 # Drizzle schema and PostgreSQL client
│   ├── src/middlewares/        # Authentication, logging, rate limiting, errors
│   ├── src/realtime/           # Socket.IO room and collaboration events
│   ├── src/services/           # Room, auth, plugin, storage, and business logic
│   ├── src/validators/         # Zod request and socket payload validation
│   ├── src/workers/            # BullMQ background worker
│   ├── drizzle/                # Checked-in PostgreSQL migrations
│   ├── .env.example            # Backend environment template
│   └── package.json
├── frontend/                  # React/Vite application
│   ├── src/components/         # Canvas tools, UI controls, and shared components
│   ├── src/pages/              # Home, login, dashboard, lobby, board, and docs pages
│   ├── src/plugins/             # Plugin types, registry, bridge, and built-ins
│   ├── src/stores/              # Zustand application and board state
│   ├── src/hooks/               # Canvas interaction, rendering, sockets, shortcuts
│   └── package.json
├── plugin-artifacts/           # Example uploadable plugin ZIPs and source packages
├── demo-video/                 # Demo GIF, source frames, and demo generation script
├── plugin_implementation.md    # Detailed plugin design and implementation notes
├── package.json                # Root TypeScript development dependency
└── README.md
```

## Technology stack

| Area | Technologies | Responsibility |
| --- | --- | --- |
| Frontend | React, TypeScript, Vite | Application UI and development/build tooling |
| Canvas | HTML5 Canvas, custom TypeScript renderers | Strokes, shapes, selection, transformations, and chalk effects |
| Frontend state | Zustand | Board, authentication, links, and logger state |
| Browser routing | Wouter | Home, login, dashboard, lobby, room, and docs routes |
| Realtime client | Socket.IO Client | Room synchronization, presence, cursors, and collaboration events |
| Backend HTTP | Hono, `@hono/node-server` | REST API and static-file serving |
| Backend realtime | Socket.IO, Redis adapter | Authenticated room sockets and multi-instance fan-out |
| Database | PostgreSQL, Drizzle ORM, Drizzle Kit | Durable application metadata and migrations |
| Cache/realtime state | Redis, BullMQ | Active room state, rate limiting support, Socket.IO adapter, and cleanup jobs |
| Authentication | Google Identity Services, `google-auth-library`, HTTP-only cookies | Sign-in and server-side credential verification |
| Voice integration | LiveKit Server SDK | Scoped voice access tokens |
| Plugin storage | Local filesystem or S3-compatible Cloudflare R2 | Logos, JavaScript bundles, and ZIP archives |
| Validation/logging | Zod, Winston | Runtime input validation and structured server logs |

## Dependency inventory

The following are the direct packages declared in the repository’s `package.json` files. Their transitive dependencies are pinned by the committed `package-lock.json` files. Use `npm ci` rather than manually installing individual packages.

### Root package

| Package | Type | Purpose |
| --- | --- | --- |
| `typescript` | Development | Repository-level TypeScript tooling. |

### Frontend runtime dependencies

| Package | Purpose |
| --- | --- |
| `lucide-react` | UI icons. |
| `react` | React component runtime. |
| `react-dom` | React DOM renderer. |
| `socket.io-client` | Browser realtime connection to the backend. |
| `wouter` | Lightweight client-side routing. |
| `zustand` | Global application and board state. |

### Frontend development dependencies

| Package | Purpose |
| --- | --- |
| `@eslint/js` | ESLint base configuration. |
| `@types/node` | Node.js type declarations used by the Vite configuration. |
| `@types/react` | React type declarations. |
| `@types/react-dom` | React DOM type declarations. |
| `@vitejs/plugin-react` | React support for Vite. |
| `eslint` | Frontend linting. |
| `eslint-plugin-react-hooks` | React Hooks lint rules. |
| `eslint-plugin-react-refresh` | React Fast Refresh lint rules. |
| `globals` | Standard global variable definitions for ESLint. |
| `typescript` | Frontend type checking and compilation. |
| `typescript-eslint` | TypeScript-aware ESLint support. |
| `vite` | Frontend development server and production bundler. |

### Backend runtime dependencies

| Package | Purpose |
| --- | --- |
| `@aws-sdk/client-s3` | S3-compatible object storage operations for Cloudflare R2. |
| `@aws-sdk/s3-request-presigner` | Signed R2 asset URLs. |
| `@hono/node-server` | Runs Hono on Node’s HTTP server. |
| `@socket.io/redis-adapter` | Socket.IO fan-out through Redis. |
| `bcryptjs` | Password hashing support. |
| `bullmq` | Background jobs and room cleanup scheduling. |
| `drizzle-orm` | Typed PostgreSQL queries and schema access. |
| `google-auth-library` | Verification of Google Identity Services credentials. |
| `hono` | HTTP API framework and middleware. |
| `livekit-server-sdk` | LiveKit access-token generation. |
| `postgres` | PostgreSQL driver used by Drizzle. |
| `redis` | Redis client for room state and coordination. |
| `socket.io` | Authenticated realtime room server. |
| `winston` | Structured server logging. |
| `zod` | Runtime validation for environment, HTTP, and Socket.IO payloads. |

### Backend development dependencies

| Package | Purpose |
| --- | --- |
| `@types/node` | Node.js type declarations. |
| `drizzle-kit` | PostgreSQL migration generation and application. |
| `nodemon` | Development dependency retained for backend workflows. |
| `tsup` | Backend TypeScript bundling. |
| `tsx` | Running TypeScript directly in development and tests. |
| `typescript` | Backend type checking. |

## Requirements

Install or provision the following before running the full application locally:

1. **Node.js 20.6 or newer.** The backend scripts use Node’s built-in `--env-file` option. Node 22 or newer is recommended.
2. **npm.** Each application has its own lockfile, so use `npm ci` inside `backend/` and `frontend/`.
3. **PostgreSQL.** Required for users, rooms, memberships, plugins, and admin records.
4. **Redis.** Required for active canvas state, room presence, Socket.IO coordination, rate-limited events, and background jobs.
5. **A Google OAuth web client ID.** Required for Google sign-in.
6. **A LiveKit project or server.** The backend validates the LiveKit variables at startup. Real LiveKit credentials are required if voice access is used.
7. **A modern browser** with JavaScript and HTML5 Canvas support.

Cloudflare R2 is optional. Keep plugin storage local while developing unless several backend instances need to share uploaded plugin assets.

### Starting PostgreSQL and Redis with Docker

If PostgreSQL and Redis are not already installed, Docker is a convenient local option:

```bash
docker run --name chalkboard-postgres \
  --env POSTGRES_DB=chalkboard \
  --env POSTGRES_USER=chalkboard \
  --env POSTGRES_PASSWORD=chalkboard \
  --publish 5432:5432 \
  --detach postgres:16

docker run --name chalkboard-redis \
  --publish 6379:6379 \
  --detach redis:7
```

If the containers already exist, start them with `docker start chalkboard-postgres chalkboard-redis` instead of creating them again. You can use hosted PostgreSQL and Redis as long as their connection URLs are reachable from the backend.

## Local development setup

### 1. Clone the repository

```bash
git clone <repository-url>
cd chalkboard
```

The repository does not define a root development server. The runnable applications are in `backend/` and `frontend/`.

### 2. Install frontend and backend dependencies

Run these commands from the repository root:

```bash
cd backend
npm ci

cd ../frontend
npm ci

cd ..
```

The root `package.json` only contains the repository-level TypeScript development dependency. Installing the two application lockfiles is what installs the dependencies needed to run Chalkboard.

### 3. Create the backend environment file

PowerShell:

```powershell
Copy-Item backend/.env.example backend/.env
```

macOS/Linux:

```bash
cp backend/.env.example backend/.env
```

Open `backend/.env` and replace the placeholder values. The complete variable reference is below.

### 4. Apply database migrations

Make sure PostgreSQL is running and `DATABASE_URL` points to the correct database, then run:

```bash
cd backend
npm run db:migrate
```

This applies the checked-in SQL migrations in `backend/drizzle/`. Run migrations after every checkout that contains new migration files and before using rooms, the Developer workspace, or the admin console.

### 5. Start the backend

Open a terminal in `backend/`:

```bash
npm run dev
```

The development backend listens on `http://localhost:3001` by default. It runs `src/index.ts` with Node watch mode and loads `backend/.env` automatically.

### 6. Start the frontend

Open a second terminal in `frontend/`:

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite listens on `0.0.0.0`, so it also prints a LAN URL for testing from another device on the same network.

The Vite development server proxies:

- `/api` to `http://localhost:3001`.
- `/socket.io` to `http://localhost:3001`, including WebSocket upgrades.

Keep both terminals running while developing. The frontend alone is not enough for authentication, rooms, database access, or realtime collaboration.

## Environment variables

The backend validates its environment at startup with Zod. A missing required value or an invalid value stops the process before it accepts requests.

### Core server and database variables

| Variable | Required | Default/example | Description |
| --- | --- | --- | --- |
| `PROCESS_TYPE` | No | `server` | Selects the process: `server` for HTTP/Socket.IO or `worker` for the BullMQ cleanup worker. |
| `NODE_ENV` | No | `development` | Runtime mode. Production disables development-only private-LAN CORS allowances. |
| `HOST` | No | `0.0.0.0` | Network interface used by the backend. |
| `PORT` | No | `3001` | Backend HTTP and Socket.IO port. |
| `PG_POOL_SIZE` | No | `5` in code, `10` in the example | Maximum PostgreSQL connection pool size. |
| `CORS_ORIGIN` | Yes in practice | `http://localhost:5173` | Comma-separated browser origins allowed by the backend. Include every deployed frontend origin in production. |
| `FRONTEND_DIST_DIR` | No | Empty | Optional path to the built frontend. By default the backend resolves `frontend/dist` from the compiled backend location. |
| `DATABASE_URL` | Yes | `postgres://user:password@localhost:5432/chalkboard` | PostgreSQL connection URL used by Drizzle and the readiness check. |
| `REDIS_URL` | Yes | `redis://localhost:6379` | Redis connection URL used for room state, Socket.IO, and BullMQ. |
| `GOOGLE_CLIENT_ID` | Yes | Google web client ID | Client ID used to verify Google Identity Services credentials. |
| `SUPER_ADMIN_EMAIL` | No | Empty | If set, the matching Google account receives the initial `super_admin` platform role after sign-in. |
| `AUTH_SESSION_SECRET` | Yes | Replace it | Secret used to sign sessions and protect admin 2FA data. It must contain at least 32 characters. |

### LiveKit variables

| Variable | Required | Description |
| --- | --- | --- |
| `LIVEKIT_URL` | Yes | LiveKit WebSocket URL, usually beginning with `wss://`. |
| `LIVEKIT_API_KEY` | Yes | LiveKit API key used when minting access tokens. |
| `LIVEKIT_API_SECRET` | Yes | LiveKit API secret. Keep it server-side and never expose it to the frontend. |

The current backend schema requires all three values even when a room has voice disabled. Use real credentials for a complete setup. Non-empty placeholders can satisfy startup validation for a UI-only smoke test, but voice token requests will not work with placeholders.

### Plugin storage variables

| Variable | Required | Default/example | Description |
| --- | --- | --- | --- |
| `PLUGIN_STORAGE_MODE` | No | `local` | Choose `local` or `r2`. |
| `PLUGIN_STORAGE_DIR` | No | `.data/plugin-storage` | Local directory for plugin logos, bundles, and archives. The directory is created as needed. |
| `R2_ENDPOINT` | Only for `r2` | Cloudflare endpoint | S3-compatible Cloudflare R2 endpoint. |
| `R2_BUCKET_NAME` | Only for `r2` | Bucket name | R2 bucket that stores plugin assets. |
| `R2_ACCESS_KEY_ID` | Only for `r2` | Access key | R2 S3 access key. |
| `R2_SECRET_ACCESS_KEY` | Only for `r2` | Secret key | R2 S3 secret. |
| `R2_SIGNED_URL_TTL_SECONDS` | No | `300` | Lifetime of signed R2 asset URLs. |

When `PLUGIN_STORAGE_MODE=local`, PostgreSQL stores plugin metadata and local files are written under `backend/.data/plugin-storage`. That directory is ignored by Git.

### Presence, rate limiting, and lifecycle variables

All time values are milliseconds unless the name or description says otherwise.

| Variable | Default | Description |
| --- | ---: | --- |
| `PRESENCE_GRACE_MS` | `15000` | Delay before a disconnected user is removed from room presence, allowing transient reconnects. |
| `INVITE_JOIN_RATE_LIMIT_MAX` | `20` | Maximum invite/join attempts per rate-limit window. |
| `INVITE_JOIN_RATE_LIMIT_WINDOW_MS` | `60000` | Invite/join rate-limit window. |
| `REACTION_RATE_LIMIT_MAX` | `10` | Maximum reaction events per user per window. |
| `REACTION_RATE_LIMIT_WINDOW_MS` | `10000` | Reaction rate-limit window. |
| `HAND_RATE_LIMIT_MAX` | `6` | Maximum raised-hand toggles per user per window. |
| `HAND_RATE_LIMIT_WINDOW_MS` | `10000` | Raised-hand rate-limit window. |
| `ROOM_INACTIVITY_MS` | `86400000` | How long an open room may have no join or canvas update before cleanup closes it; the default is 24 hours. |
| `ROOM_CLEANUP_REPEAT_MS` | `3600000` | How often the worker scans for inactive rooms; the default is one hour. |
| `LOG_LEVEL` | `debug` in development, `info` in production | Optional Winston log level. This variable is read by the logger and is not part of the Zod environment object. |

### Google sign-in configuration

1. Create a Google OAuth 2.0 **Web application** client in Google Cloud.
2. Add `http://localhost:5173` to the client’s authorized JavaScript origins for local development.
3. Set the resulting client ID as `GOOGLE_CLIENT_ID` in `backend/.env`.
4. Restart the backend after changing the environment file.
5. Visit [http://localhost:5173/login](http://localhost:5173/login) and choose **Continue with Google**.

The frontend reads the client ID from `/api/auth/google/config` unless `VITE_CLIENT_ID` is supplied as a frontend build variable. The normal local setup only needs the backend `GOOGLE_CLIENT_ID`.

### Frontend environment variable

| Variable | Required | Description |
| --- | --- | --- |
| `VITE_CLIENT_ID` | No | Optional Vite build-time override for the Google web client ID. Leave it unset when the frontend should read the value from the backend configuration endpoint. |

For the first administrator, set `SUPER_ADMIN_EMAIL` to the email address of the Google account that should administer plugins. That account must sign in once, then complete the TOTP setup at `/admin` before admin actions are enabled. Store the generated recovery codes safely.

## Using Chalkboard

### Create or join a room

1. Sign in with Google.
2. Open the Dashboard and select the Rooms area.
3. Create a room with a title, description, theme, access mode, and default member role.
4. Copy the generated room link or room code. Password-protected rooms also generate a password that must be shared with invitees.
5. Other signed-in users can open the invite link, enter the room code in the Lobby, and provide the password when required.

The room URL has the form `/room/<room-code>`. Room metadata can be viewed from the room details menu. Owners and instructors can manage participants according to their role; viewers can observe without editing.

### Work on the canvas

- Choose chalk to draw freehand strokes.
- Choose a color, size, and intensity from the toolbar.
- Choose eraser to remove strokes or select content.
- Use select to move, resize, rotate, group, duplicate, trim, copy, cut, or delete content.
- Use pan or hold the space bar to move around the infinite canvas.
- Use the mouse wheel or keyboard controls to zoom.
- Open Insert to add shapes, links, notes, and plugin tools.
- Use undo, redo, and clear from the action controls.
- Use reactions and raised hands for lightweight classroom or meeting feedback.

Every supported board mutation is sent through the shared board state and Socket.IO synchronization path, so collaborators receive the same result instead of maintaining isolated local copies.

### Keyboard shortcuts

The exact shortcut handling lives in [`frontend/src/hooks/useKeyboardShortcuts.ts`](frontend/src/hooks/useKeyboardShortcuts.ts). The board supports keyboard actions for undo/redo, copy/cut/paste, duplicate, grouping, delete, size changes, rotation, arrow-key nudging, pan, zoom, and trim operations. The in-app tooltips and controls are the source of truth for the current key bindings.

## Plugin workflow

### Built-in plugins

Built-in plugins live under `frontend/src/plugins/builtin/` and are bundled into the frontend. The current built-ins include:

- Notes for editable text content.
- Tags for annotating selected content.
- Statistics tools.
- Mathematical Set tools for Venn diagrams, number lines, coordinate grids, and set symbols.

Built-in plugins insert normal Chalkboard strokes or use the host’s supported board APIs, which means the generated content can participate in selection, editing, erasing, undo/redo, and collaboration.

### Community plugin lifecycle

1. Enable the Developer workspace from the Dashboard if it is hidden.
2. Open `/dashboard?tab=developer` and choose **New plugin**.
3. Supply a stable plugin ID, name, description, access plan, version, manifest, and JavaScript bundle or ZIP package.
4. Use a ZIP containing `manifest.json` and `index.js` or `index.mjs` when possible. A logo is optional.
5. Create the draft, add immutable versions as the plugin evolves, and submit a version for review.
6. An administrator opens `/admin`, completes 2FA, runs the plugin smoke test, reviews the manifest and bundle, and approves or rejects the submission.
7. An approved version can be published to the catalogue. Published plugins can be loaded by the frontend runtime.

Plugin bundles communicate with the host through the `postMessage` bridge. They do not receive direct access to the board store, session cookies, or Socket.IO internals. Declare only the permissions that the plugin needs, validate all incoming messages, and never place secrets in a plugin bundle.

The public in-app guide at `/docs` explains the manifest, permissions, commands, tools, selection tools, bridge messages, package limits, and review expectations. The longer implementation plan is in [`plugin_implementation.md`](plugin_implementation.md).

## Backend API and realtime surface

The backend exposes the following route groups:

| Path | Purpose |
| --- | --- |
| `GET /health` | Liveness response from the backend process. |
| `GET /ready` | Readiness check for PostgreSQL and Redis. Returns HTTP 503 while either dependency is unavailable. |
| `GET /api/health` | API liveness response. |
| `/api/auth/*` | Google sign-in, current-user hydration, configuration, and logout. |
| `/api/rooms/*` | Room creation, listing, joining, member management, join approvals, passwords, deletion, and voice token issuance. |
| `/api/plugins/*` | Authenticated plugin drafts, versions, submissions, and published catalogue data. |
| `/api/admin/*` | Admin 2FA, administrator management, plugin review, publication, and registry controls. |
| `/socket.io` | Authenticated realtime room connection for strokes, cursors, presence, links, reactions, hands, roles, and room lifecycle events. |

Important Socket.IO events include `join-room`, `room-history`, `room:sync`, `stroke-start`, `stroke-draw`, `draw-stroke`, `undo-stroke`, `clear-board`, `cursor-move`, `links-update`, `presence:count`, `reaction:send`, `hand:raise`, `member:kick`, `member:update-role`, `room:close`, and `plugin:event`.

Socket connections and room-changing events require the authenticated session cookie. The server validates event payloads and checks the sender’s room membership and role before relaying or persisting an action.

## Development scripts

### Backend scripts

Run these from `backend/`:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the server or worker from TypeScript with watch mode and `.env` loading. |
| `npm run build` | Bundle the backend into `dist/index.js` with tsup. |
| `npm run start` | Start the compiled backend from `dist/index.js`. |
| `npm run check` | Run TypeScript checking without emitting files. |
| `npm run test` | Run Node’s test runner against `backend/test/**/*.test.ts`. |
| `npm run verify` | Run type checking and the production bundle build. This does not require live PostgreSQL, Redis, or LiveKit connections. |
| `npm run db:generate` | Generate a new Drizzle migration from schema changes. |
| `npm run db:migrate` | Apply pending Drizzle migrations to `DATABASE_URL`. |

To run the cleanup worker in a separate terminal, use:

PowerShell:

```powershell
$env:PROCESS_TYPE = "worker"
npm run dev
```

macOS/Linux:

```bash
PROCESS_TYPE=worker npm run dev
```

The worker uses Redis and PostgreSQL, schedules `room-inactivity-cleanup`, closes stale rooms, and removes their Redis state. Run one worker process in addition to the HTTP server in environments where automatic room cleanup is required.

### Frontend scripts

Run these from `frontend/`:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server on port `5173`. |
| `npm run build` | Type-check the application and build the app and admin entry points. |
| `npm run lint` | Run ESLint across the frontend. |
| `npm run preview` | Serve the built frontend locally for a production-like preview. |

## Production build and run

The backend can serve the compiled frontend, so build the frontend before starting the compiled backend:

```bash
cd frontend
npm run build

cd ../backend
npm run verify
npm run start
```

The compiled server serves the frontend from `frontend/dist` when that directory exists. It also serves:

- `http://localhost:3001/` for the single-page frontend.
- `http://localhost:3001/admin` for the admin entry point.
- `http://localhost:3001/api/*` for API requests.
- `http://localhost:3001/socket.io` for realtime connections.

For a production deployment:

- Set `NODE_ENV=production`.
- Set `CORS_ORIGIN` to the exact frontend origin or origins.
- Use a strong `AUTH_SESSION_SECRET` and keep all provider secrets on the server.
- Run database migrations before accepting traffic.
- Run the HTTP server and the `PROCESS_TYPE=worker` process separately.
- Use persistent PostgreSQL and Redis services.
- Use R2 or another shared object-storage-compatible setup when more than one backend instance handles plugin uploads.
- Put TLS and a reverse proxy in front of the application when exposing it publicly.

If the frontend is built somewhere else, set `FRONTEND_DIST_DIR` to the directory containing the compiled `index.html`. The default path is suitable for the repository layout shown above.

## Verification checklist

After setup, verify the system in this order:

1. `GET http://localhost:3001/health` returns `{ "ok": true }`.
2. `GET http://localhost:3001/ready` returns HTTP 200 and reports both `database` and `redis` as `up`.
3. `http://localhost:5173/login` renders the Google sign-in button.
4. After sign-in, the Dashboard loads and can create a room.
5. A second browser session can join the same room and see a test stroke and cursor.
6. `npm run check`, `npm run test`, and `npm run verify` pass in `backend/`.
7. `npm run lint` and `npm run build` pass in `frontend/`.

## Troubleshooting

### The backend exits with an environment validation error

Check `backend/.env` for every required value. `DATABASE_URL`, `REDIS_URL`, `GOOGLE_CLIENT_ID`, all three `LIVEKIT_*` variables, and a 32-character-or-longer `AUTH_SESSION_SECRET` are required by the current schema. Restart the backend after editing the file.

### `/ready` returns HTTP 503

The backend is alive but PostgreSQL or Redis is unavailable. Confirm that the service is running, check the connection URLs, and verify that local firewalls or hosted-service IP allowlists permit the connection. `/health` intentionally does not contact external services, while `/ready` does.

### The Google button does not appear

Confirm that:

- `GOOGLE_CLIENT_ID` is set in `backend/.env`.
- The Google Identity Services script can load in the browser.
- `http://localhost:5173` is listed as an authorized JavaScript origin in Google Cloud.
- The backend is running so `/api/auth/google/config` can respond.

### The frontend loads but realtime updates do not work

Make sure the backend is listening on port `3001`, the frontend was started with Vite, and the browser is using the Vite URL rather than opening `frontend/index.html` directly. Check the browser console and backend logs for Socket.IO authentication or CORS errors.

### Admin actions are unavailable

Apply migrations, sign in with the account configured by `SUPER_ADMIN_EMAIL`, open `/admin`, complete TOTP setup, and use the generated recovery codes if necessary. Admin routes require both the platform role and a verified admin 2FA session.

### Plugin uploads fail

For local storage, confirm that `PLUGIN_STORAGE_MODE=local` and that the backend process can write to `backend/.data/plugin-storage`. For R2, confirm all four R2 connection variables, the bucket, endpoint, credentials, and bucket permissions. ZIP packages must contain `manifest.json` and `index.js` or `index.mjs`, and the Developer workspace enforces package and bundle size limits.

### A port is already in use

Change `PORT` for the backend and update the Vite proxy in `frontend/vite.config.ts`, or stop the process already using port `3001` or `5173`. The default development setup expects those two ports.

## Security and operational notes

- Never commit `backend/.env`, Google credentials, LiveKit secrets, R2 secrets, session secrets, or generated recovery codes.
- Configure production CORS explicitly; do not rely on development private-LAN allowances.
- Keep Redis persistence and backups aligned with the fact that active canvas state and links are stored there.
- The backend applies payload validation, role checks, session authentication, rate limiting, and graceful shutdown handling.
- Plugin bundles are untrusted input from a security perspective. Use the review sandbox, least-privilege permissions, and the host bridge. Do not put credentials or private room data in plugin code.
- Room cleanup closes rooms after inactivity by default. Increase `ROOM_INACTIVITY_MS` if the product needs rooms to remain open longer.

## Additional documentation

- [`backend/README.md`](backend/README.md) — backend architecture, environment notes, and operational hardening.
- [`frontend/README.md`](frontend/README.md) — frontend architecture and board-state design.
- [`plugin_implementation.md`](plugin_implementation.md) — plugin architecture and implementation history.
- [`frontend/src/pages/Docs.tsx`](frontend/src/pages/Docs.tsx) — source for the in-app plugin documentation at `/docs`.

## License

No license file is currently included in this repository. Treat the project as all rights reserved unless the project owner adds a license or gives separate permission to use, modify, or redistribute it.
