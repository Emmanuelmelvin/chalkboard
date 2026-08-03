# Chalkboard — Feature Walkthrough & Demo Guide

> A personal note before we begin: this project means a lot to me. I built it as a student who has sat through countless online classes where ideas got lost across five different tabs. I genuinely believe a tool like this could make collaborative learning feel more human, and I would love to see it get used by real classrooms and teams. If you are reading this, thank you for taking the time to look at it.

---

## What You Are Looking At

Chalkboard is a real-time collaborative canvas — think of a physical classroom blackboard, but shared over the internet. Multiple people can draw, annotate, and think together on the same surface at the same time, with live cursors, presence indicators, and synchronized strokes.

The demo GIF in the repository shows the core experience: a shared canvas where strokes appear instantly, tools switch fluidly, and the board feels alive.
g
---

## Who It Is For

Chalkboard started as a classroom idea, but the shared-canvas model is not limited to teaching. The room themes (Classroom, Workshop, Brainstorm, Meeting, Planning, Studio) exist precisely because the same board fits very different rooms:

- **Classrooms and tutoring** — a teacher works through a problem while students annotate and raise hands. The Mathematical Set plugin makes maths lessons genuinely practical: Venn diagrams, number lines, coordinate grids, and set symbols in a couple of clicks.
- **Board and executive meetings** — sketch org structures, decision trees, and quarterly plans live while everyone watches the same surface. Role controls mean the chair can present with viewers in read-only mode, then promote a colleague to instructor when it is their turn to contribute.
- **Product and design workshops** — user flows, wireframe sketches, and affinity mapping. Saved links let a large board stay navigable by naming and jumping to sections.
- **Engineering and architecture reviews** — system diagrams, sequence sketches, and incident timelines drawn together instead of one person screen-sharing a static diagram.
- **Study groups and peer tutoring** — students work problems side by side without needing to be in the same building.
- **Interviews and technical assessments** — a candidate sketches their thinking on a shared board while the interviewer observes, and the whole session stays visible in one place.
- **Research and thesis planning** — mind maps, literature relationships, and argument structures built up across sessions since the room persists.
- **Community and non-profit planning** — event layouts, budgets sketched visually, volunteer assignments.

The pattern that ties these together: any conversation where people need to *point at the same thing* while talking. Chalkboard gives that to a group, with authenticated rooms and permissions so it can be used for real work rather than only casual doodling.

---


## Running It for Real Collaboration

Because Chalkboard uses **Google Sign-In**, Google's OAuth policy requires a proper domain or a tunneled HTTPS URL — a raw local-network IP address like `192.168.x.x` will be rejected, even if the other person is on the same Wi-Fi. So to collaborate with someone, you need a tunnelling tool.

The good news: you only need to tunnel **one port**. Build the frontend, then run the compiled backend — it serves the app, the API, and the realtime socket all from port `3001`. There is no need to run the Vite dev server or tunnel two ports.

### Step 1 — Build the frontend

```bash
cd frontend
npm run build
```

This produces `frontend/dist`, which the backend will serve automatically.

### Step 2 — Build and start the backend

```bash
cd ../backend
npm run build
npm run start
```

Everything is now available on a single origin:

- `http://localhost:3001/` — the app
- `http://localhost:3001/admin` — the admin console
- `http://localhost:3001/api/*` — the API
- `http://localhost:3001/socket.io` — realtime collaboration

Make sure PostgreSQL and Redis are running before this step, and that migrations have been applied (`npm run db:migrate`).

### Step 3 — Tunnel port 3001

**Option A — ngrok**

```bash
# Install ngrok from https://ngrok.com and authenticate once
ngrok config add-authtoken <your-token>

# Expose the backend
ngrok http 3001
```

**Option B — Outray (outray.dev)**

```bash
# Install the Outray CLI, then:
outray tunnel --port 3001
```

Either tool prints a public HTTPS URL such as `https://abc123.ngrok-free.app`.

### Step 4 — Tell Google and the backend about the tunnel URL

1. In **Google Cloud Console → APIs & Services → Credentials**, open your OAuth Web client and add the tunnel URL to **Authorized JavaScript origins** (exact origin, no trailing slash).
2. In `backend/.env`, set `CORS_ORIGIN` to that same tunnel URL.
3. Set `NODE_ENV=production` for a realistic run.
4. Restart the backend (`npm run start`) so the new environment values load.

Now share the tunnel URL. Everyone opens it, signs in with Google, and lands on the same dashboard.

> Tip: tunnel URLs change every time you restart the tunnel (unless you have a reserved domain). Each time you get a new URL, update both the Google origins and `CORS_ORIGIN`.



---

## Feature Tour

### 1. Sign In and the Dashboard

After opening the app, users land on the **Login** page and sign in with Google. The backend verifies the credential server-side and sets a secure HTTP-only session cookie — no tokens are exposed to the browser.

The **Dashboard** is the home base. From here you can:
- See your rooms and create new ones.
- Access the Developer workspace for plugins.
- Manage your profile and settings.

### 2. Creating a Room

Click **New Room** and fill in:
- **Title and description** — what the room is for.
- **Theme** — Classroom, Workshop, Brainstorm, Meeting, Planning, or Studio. Each theme sets the visual tone of the board.
- **Access mode** — Open (anyone with the link joins instantly), Approval-required (owner approves each request), or Password-protected (share a generated password alongside the link).
- **Default member role** — whether new joiners are instructors (can draw) or viewers (read-only).

The room generates a shareable link and a short room code. Password-protected rooms also generate a password to share separately.

### 3. The Canvas

The canvas is the heart of the app. Here is what every tool does:

