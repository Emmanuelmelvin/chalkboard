import { useEffect } from 'react';
import { useBoardStore, getBoard } from '@/stores/boardStore';
import {
  handleUndo,
  handleRedo,
  handleDelete,
  handleCopy,
  handleCut,
  handlePaste,
  handleDuplicate,
  handleGroup,
  handleUngroup,
  handleIncreaseSize,
  handleDecreaseSize,
  handleRotate,
  handleResetRotation,
  handleNudgeDirection,
  handlePanDirection,
  handleZoomIn,
  handleZoomOut,
  handleToggleTrim,
  handleApplyTrim,
  handleCancelTrim,
} from '@/components/toolbox';

/**
 * Hook to manage window-level keyboard shortcut listeners.
 * Maps keyboard inputs directly to store actions and toolbox handlers.
 */
export function useKeyboardShortcuts() {
  const {
    setSpacePressed,
    setInsertShapesTab,
    setShowInsertShapes,
    setShowSelectionToolbox,
    setActiveTool,
  } = useBoardStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const { selectedStrokeIds, trimState } = getBoard();
      const inInput = document.activeElement?.tagName === 'INPUT';

      if (e.code === 'Space') {
        setSpacePressed(true);
        if (!inInput) {
          e.preventDefault();
        }
      }

      // Keyboard Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        handleRedo();
      }

      // Keyboard Copy / Paste / Cut / Duplicate / Group / Ungroup shortcuts
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !inInput) {
        const key = e.key.toLowerCase();
        if (key === 'c' && selectedStrokeIds.length > 0) {
          e.preventDefault();
          handleCopy();
        } else if (key === 'v') {
          e.preventDefault();
          handlePaste();
        } else if (key === 'x' && selectedStrokeIds.length > 0) {
          e.preventDefault();
          handleCut();
        } else if (key === 'd' && selectedStrokeIds.length > 0) {
          e.preventDefault();
          handleDuplicate();
        } else if (key === 'g' && !e.shiftKey && selectedStrokeIds.length >= 2) {
          e.preventDefault();
          handleGroup();
        } else if (key === 'g' && e.shiftKey && selectedStrokeIds.length > 0) {
          e.preventDefault();
          handleUngroup();
        }
      }

      // Selection size shortcuts
      if (selectedStrokeIds.length > 0 && !inInput) {
        if (!(e.ctrlKey || e.metaKey) && (e.key === ']' || e.key === '=' || e.key === '+')) {
          e.preventDefault();
          handleIncreaseSize();
        } else if (!(e.ctrlKey || e.metaKey) && (e.key === '[' || e.key === '-')) {
          e.preventDefault();
          handleDecreaseSize();
        }
      }

      // Rotation shortcuts: Ctrl+] = 90 CW, Ctrl+[ = 90 CCW, Ctrl+Shift+R = reset
      if ((e.ctrlKey || e.metaKey) && selectedStrokeIds.length > 0 && !inInput) {
        if (e.key === ']') {
          e.preventDefault();
          handleRotate(90);
        } else if (e.key === '[') {
          e.preventDefault();
          handleRotate(-90);
        } else if (e.shiftKey && (e.key === 'r' || e.key === 'R')) {
          e.preventDefault();
          handleResetRotation();
        }
      }

      // Ctrl+Arrow keys: nudge selected objects
      if ((e.ctrlKey || e.metaKey) && selectedStrokeIds.length > 0 && !inInput) {
        if (e.key === 'ArrowUp') { e.preventDefault(); handleNudgeDirection('up'); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); handleNudgeDirection('down'); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); handleNudgeDirection('left'); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); handleNudgeDirection('right'); }
      }

      // Arrow keys without Ctrl: pan the canvas
      if (!(e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && !inInput) {
        if (e.key === 'ArrowUp') { e.preventDefault(); handlePanDirection('up'); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); handlePanDirection('down'); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); handlePanDirection('left'); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); handlePanDirection('right'); }
      }

      // Delete / Backspace: delete selected strokes
      if (selectedStrokeIds.length > 0 && !inInput) {
        if (e.key === 'Delete' || e.key === 'Del' || e.key === 'Backspace') {
          e.preventDefault();
          handleDelete();
          return;
        }
      }

      // Escape: deselect
      if (e.key === 'Escape' && selectedStrokeIds.length > 0 && !trimState.active) {
        e.preventDefault();
        const { setSelectedStrokeIds, setTransformBox, setSelectionRotation } = getBoard();
        setSelectedStrokeIds([]);
        setTransformBox(null);
        setSelectionRotation(0);
        return;
      }

      // Ctrl+Alt+Plus / Ctrl+Alt+Minus: zoom in/out
      if ((e.ctrlKey || e.metaKey) && e.altKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          handleZoomIn();
          return;
        } else if (e.key === '-' || e.key === '_') {
          e.preventDefault();
          handleZoomOut();
          return;
        }
      }

      // Ctrl+Shift+T: toggle trim/crop mode (only when not in input)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && !inInput) {
        if (e.code === 'KeyT') {
          e.preventDefault();
          handleToggleTrim();
          return;
        }
      }

      // Enter: apply trim when in trim mode
      if (trimState.active && e.key === 'Enter' && !inInput) {
        e.preventDefault();
        handleApplyTrim();
        return;
      }

      // Escape: cancel trim mode
      if (trimState.active && e.key === 'Escape') {
        e.preventDefault();
        handleCancelTrim();
        return;
      }

      // Ctrl+L: open links tab directly (only when not in input)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && !inInput) {
        const key = e.key.toLowerCase();
        if (key === 'l') {
          e.preventDefault();
          setInsertShapesTab('links');
          setShowInsertShapes(true);
          return;
        }
      }

      // Ctrl+I: open insert shapes modal on Shapes tab (only when not in input)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && !inInput) {
        const key = e.key.toLowerCase();
        if (key === 'i') {
          e.preventDefault();
          setInsertShapesTab('shapes');
          setShowInsertShapes((prev) => !prev);
          return;
        }
      }

      // Ctrl+O: toggle selection toolbox (only when not in input)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && !inInput) {
        const key = e.key.toLowerCase();
        if (key === 'o') {
          e.preventDefault();
          setShowSelectionToolbox((prev) => !prev);
          return;
        }
      }

      // Keyboard tool selection (Ctrl + key or Cmd + key)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'b') {
          e.preventDefault();
          setActiveTool('chalk');
        } else if (key === 'e') {
          e.preventDefault();
          setActiveTool('eraser');
        } else if (key === 'm' || key === 'h') {
          e.preventDefault();
          setActiveTool('pan');
        } else if (key === 's') {
          e.preventDefault();
          setActiveTool('select');
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [setSpacePressed, setInsertShapesTab, setShowInsertShapes, setShowSelectionToolbox, setActiveTool]);
}
export default useKeyboardShortcuts;