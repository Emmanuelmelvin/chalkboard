import React, { useEffect, useRef, useState } from 'react';
import { Undo2, Redo2, Trash2, TriangleAlert } from 'lucide-react';
import { HoverCard } from '@/components/ui/HoverCard';

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
  const sticksRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!confirmingClear) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!sticksRef.current?.contains(event.target as Node)) setConfirmingClear(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConfirmingClear(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [confirmingClear]);

  const disarm = () => setConfirmingClear(false);

  return (
    <div className="action-sticks" ref={sticksRef}>
      <HoverCard content="Undo Action (Ctrl+Z)" placement="above" sideOffset={10}>
        <button
          type="button"
          onClick={() => { disarm(); onUndo(); }}
          disabled={!canUndo}
          className={`action-stick ${canUndo ? '' : 'action-stick-disabled'}`}
          aria-label="Undo Action"
        >
          <Undo2 size={14} />
        </button>
      </HoverCard>

      <HoverCard content="Redo Action (Ctrl+Y)" placement="above" sideOffset={10}>
        <button
          type="button"
          onClick={() => { disarm(); onRedo(); }}
          disabled={!canRedo}
          className={`action-stick ${canRedo ? '' : 'action-stick-disabled'}`}
          aria-label="Redo Action"
        >
          <Redo2 size={14} />
        </button>
      </HoverCard>

      <HoverCard
        content={confirmingClear ? 'Click again to confirm clear' : 'Clear blackboard'}
        placement="above"
        sideOffset={10}
      >
        <button
          type="button"
          className={`action-stick${confirmingClear ? ' action-stick-clear-arm' : ''}`}
          aria-label={confirmingClear ? 'Confirm clear blackboard' : 'Clear blackboard'}
          onClick={() => {
            if (confirmingClear) {
              setConfirmingClear(false);
              onClear();
            } else {
              setConfirmingClear(true);
            }
          }}
        >
          {confirmingClear ? <TriangleAlert size={14} /> : <Trash2 size={14} />}
        </button>
      </HoverCard>
    </div>
  );
};

export default ActionSticks;