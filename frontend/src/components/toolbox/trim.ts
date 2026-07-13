/**
 * @file trim.ts
 * @description Crop / trim tools for selected strokes.
 *
 * Agent-callable entry points for entering crop mode, applying a crop,
 * resetting a crop, and cancelling crop mode.
 */

import { clipStrokeToRect, getCombinedBoundingBox } from '@/utils/drawing';
import { getBoard } from '@/stores/boardStore';
import type { Stroke } from '@/types';

/**
 * Enter trim/crop mode for the current selection.
 *
 * Snapshots `originalPoints` on each selected stroke (once) so a later
 * "Reset Crop" can restore the full shape, then activates the crop box
 * equal to the current transform box.
 *
 * @returns `true` if crop mode was entered, `false` if there is no transform box.
 *
 * @example
 * ```ts
 * import { handleStartTrim } from '@/components/toolbox';
 * handleStartTrim();
 * ```
 */
export function handleStartTrim(): boolean {
  const {
    transformBox,
    selectedStrokeIds,
    setStrokes,
    setTrimState,
  } = getBoard();
  if (!transformBox) return false;

  // Save original points on each selected stroke (only once)
  setStrokes((prev) =>
    prev.map((s) => {
      if (selectedStrokeIds.includes(s.id) && !s.originalPoints) {
        return { ...s, originalPoints: [...s.points] };
      }
      return s;
    })
  );

  setTrimState({
    active: true,
    cropBox: { ...transformBox },
    initialBox: { ...transformBox },
  });
  return true;
}

/**
 * Apply the current crop: destructively clip selected strokes to `cropBox`,
 * preserving `originalPoints` so the user can still reset later.
 *
 * @returns `true` if crop was applied, `false` if crop mode was inactive.
 *
 * @example
 * ```ts
 * import { handleApplyTrim } from '@/components/toolbox';
 * handleApplyTrim();
 * ```
 */
export function handleApplyTrim(): boolean {
  const {
    strokes,
    selectedStrokeIds,
    trimState,
    socket,
    roomId,
    setStrokes,
    setSelectedStrokeIds,
    setTransformBox,
    setTrimState,
  } = getBoard();
  if (!trimState.active || !trimState.cropBox || !socket) return false;

  const { cropBox } = trimState;
  const updatedStrokes: Stroke[] = [];

  strokes.forEach((stroke) => {
    if (selectedStrokeIds.includes(stroke.id)) {
      const cropped = clipStrokeToRect(stroke, cropBox);
      const parentOriginal = stroke.originalPoints ?? stroke.points;
      cropped.forEach((cs) => {
        updatedStrokes.push({ ...cs, originalPoints: [...parentOriginal] });
      });
    } else {
      updatedStrokes.push(stroke);
    }
  });

  setStrokes(updatedStrokes);
  socket.emit('undo-stroke', { roomId, strokes: updatedStrokes });

  const newSelectedIds = updatedStrokes
    .filter((s) => s.id.includes('-crop-') || selectedStrokeIds.includes(s.id))
    .map((s) => s.id);
  setSelectedStrokeIds(newSelectedIds);

  const selected = updatedStrokes.filter((s) => newSelectedIds.includes(s.id));
  setTransformBox(getCombinedBoundingBox(selected));

  setTrimState({
    active: false,
    cropBox: null,
    initialBox: null,
  });
  return true;
}

/**
 * Reset crop:
 * - If crop mode is active → reset the crop box to the original full bounds.
 * - Otherwise → restore `originalPoints` on selected strokes (undo a prior crop).
 *
 * @returns `true` if a reset was performed, `false` otherwise.
 *
 * @example
 * ```ts
 * import { handleResetTrim } from '@/components/toolbox';
 * handleResetTrim();
 * ```
 */
export function handleResetTrim(): boolean {
  const {
    strokes,
    selectedStrokeIds,
    trimState,
    socket,
    roomId,
    setStrokes,
    setTransformBox,
    setTrimState,
  } = getBoard();

  if (trimState.active && trimState.initialBox) {
    setTrimState((prev) => ({
      ...prev,
      cropBox: { ...prev.initialBox! },
    }));
    return true;
  }

  if (selectedStrokeIds.length === 0 || !socket) return false;

  const updated = strokes.map((stroke) => {
    if (selectedStrokeIds.includes(stroke.id) && stroke.originalPoints) {
      return {
        ...stroke,
        points: [...stroke.originalPoints],
        originalPoints: undefined,
      };
    }
    return stroke;
  });
  setStrokes(updated);
  socket.emit('undo-stroke', { roomId, strokes: updated });

  const selected = updated.filter((s) => selectedStrokeIds.includes(s.id));
  setTransformBox(getCombinedBoundingBox(selected));
  return true;
}

/**
 * Cancel trim/crop mode without applying any changes.
 *
 * @example
 * ```ts
 * import { handleCancelTrim } from '@/components/toolbox';
 * handleCancelTrim();
 * ```
 */
export function handleCancelTrim(): void {
  getBoard().setTrimState({
    active: false,
    cropBox: null,
    initialBox: null,
  });
}

/**
 * Toggle trim mode: cancel if active, otherwise start (when a transform box exists).
 *
 * @returns `true` if mode was toggled, `false` if start was requested but no box.
 */
export function handleToggleTrim(): boolean {
  const { trimState, transformBox } = getBoard();
  if (trimState.active) {
    handleCancelTrim();
    return true;
  }
  if (transformBox) {
    return handleStartTrim();
  }
  return false;
}
