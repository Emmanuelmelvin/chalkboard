import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  variant?: 'board' | 'dashboard';
  children?: ReactNode;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  danger = false,
  variant = 'board',
  children,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return createPortal(
    <div
      className={`app-modal-overlay app-modal-overlay-${variant}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section className={`app-modal app-modal-${variant}`} role="dialog" aria-modal="true" aria-labelledby="app-modal-title" aria-describedby="app-modal-message">
        <div className="app-modal-header">
          <h2 id="app-modal-title">{title}</h2>
          <button className="app-modal-close" type="button" onClick={onCancel} aria-label="Close dialog">
            <X size={16} />
          </button>
        </div>
        <p id="app-modal-message">{message}</p>
        {children}
        <div className="app-modal-actions">
          <button className="app-modal-cancel" type="button" onClick={onCancel}>{cancelLabel}</button>
          <button ref={confirmButtonRef} className={`app-modal-confirm${danger ? ' is-danger' : ''}`} type="button" onClick={onConfirm} disabled={confirmDisabled}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
