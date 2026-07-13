# Chalkboard State Migration Log

> **Purpose:** Living document for hand-off between AI sessions.  
> Update this file every time a migration step is completed or a design decision is made.

---

## Architecture Overview

```
Chalkboard.tsx
    │
    ├── useBoardStore()          ← single Zustand store — all "shareable" board state
    │       src/stores/boardStore.ts
    │
    ├── useLinksStore()          ← separate Zustand store — saved canvas links
    │       src/stores/linksStore.ts
    │
    ├── useState (local only)   ← drag gesture state, transient UI, collaborator cursors
    │
    └── useRef (gesture refs)   ← transformStart, initialTransformBox,
                                    initialSelectedStrokes, panStart,
                                    currentStrokeId, cursorPosRef, dprRef,
                                    hasNavigatedToLink, dustIdCounter

@/components/toolbox/*          ← Agent-callable action handlers that read/write
                                    boardStore via getBoard() (non-reactive)

@/lib/geometry.ts               ← Pure stateless geometry helpers (extracted Prompt 1)
@/lib/strokes.ts                ← Pure stateless stroke-transform helpers (extracted Prompt 1)
@/lib/index.ts                  ← Barrel re-export of the above two modules
```

---

## Completed Steps

### Prompt 1 — Pure utility extraction  (src/lib/)

**Date:** 2026-07-13

All stateless pure functions were moved from `src/utils/drawing.ts` into `src/lib/`:

| File | Contents |
|------|----------|
| `src/lib/geometry.ts` | `boxCenter`, `intersectRects`, `getStrokeBoundingBox`, `rectsIntersect`, `isStrokeInRect`, `getCombinedBoundingBox`, `rotatePoint` |
| `src/lib/strokes.ts` | `rotateStrokes`, `rotateStrokesTo`, `transformStrokes`, `clipSegment`, `clipStrokeToRect`, `pointToSegmentDistance`, `eraseStrokePoints` |
| `src/lib/index.ts` | Barrel re-exports both modules |

`src/utils/drawing.ts` now contains **only** Canvas-side-effect functions (`traceStrokePath`, `drawChalkSegment`, `drawChalkStroke`, `drawEraserSegment`) and re-exports everything from `@/lib` for backward compatibility.

All imports in these files were updated to point at `@/lib`:
- `src/pages/Chalkboard.tsx`
- `src/components/toolbox/clipboard.ts`
- `src/components/toolbox/links.ts`
- `src/components/toolbox/selection.ts`
- `src/components/toolbox/shapes.ts`
- `src/components/toolbox/transform.ts`
- `src/components/toolbox/trim.ts`

The inline `boxCenter` helper that lived inside `Chalkboard.tsx` was removed and imported from `@/lib/geometry`.

**Verification:** `tsc --noEmit` -> zero errors.

---

### Prompt 2 — Zustand store migration (useBoardStore)

**Date:** 2026-07-13

#### What was already done before this session

`src/stores/boardStore.ts` already existed and defined the full `BoardState` interface with every state field and matching setter. The `@/components/toolbox/*` files already used `getBoard()` to read/write the store.

#### What this session completed

`Chalkboard.tsx` was migrated from `useState` to `useBoardStore()` for every shareable state slice.

**Migrated from useState -> store:**

| State field | Store setter | Notes |
|-------------|-------------|-------|
| `activeTool` | `setActiveTool` | |
| `selectionMarquee` | `setSelectionMarquee` | |
| `selectedStrokeIds` | `setSelectedStrokeIds` | |
| `transformBox` | `setTransformBox` | |
| `selectionRotation` | `setSelectionRotation` | |
| `activeColor` | `setActiveColor` | |
| `brushSize` | `setBrushSize` | |
| `brushIntensity` | `setBrushIntensity` | |
| `eraserWidth` | `setEraserWidth` | |
| `eraserHeight` | `setEraserHeight` | |
| `panOffset` | `setPanOffset` | |
| `zoom` | `setZoom` | |
| `strokes` | `setStrokes` | |
| `redoStack` | `setRedoStack` | |
| `trimState` | `setTrimState` | |
| `showInsertShapes` | `setShowInsertShapes` | |
| `insertShapesTab` | `setInsertShapesTab` | |
| `highlightedLinkId` | `setHighlightedLinkId` | |
| `isCopied` | `setIsCopied` | |
| `clipboard` (was `clipboardRef`) | `setClipboard` | Converted from ref to store; `handlePaste` reads via `useBoardStore.getState().clipboard` |

**Kept as local useState** (never needed by toolbox agents):

| State | Reason |
|-------|--------|
| `transformMode` | Pure drag-gesture UI, only meaningful between pointerDown/Up |
| `hoveredHandle` | Pure hover UI state |
| `isPanning` | Drag gesture flag |
| `spacePressed` | Keyboard modifier flag |
| `isDrawing` | Draw gesture flag |
| `collaborators` | Managed entirely by socket events, not needed externally |
| `userCursorColor` | Computed once on mount, never changes |
| `dustPuffs` | Visual-only eraser effect |

**Kept as useRef** (only live between pointer events):

`transformStart`, `initialTransformBox`, `initialSelectedStrokes`, `currentStrokeId`, `panStart`, `cursorPosRef`, `dprRef`, `hasNavigatedToLink`, `dustIdCounter`

