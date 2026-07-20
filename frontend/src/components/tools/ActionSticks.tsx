import React, { useState } from 'react';
import { Undo2, Redo2, Trash2 } from 'lucide-react';
import ConfirmModal from '@/components/ui/ConfirmModal';

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
        <ConfirmModal
          title="Clear blackboard?"
          message="This removes the entire shared blackboard for everyone in the room."
          confirmLabel="Clear board"
          danger
          onCancel={() => setConfirmingClear(false)}
          onConfirm={() => { setConfirmingClear(false); onClear(); }}
        />
      )}
    </>
  );
};

export default ActionSticks;