| Tool | What it does |
|---|---|
| **Chalk** | Freehand strokes with a chalk-dust texture. Adjust color, size, and intensity from the toolbar. |
| **Eraser** | Removes strokes by painting over them. |
| **Select** | Click or drag to select content. Move, resize, rotate, duplicate, group, cut, copy, paste, or delete selected items. |
| **Pan** | Hold Space or switch to the hand tool to scroll around the infinite canvas. |
| **Zoom** | Mouse wheel or keyboard shortcuts. |
| **Shapes** | Open Insert → Shapes to place lines, arrows, circles, rectangles, polygons, stars, hearts, crosses, and diamonds. |
| **Links** | Save a named reference that points to a location on the canvas — useful for jumping between sections of a large board. |
| **Undo / Redo** | Synchronized to the room. Everyone sees the same history. |
| **Clear board** | Wipes the canvas for all participants. |

Every stroke and action is broadcast through Socket.IO so collaborators see changes in real time.

### 4. Live Presence

While in a room you can see:
- **Live cursors** — each participant's cursor moves on your screen with their display name and a unique color.
- **Presence count** — how many people are currently in the room.
- **Reactions** — quick emoji reactions visible to everyone.
- **Raised hands** — a lightweight signal for "I have a question" in classroom settings.

If someone's connection drops briefly, a grace period prevents their cursor from flickering in and out.

### 5. Room Roles and Permissions

Rooms have three roles:

| Role | Can draw | Can manage members | Can close room |
|---|---|---|---|
| **Owner** | ✓ | ✓ | ✓ |
| **Instructor** | ✓ | Partial | ✗ |
| **Viewer** | ✗ | ✗ | ✗ |

Owners can promote or demote members, remove participants, and close the room entirely. This makes Chalkboard suitable for structured classroom sessions where the teacher controls who can write on the board.

### 6. Built-In Plugins

Open the **Insert** panel and look for the Plugins section. Four built-in plugin packs ship with the app:

- **Notes** — place editable text blocks anywhere on the canvas.
- **Tags** — annotate selected strokes with labels.
- **Statistics** — insert statistical diagrams and summaries.
- **Mathematical Set** — the flagship built-in. Insert:
  - Venn diagrams (two-set and three-set).
  - Number lines.
  - Coordinate grids.
  - Set theory symbols (∈, ∉, ⊂, ⊆, ∪, ∩, ∅, ℕ, ℤ, ℚ, ℝ, ℂ, and more).

Everything a plugin inserts becomes normal canvas strokes — collaborators who do not have the plugin installed can still see, select, move, and erase the content.

### 7. Community Plugins (Developer Workspace)

Chalkboard has a full plugin lifecycle for external developers:

1. Enable the **Developer workspace** from the Dashboard.
2. Go to `/dashboard?tab=developer` and create a new plugin draft.
3. Upload a ZIP containing `manifest.json` and `index.js`.
4. Submit a version for review.
5. An admin reviews and approves it through the `/admin` console (protected by TOTP two-factor authentication).
6. Approved plugins are published to the catalogue and can be installed by any user.

Example plugin packages are included in the `plugin-artifacts/` folder: **Focus Dot** and **Inscribed Circles**.

Plugins communicate with the board through a `postMessage` bridge — they run in a sandboxed context and never get direct access to session cookies or internal state.

### 8. Admin Console

Navigate to `/admin` (only accessible to accounts with the `super_admin` platform role). After completing TOTP setup on first visit, admins can:
- Review submitted plugin versions.
- Run a smoke test on the plugin bundle.
- Approve or reject submissions.
- Manage the plugin catalogue.
- Manage other administrators.

---

## Keyboard Shortcuts

The board supports keyboard-driven workflows. Some highlights:

| Action | Shortcut |
|---|---|
| Undo | Ctrl/Cmd + Z |
| Redo | Ctrl/Cmd + Shift + Z |
| Copy | Ctrl/Cmd + C |
| Paste | Ctrl/Cmd + V |
| Cut | Ctrl/Cmd + X |
| Duplicate | Ctrl/Cmd + D |
| Delete | Delete / Backspace |
| Group | Ctrl/Cmd + G |
| Ungroup | Ctrl/Cmd + Shift + G |
| Pan | Hold Space + drag |
| Zoom in/out | Ctrl/Cmd + scroll or +/- keys |

The full and up-to-date list lives in the in-app tooltips and in `frontend/src/hooks/useKeyboardShortcuts.ts`.

---

## Typical Collaborative Session (Step by Step)

1. **Host** builds the frontend, starts the compiled backend on port `3001`, opens a tunnel to that port, and adds the tunnel URL to the Google OAuth origins and `CORS_ORIGIN`.

2. **Host** signs in, creates a room (e.g., Classroom theme, Approval-required access), and copies the room link.
3. **Host** shares the link with participants.
4. **Participants** open the link, sign in with Google, and request to join. The host approves each request from the room members panel.
5. Everyone is now on the same canvas. The host can draw an agenda, participants can annotate, and the Mathematical Set plugin can be used to insert diagrams for a math lesson.
6. Reactions and raised hands keep the session interactive without needing a separate chat tool.
7. When the session ends, the host closes the room from the room menu.

---

## Checking That Everything Works

Before a live session, run through this quick checklist:

- `GET http://localhost:3001/health` → `{ "ok": true }`
- `GET http://localhost:3001/ready` → both `database` and `redis` reported as `up`
- Login page shows the Google Sign-In button
- After sign-in, Dashboard loads and room creation works
- Open the same room in two browser windows — a stroke drawn in one appears in the other within a second

---

*Built with care by a student who wanted better tools for learning. I hope it helps.*
