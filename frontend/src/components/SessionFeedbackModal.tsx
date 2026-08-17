import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Star, X } from 'lucide-react';
import { useSubmitRoomSessionFeedbackMutation } from '@/api/hooks';
import { useLoggerStore } from '@/stores/loggerStore';

const RATING_LABELS = ['', 'Not useful', 'Somewhat useful', 'Useful', 'Very useful', 'Excellent'];

interface SessionFeedbackModalProps {
  roomSlug: string;
  /** Called after the user picks skip or a submission attempt finished. */
  onDone: () => void;
}

function SessionFeedbackModal({ roomSlug, onDone }: SessionFeedbackModalProps) {
  const submitFeedback = useSubmitRoomSessionFeedbackMutation();
  const [rating, setRating] = useState(0);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDone();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onDone]);

  const handleSubmit = () => {
    if (rating < 1 || submitting) return;
    setSubmitting(true);
    submitFeedback.mutate(
      { slug: roomSlug, input: { rating, note: note.trim() || undefined } },
      {
        onSuccess: () => {
          useLoggerStore.getState().notify('Thanks for your rating!', 'success', 3200);
          onDone();
        },
        onError: () => {
          // Leaving is never blocked on feedback; report quietly and go.
          useLoggerStore.getState().notify('Could not save your rating.', 'warning', 3200);
          onDone();
        },
      },
    );
  };

  return createPortal(
    <div
      className="app-modal-overlay app-modal-overlay-board"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDone();
      }}
    >
      <section className="app-modal app-modal-board session-feedback-modal" role="dialog" aria-modal="true" aria-labelledby="session-feedback-title">
        <div className="app-modal-header">
          <h2 id="session-feedback-title">How was this session?</h2>
          <button className="app-modal-close" type="button" onClick={onDone} aria-label="Close dialog">
            <X size={16} />
          </button>
        </div>
        <p>Rate this room so owners know what worked. Leaving is never blocked on this.</p>

        <div className="session-feedback-stars" role="radiogroup" aria-label="Rate this session">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              className={`session-feedback-star${value <= rating ? ' is-selected' : ''}`}
              onClick={() => setRating(value)}
              aria-pressed={value <= rating}
              aria-label={RATING_LABELS[value]}
              title={RATING_LABELS[value]}
            >
              <Star size={26} strokeWidth={1.6} fill={value <= rating ? 'currentColor' : 'none'} aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="session-feedback-rating-label" aria-hidden="true">
          {rating > 0 ? RATING_LABELS[rating] : 'Pick a rating'}
        </div>

        <div className="app-modal-input-group">
          <label htmlFor="session-feedback-note">What worked or what could improve? (optional)</label>
          <textarea
            ref={noteRef}
            id="session-feedback-note"
            className="app-modal-input session-feedback-note"
            value={note}
            maxLength={1000}
            onChange={(event) => setNote(event.target.value)}
            placeholder="A short reflection for the room owner…"
            rows={3}
          />
        </div>

        <div className="app-modal-actions">
          <button className="app-modal-cancel" type="button" onClick={onDone}>Skip</button>
          <button className="app-modal-confirm" type="button" onClick={handleSubmit} disabled={rating < 1 || submitting}>
            {submitting ? 'Sending…' : 'Send rating'}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export default SessionFeedbackModal;