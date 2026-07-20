import React, { useState } from 'react';
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
  const [confirmingClear, setConfirmingClear] = useState(false);

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
        onClick={() => setConfirmingClear(true)}
      >
        <Trash2 size={16} />
        <span>Clear</span>
      </button>

      {confirmingClear && (
        <div className="clear-confirm-popover" role="dialog" aria-label="Confirm clear board">
          <p>Clear the entire blackboard?</p>
          <div>
            <button type="button" onClick={() => setConfirmingClear(false)}>Cancel</button>
            <button type="button" onClick={() => { setConfirmingClear(false); onClear(); }}>Clear board</button>
          </div>
        </div>
      )}
    </>
  );
};

export default ActionSticks;
