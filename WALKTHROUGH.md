# Chalkboard — Feature Walkthrough & Demo Guide

> A personal note before we begin: this project means a lot to me. I built it as a student who has sat through countless online classes where ideas got lost across five different tabs. I genuinely believe a tool like this could make collaborative learning feel more human, and I would love to see it get used by real classrooms and teams. If you are reading this, thank you for taking the time to look at it.

---

## What You Are Looking At

Chalkboard is a real-time collaborative canvas — think of a physical classroom blackboard, but shared over the internet. Multiple people can draw, annotate, and think together on the same surface at the same time, with live cursors, presence indicators, and synchronized strokes.

The demo GIF in the repository shows the core experience: a shared canvas where strokes appear instantly, tools switch fluidly, and the board feels alive.

---

## Running It for Real Collaboration

Because Chalkboard uses **Google Sign-In**, Google's OAuth policy requires a proper domain or a tunneled HTTPS URL — a raw local-network IP address like `192.168.x.x` will be rejected. To share the app with another person (even on the same Wi-Fi), you need a tunneling tool.

### Option A — ngrok (widely used)

```bash
# 1. Install ngrok from https://ngrok.com and authenticate once
ngrok config add-authtoken <your-token>

# 2. Start the backend and frontend normally
#    (backend on :3001, frontend on :5173)

# 3. Expose the frontend through ngrok
ngrok http 5173
```

ngrok prints a public HTTPS URL like `https://abc123.ngrok-free.app`. Use that URL as:
- The address you share with collaborators.
- An **Authorized JavaScript Origin** in your Google Cloud OAuth client (Google Cloud Console → APIs & Services → Credentials → your Web client → Authorized JavaScript origins).
- The value of `CORS_ORIGIN` in `backend/.env`.

Restart the backend after updating `.env`.

### Option B — Outray (outray.dev, no account needed for quick tests)

```bash
# Install the Outray CLI, then:
outray tunnel --port 5173
```

Outray gives you a public HTTPS URL the same way. Add it to your Google OAuth origins and `CORS_ORIGIN` just like with ngrok.

### Quick-start recap (full local setup assumed complete per README)

```bash
# Terminal 1 — backend
cd backend && npm run dev

# Terminal 2 — frontend
cd frontend && npm run dev

# Terminal 3 — tunnel (pick one)
ngrok http 5173
# or
outray tunnel --port 5173
```

Share the tunnel URL. Everyone signs in with Google and lands on the same dashboard.

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

1. **Host** starts the backend and frontend, opens a tunnel, and adds the tunnel URL to Google OAuth origins.
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
