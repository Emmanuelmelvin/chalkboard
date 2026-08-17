import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquarePlus, X } from 'lucide-react';
import { useCreateFeedbackMutation } from '@/api/hooks';
import { useLoggerStore } from '@/stores/loggerStore';
import type { FeedbackCategory } from '@/api/types';

const FEEDBACK_CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: 'bug_report', label: 'Bug report' },
  { value: 'feature_request', label: 'Feature request' },
  { value: 'general', label: 'General feedback' },
];

function FeedbackModal({ onClose }: { onClose: () => void }) {
  const createFeedback = useCreateFeedbackMutation();
  const [category, setCategory] = useState<FeedbackCategory>('general');
  const [message, setMessage] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const messageRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messageRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const canSubmit = message.trim().length > 0 && !createFeedback.isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    createFeedback.mutate(
      {
        category,
        message: message.trim(),
        contactEmail: contactEmail.trim() || undefined,
      },
      {
        onSuccess: () => {
          useLoggerStore.getState().notify('Thanks! Your feedback has been sent.', 'success', 4000);
          onClose();
        },
        onError: () => {
          useLoggerStore.getState().notify('Could not send feedback. Try again.', 'error', 4000);
        },
      },
    );
  };

  return createPortal(
    <div
      className="app-modal-overlay app-modal-overlay-dashboard"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="app-modal app-modal-dashboard feedback-modal" role="dialog" aria-modal="true" aria-labelledby="feedback-modal-title">
        <div className="app-modal-header">
          <h2 id="feedback-modal-title">Send feedback</h2>
          <button className="app-modal-close" type="button" onClick={onClose} aria-label="Close dialog">
            <X size={16} />
          </button>
        </div>
        <p>Tell us what is broken or what you would love to see next.</p>

        <div className="app-modal-input-group">
          <label htmlFor="feedback-category">Category</label>
          <select
            id="feedback-category"
            className="app-modal-input feedback-select"
            value={category}
            onChange={(event) => setCategory(event.target.value as FeedbackCategory)}
          >
            {FEEDBACK_CATEGORIES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        <div className="app-modal-input-group">
          <label htmlFor="feedback-message">Message</label>
          <textarea
            ref={messageRef}
            id="feedback-message"
            className="app-modal-input feedback-textarea"
            value={message}
            maxLength={2000}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Describe the issue or your idea…"
            rows={5}
          />
        </div>

        <div className="app-modal-input-group">
          <label htmlFor="feedback-email">Contact email (optional)</label>
          <input
            id="feedback-email"
            className="app-modal-input"
            type="email"
            value={contactEmail}
            maxLength={254}
            onChange={(event) => setContactEmail(event.target.value)}
            placeholder="you@example.com"
          />
        </div>

        <div className="app-modal-actions">
          <button className="app-modal-cancel" type="button" onClick={onClose}>Cancel</button>
          <button className="app-modal-confirm" type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {createFeedback.isPending ? 'Sending…' : 'Send feedback'}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function FeedbackWidget() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="feedback-widget-launcher"
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Send feedback"
        title="Send feedback"
      >
        <MessageSquarePlus size={17} strokeWidth={1.8} aria-hidden="true" />
        <span>Feedback</span>
      </button>
      {open && <FeedbackModal onClose={() => setOpen(false)} />}
    </>
  );
}

export default FeedbackWidget;