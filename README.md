# Collaborative Chalkboard

**Chalkboard** is a web-based, real-time collaborative workspace designed to replicate the classic, nostalgic aesthetic of a school classroom blackboard. Multiple users can join distinct rooms, collaborate in real time using chalk (with realistic dust textures, colors, and brush sizes), pan and zoom around the canvas, and see other participants' cursors move live.

## Features

- **Realistic Classroom Aesthetic**: Green slate blackboard surface with chalkboard dust particles, vintage wood and brass trims, and cursive chalkboard-style handwriting fonts.
- **Collaborative Drawing**: Draw with various chalk colors (white and pastels) and widths.
- **Realistic Chalk Physics**: Chalk strokes leave behind simulated chalk dust particles along their path, capturing the authentic texture of chalk on slate.
- **Real-Time Synchronization**: Instantly sync drawing actions (draw, erase, undo, redo, and clear) to all users in the same room via WebSockets.
- **Presence Tracking**: See cursors and names of other active room members.
- **Room Isolation**: Join existing rooms via a code or share a generated room-link to invite others.
- **Canvas Navigation**: Pan and zoom across the infinite canvas, making it easy to create spacious diagrams.

---

## Project Structure

The project is structured as a monorepo containing a separate frontend and backend:

```
chalkboard/
├── backend/            # Express & Socket.io server
└── frontend/           # Vite + React + TypeScript + Vanilla CSS frontend
```

### Architecture
1. **Frontend**: Built with **React** and **TypeScript** compiled by **Vite**. Styling is handled using custom **Vanilla CSS** to deliver premium chalkboard dust styling, realistic frame shadows, and responsive glassmorphism toolbars.
2. **Backend**: Built with **Node.js**, **Hono**, and **Socket.io**. It handles REST requests, real-time message routing, and persistence-backed room access.

---

## Getting Started

### 1. Backend Setup

Navigate to the `backend/` directory:
```bash
cd backend
npm install
npm run dev # runs the Hono/Socket.IO server on port 3001
```

### 2. Frontend Setup

Navigate to the `frontend/` directory:
```bash
cd frontend
npm install
npm run dev # runs Vite dev server on port 5173
```

Now open `http://localhost:5173` in your browser. Open multiple windows or tabs to test real-time collaborative drawing and cursor synchronization. Copy `backend/.env.example` to `backend/.env` and provide Postgres, Redis, Google Identity, session, and LiveKit settings before starting the backend.

### Production verification

Build the frontend first, then verify and build the backend:

```bash
cd frontend && npm run build
cd ../backend && npm run verify
```

The backend serves the resulting `frontend/dist` build alongside `/api` and `/socket.io`. Use `/health` for liveness and `/ready` for Postgres/Redis readiness; `/ready` returns HTTP 503 until both dependencies respond.
