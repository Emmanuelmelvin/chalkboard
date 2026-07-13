# Chalkboard — Frontend

A real-time collaborative whiteboard with a chalk-on-blackboard aesthetic, built in React + TypeScript. Multiple users draw, select, transform, and organize objects on a shared canvas via Socket.IO, with an optional AI agent able to manipulate the board through the same command surface the UI uses.

## Tech stack

- **React + TypeScript** — UI and component layer
- **HTML5 Canvas** — board rendering (freehand drawing, shapes, selection UI)
- **Zustand** — global board state and mutation logic
- **Socket.IO (client)** — real-time multiplayer sync
- **lucide-react** — icon set

## Architecture overview

The frontend is organized into four layers, designed so that state, logic, rendering, and external control (including AI-agent tool calls) are cleanly separated. The guiding principle: **all board mutations flow through one set of store actions**, regardless of whether they're triggered by a mouse, a keyboard shortcut, or an external agent.

```
┌─────────────────────────────────────────────┐
│  Chalkboard.tsx (thin composition root)      │
│  mounts hooks, renders <canvas> + HUD        │
└───────────────┬───────────────────────────────┘
                 │
   ┌─────────────┼──────────────┬───────────────┐
   ▼             ▼              ▼               ▼
useCanvasRenderer useCanvasInteraction useKeyboardShortcuts useBoardSocket
   │             │              │               │
   └─────────────┴──────────────┴───────────────┘
                 │  (call store actions)
                 ▼
        ┌──────────────────┐
        │  useBoardStore    │  ← Zustand: state + mutating actions
        │  (single source   │
        │   of truth)       │
        └────────┬──────────┘
                 │  (uses pure helpers)
                 ▼
        ┌──────────────────┐
        │  toolbox/          │  ← pure functions, no state, no React
        └──────────────────┘

        ┌──────────────────┐
        │  boardCommands.ts  │  ← flat, React-free API over the store
        │  (AI agent surface) │     used by mouse/keyboard AND agent
        └──────────────────┘
```

### 1. `toolbox/` — pure functions

Stateless geometry and stroke utilities with no React or side-effect dependencies. Everything here takes data in and returns data out, which makes it independently testable and reusable across the store, the interaction hook, and the command layer.

Includes:
- Bounding box computation for single/combined strokes
- Stroke-in-rectangle checks (marquee selection)
- Stroke transform math (move, resize, rotate)
- Point rotation helpers
- Transform-box hit-testing (resize handles, edges, rotate handle — including de-rotating pointer coordinates into the selection's local space when it's currently rotated)
- Viewport-recenter math (used by the Links feature to focus the camera on a bounding box)

### 2. `useBoardStore` — Zustand state + actions

A single store holding all board state:

| Category | State |
|---|---|
| Content | `strokes`, `redoStack`, `links` |
| Selection | `selectedStrokeIds`, `transformBox`, `selectionRotation` |
| Tool settings | `activeTool`, `activeColor`, `brushSize`, `brushIntensity`, `eraserWidth`, `eraserHeight` |
| Viewport | `panOffset`, `zoom` |
| Collaboration | `collaborators`, `socket` |

State is only ever changed through **store actions** — functions like `insertShape`, `deleteSelection`, `duplicateSelection`, `groupSelection`, `ungroupSelection`, `rotateSelection`, `resetSelectionRotation`, `setDimensions`, `createLink`, `deleteLink`, `focusLink`, `undo`, `redo`, `clearBoard`, `applyRemoteStrokes`, and others. Each action reads current state, computes results via `toolbox/` helpers, updates the store, and — if the change should be shared with collaborators — emits the relevant Socket.IO event.

**Note on live drags:** in-progress transforms (dragging to move/resize/rotate) update local state every animation frame via a `preview*` action, but only emit to the socket once, on gesture end, via a `commit*` action. This keeps multiplayer sync efficient and avoids per-frame network traffic.

### 3. Hooks — React glue

Four hooks connect external event sources to the store. Each owns exactly one concern:

