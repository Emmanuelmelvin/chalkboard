import React from 'react';
import { Undo2, Redo2, Trash2 } from 'lucide-react';

interface ActionSticksProps {
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const ActionSticks: React.FC<ActionSticksProps> = ({
  onUndo,
  onRedo,
  onClear,
  canUndo,
  canRedo,
}) => {
  return (
    <>
      <button
        type="button"
        className="action-stick"
        title="Undo Action"
        onClick={onUndo}
        disabled={!canUndo}
        style={{ opacity: canUndo ? 1 : 0.4, cursor: canUndo ? 'pointer' : 'not-allowed' }}
      >
        <Undo2 size={16} />
        <span>Undo</span>
      </button>

      <button
        type="button"
        className="action-stick"
        title="Redo Action"
        onClick={onRedo}
        disabled={!canRedo}
        style={{ opacity: canRedo ? 1 : 0.4, cursor: canRedo ? 'pointer' : 'not-allowed' }}
      >
        <Redo2 size={16} />
        <span>Redo</span>
      </button>

      <button
        type="button"
        className="action-stick"
        title="Clear Blackboard"
        onClick={() => {
          if (window.confirm('Are you sure you want to clear the entire blackboard?')) {
            onClear();
          }
        }}
      >
        <Trash2 size={16} />
        <span>Clear</span>
      </button>
    </>
  );
};

export default ActionSticks;