**cursorPosRef dual-write pattern:**  
The component still sets `cursorPosRef.current = pos` on every pointer move (no re-render),
AND also calls `setCursorPos(pos)` to keep the store in sync so toolbox `handlePaste` can read it.

**Two mount effects added:**
```tsx
// Sync socket + roomId into the store so toolbox agents can emit events
useEffect(() => {
  initSession({ roomId, socket, userId: socket.id ?? 'local' });
}, [roomId, socket, initSession]);

// Register canvas element in the store so toolbox handlers can access it
useEffect(() => {
  setCanvas(canvasRef.current);
  return () => setCanvas(null);
}, [setCanvas]);
```

**links stays in useLinksStore:**  
Chalkboard destructures only `{ links, setLinks }` (removed unused `addLink`, `removeLink`, `renameLink`).

**Verification:** `tsc --noEmit` -> zero errors.

---

### Prompt 3 — Extract hit-testing logic into the toolbox layer

**Date:** 2026-07-13

Extracted inline transform box hit-testing logic (pointerDown handles/resize check, crop/trim bounds verification, and pointerMove hover highlight detection) from `Chalkboard.tsx` into a single pure function in the toolbox folder.

**Added:**
- `src/components/toolbox/hitTest.ts` defining `hitTestTransformBox(pointerPos, transformBox, selectionRotation, zoom, disableRotate?)`
- Exported `hitTestTransformBox` from the barrel file `src/components/toolbox/index.ts`

**Replaced:**
- Inline crop box interactive-check in `Chalkboard.tsx`'s `handlePointerDown` with `hitTestTransformBox`
- Inline transform box selection-check in `Chalkboard.tsx`'s `handlePointerDown` with `hitTestTransformBox`
- Inline hover-state detection in `Chalkboard.tsx`'s `handlePointerMove` with `hitTestTransformBox`

**Verification:** `npx.cmd tsc --noEmit` -> zero errors.

---

## State of Chalkboard.tsx After This Session

All board state is now in `useBoardStore`. The component local handlers (`handleUndo`, `handleRedo`, etc.) use the store setters directly. The identical toolbox handlers in `@/components/toolbox/*` also use the store via `getBoard()`.

There are **no duplicate or conflicting mutations** — both paths write to the same Zustand store.

---

## What Remains / Next Steps

### 1. Remove duplicate local handlers in Chalkboard.tsx (HIGHEST PRIORITY)

Many handlers exist both locally in Chalkboard AND as imported toolbox functions.
The local versions **shadow** the toolbox imports. Since both now read/write the same store,
the local ones can be deleted and the toolbox imports used directly.

Handlers to delete from Chalkboard.tsx and switch to the toolbox import:
- `handleUndo` — use toolbox `handleUndo` from `@/components/toolbox/history`
- `handleRedo` — use toolbox `handleRedo`
- `handleClear` — use toolbox `handleClear`
- `handleCopy` — use toolbox `handleCopy`
- `handleCut` — use toolbox `handleCut`
- `handlePaste` — use toolbox `handlePaste`
- `handleDuplicate` — use toolbox `handleDuplicate`
- `handleGroup` — use toolbox `handleGroup`
- `handleUngroup` — use toolbox `handleUngroup`
- `handleIncreaseSize` — use toolbox `handleIncreaseSize`
- `handleDecreaseSize` — use toolbox `handleDecreaseSize`
- `handleStartTrim` — use toolbox `handleStartTrim`
- `handleApplyTrim` — use toolbox `handleApplyTrim`
- `handleResetTrim` — use toolbox `handleResetTrim`
- `handleCancelTrim` — use toolbox `handleCancelTrim`
- `handleNavigateToLink` — use toolbox `handleNavigateToLink`
- `handleCreateLink` — use toolbox `handleCreateLink`
- `handleDeleteLink` — use toolbox `handleDeleteLink`
- `handleRenameLink` — use toolbox `handleRenameLink`

**Approach:** Delete each local handler one at a time, run `tsc --noEmit` after each.
The keyboard shortcut useEffect dependencies will need updating once the useCallbacks are gone.
Note: some local handlers call `socket.emit` — verify the toolbox versions do the same.

### 2. Merge linksStore into boardStore (MEDIUM PRIORITY)

`SavedLink` is defined in both `@/types/index.ts` AND `@/stores/linksStore.ts` (duplicate type).
Consider adding `links: SavedLink[]` + `setLinks` to `boardStore` and removing `linksStore`.
Update `@/components/toolbox/links.ts` which currently uses `useLinksStore.getState()`.

### 3. collaborators state (LOW PRIORITY)

Currently local useState in Chalkboard. Moving to store would let agents query online users.

### 4. Leave as-is

- `isDrawing`, `isPanning`, `transformMode`, `hoveredHandle` — gesture-only, no agent use-case
- `dustPuffs` — visual-only, no agent use-case

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| `clipboard` in store (not ref) | Enables agent paste-at-cursor without a component instance |
| `cursorPosRef` kept AND store synced | Ref = zero re-renders; store = accessible by agent `handlePaste` |
| `transformMode` local only | Only meaningful during a drag; global store would cause unnecessary renders |
| Local handlers NOT yet deleted | Deferred to keep this diff minimal and reviewable |
| `links` kept in `linksStore` | Already working; consolidation is a future step |
| `@/utils/drawing.ts` re-exports `@/lib` | Backward compat — existing importers of drawing.ts still work |
| `useBoardStore.getState()` in `handlePaste` | Avoids stale closure without listing `clipboard` in useCallback deps |
