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
        title="Undo Action"
        onClick={onUndo}
        disabled={!canUndo}
        className={`action-stick ${canUndo ? '' : 'action-stick-disabled'}`}
      >
        <Undo2 size={14} />
      </button>

      <button
        type="button"
        title="Redo Action"
        onClick={onRedo}
        disabled={!canRedo}
        className={`action-stick ${canRedo ? '' : 'action-stick-disabled'}`}
      >
        <Redo2 size={14} />
      </button>

      <button
        type="button"
        className="action-stick"
        title="Clear Blackboard"
        onClick={() => setConfirmingClear(true)}
      >
        <Trash2 size={14} />
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