- **`useCanvasRenderer(canvasRef)`** — runs the `requestAnimationFrame` draw loop; reads store state and paints strokes, the selection box, resize/rotate handles, and the selection marquee. Purely a reader — never mutates state.
- **`useCanvasInteraction(canvasRef)`** — owns `pointerdown`/`pointermove`/`pointerup`, converts screen coordinates to canvas coordinates, uses `toolbox` hit-testing to determine what's being interacted with, and calls store actions. Owns interaction-local refs (`transformStart`, `initialTransformBox`, `initialSelectedStrokes`) that only matter for the duration of a single drag gesture and never belong in global state.
- **`useKeyboardShortcuts()`** — maps key combinations to store actions:

  | Shortcut | Action |
  |---|---|
  | `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / Redo |
  | `Ctrl+C` / `Ctrl+X` / `Ctrl+V` / `Ctrl+D` | Copy / Cut / Paste / Duplicate |
  | `Ctrl+G` / `Ctrl+Shift+G` | Group / Ungroup |
  | `[` / `]` | Decrease / Increase stroke size |
  | `Ctrl+[` / `Ctrl+]` | Rotate 90° CCW / CW |
  | `Ctrl+Shift+R` | Reset rotation |
  | `Ctrl+L` | Create a link from the current selection |
  | `Ctrl+Arrow` | Nudge selection |
  | `Arrow` | Pan canvas |
  | `Delete` / `Backspace` | Delete selection |
  | `Escape` | Deselect |
  | `Ctrl+Alt+ +/-` | Zoom in/out |
  | `Ctrl+I` | Toggle Insert Shapes / Links modal |
  | `Ctrl+B` / `E` / `M`/`H` / `S` | Switch tool (chalk / eraser / pan / select) |

- **`useBoardSocket(socket, roomId)`** — the only place `socket.on(...)` listeners live. Routes each incoming event (`room-history`, `stroke-start`, `stroke-draw`, `undo-stroke`, `clear-board`, `cursor-move`, `update-users`, `user-disconnected`) into the matching store action, so remote and local mutations go through identical code paths.

With all four hooks in place, `Chalkboard.tsx` itself is a thin composition root: it mounts the hooks and renders the `<canvas>` element plus HUD components (toolbar, selection toolbox, insert-shapes/links modal, collaborator list, zoom indicator), with no business logic living in the component body.

### 4. `boardCommands.ts` — flat, agent-facing API

A React-free module exposing every store action as a plain top-level function, using the store's `getState()`/`setState()` outside of the React tree (e.g. `insertShape(type)`, `rotateSelection(deg)`, `deleteSelection()`, `createLink(tag)`, `focusLink(id)`, `selectStrokes(ids)`). This is the surface an external AI agent's tool executor calls to manipulate the board.

Design rules for this layer:
- **No parallel mutation path.** Commands call the exact same store actions the UI uses, so agent-driven and mouse-driven changes stay perfectly consistent and multiplayer-synced.
- **Explicit results.** Every command validates its own preconditions and returns a structured result (e.g. `{ ok: false, error: "no selection" }`) instead of silently no-op-ing, so an agent gets an actionable outcome rather than ambiguity.
- **Synchronous or immediately resolved.** No command depends on animation-frame timing or an in-progress user gesture.

## Feature notes

### Selection & transforms
Objects can be selected individually, via marquee, or as a `groupId` group. A selected object shows a transform box with resize handles and a rotate handle. Rotation is tracked as a *persistent total angle* (`selectionRotation`) rather than reset after each drag — the transform box itself stays axis-aligned in local space and is rotated visually around its center, so it accurately tracks the underlying strokes across multiple rotate operations without "snapping back."

### Links
A saved reference to one object or a group of objects, tagged with a memorable name. Links are managed from the **Links** tab of the Insert modal (alongside **Shapes**) and can also be created via `Ctrl+L` when something is selected. Clicking a link in the list recenters the viewport on that object's *current* bounding box — always recomputed live, so it stays correct even if the object has since moved, resized, or rotated.

### Multiplayer sync
Every mutating store action emits its result over the shared `roomId` Socket.IO channel after the change is finalized (not per animation frame). Incoming events are applied through the same store actions used locally, so there's a single, consistent path for how strokes, links, and selection state change — whether the change originated locally, from a collaborator, or from the AI agent.

## Directory structure

```
src/
├── components/
│   ├── Chalkboard.tsx        # composition root
│   ├── tools/
│   │   ├── SelectionToolbox.tsx
│   │   ├── InsertShapes.tsx  # Shapes / Links tabs
│   │   ├── ColorPicker.tsx
│   │   └── ActionSticks.tsx
│   └── ui/                   # Card, Button, etc.
├── hooks/
│   ├── useCanvasRenderer.ts
│   ├── useCanvasInteraction.ts
│   ├── useKeyboardShortcuts.ts
│   └── useBoardSocket.ts
├── store/
│   └── useBoardStore.ts      # Zustand store + actions
├── toolbox/
│   ├── geometry.ts           # bounding box, rotation, point math
│   ├── strokes.ts            # stroke transform helpers
│   └── hitTest.ts            # transform-box hit-testing
├── commands/
│   └── boardCommands.ts      # flat, React-free API for the AI agent
├── utils/
│   ├── drawing.ts            # canvas draw routines (chalk, eraser)
│   ├── shapes.ts             # shape-to-stroke generation
│   └── colors.ts
└── types/
    └── index.ts              # Stroke, Rect, Point, CanvasLink, etc.
```

## Getting started

```bash
pnpm install
pnpm dev
```

The app expects a running Socket.IO backend (see the backend README) and connects using a `roomId` provided via the room join flow.
