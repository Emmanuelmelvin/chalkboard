/**
 * @file toolbox/index.ts
 * @description Barrel file exporting all agent-callable chalkboard tools.
 *
 * Every tool reads/writes state via the Zustand `boardStore`, so an AI agent
 * can call any exported function directly without going through React:
 *
 * ```ts
 * import { handleUndo, handleDelete, handleZoomIn } from '@/components/toolbox';
 *
 * handleUndo();       // Undo the last stroke
 * handleDelete();     // Delete selected strokes
 * handleZoomIn();     // Zoom in by one step
 * ```
 */

// ── History ────────────────────────────────────────────────────────────
export {
  handleUndo,
  handleRedo,
  handleClear,
  canUndo,
  canRedo,
} from '@/components/toolbox/history';

// ── Clipboard ──────────────────────────────────────────────────────────
export {
  handleCopy,
  handleCut,
  handlePaste,
  handleDuplicate,
} from '@/components/toolbox/clipboard';

// ── Selection ──────────────────────────────────────────────────────────
export {
  handleDelete,
  handleDeselect,
  handleGroup,
  handleUngroup,
  handleIncreaseSize,
  handleDecreaseSize,
  handleSetSize,
  handleColorChange,
  handleSetDimensions,
  isSelectionGrouped,
} from '@/components/toolbox/selection';

// ── Trim / Crop ────────────────────────────────────────────────────────
export {
  handleStartTrim,
  handleApplyTrim,
  handleResetTrim,
  handleCancelTrim,
  handleToggleTrim,
} from '@/components/toolbox/trim';

// ── Transform ──────────────────────────────────────────────────────────
export {
  handleRotate,
  handleResetRotation,
  handleNudge,
  handleNudgeDirection,
} from './transform';

// ── Navigation ─────────────────────────────────────────────────────────
export {
  handlePan,
  handlePanDirection,
  handleSetPanOffset,
  handleZoomIn,
  handleZoomOut,
  handleSetZoom,
  handleResetPanZoom,
  handleCenterOn,
} from '@/components/toolbox/navigation';

// ── Links ──────────────────────────────────────────────────────────────
export {
  handleCreateLink,
  handleDeleteLink,
  handleRenameLink,
  handleNavigateToLink,
  handleOpenLinksTab,
  getLinks,
} from '@/components/toolbox/links';

// ── Shapes ─────────────────────────────────────────────────────────────
export {
  handleInsertShape,
  handleOpenShapesModal,
} from '@/components/toolbox/shapes';

// ── Hit Testing ────────────────────────────────────────────────────────
export {
  hitTestTransformBox,
} from '@/components/toolbox/hitTest';