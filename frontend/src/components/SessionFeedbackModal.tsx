import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Star, X } from 'lucide-react';
import { useSubmitRoomSessionFeedbackMutation } from '@/api/hooks';
import { useLoggerStore } from '@/stores/loggerStore';
import { isSessionFeedbackOptedOut, markRoomRated, setSessionFeedbackOptOut } from '@/lib/sessionFeedback';

const RATING_LABELS = ['', 'Not useful', 'Somewhat useful', 'Useful', 'Very useful', 'Excellent'];

interface SessionFeedbackModalProps {
  roomSlug: string;
  roomTitle?: string;
  /** Called after the user submits, skips, or closes the dialog. */
  onDone: () => void;
}

function SessionFeedbackModal({ roomSlug, roomTitle, onDone }: SessionFeedbackModalProps) {
  const submitFeedback = useSubmitRoomSessionFeedbackMutation();
  const [rating, setRating] = useState(0);
  const [note, setNote] = useState('');
  const [dontShowAgain, setDontShowAgain] = useState(isSessionFeedbackOptedOut());
  const [submitting, setSubmitting] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDone();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onDone]);

  const finish = () => {
    if (dontShowAgain) setSessionFeedbackOptOut(true);
    onDone();
  };

  const handleSubmit = () => {
    if (rating < 1 || submitting) return;
    setSubmitting(true);
    submitFeedback.mutate(
      { slug: roomSlug, input: { rating, note: note.trim() || undefined } },
      {
        onSuccess: () => {
          markRoomRated(roomSlug);
          useLoggerStore.getState().notify('Thanks for your rating!', 'success', 3200);
          finish();
        },
        onError: () => {
          useLoggerStore.getState().notify('Could not save your rating.', 'warning', 3200);
          finish();
        },
      },
    );
  };

  return createPortal(
    <div
      className="app-modal-overlay app-modal-overlay-dashboard"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDone();
      }}
    >
      <section className="app-modal app-modal-dashboard session-feedback-modal" role="dialog" aria-modal="true" aria-labelledby="session-feedback-title">
        <div className="app-modal-header">
          <h2 id="session-feedback-title">{roomTitle ? `How was “${roomTitle}”?` : 'How was that session?'}</h2>
          <button className="app-modal-close" type="button" onClick={finish} aria-label="Close dialog">
            <X size={16} />
          </button>
        </div>
        <p>Rate the room you just left, so owners know what worked.</p>

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

        <label className="session-feedback-opt-out">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(event) => setDontShowAgain(event.target.checked)}
          />
          Don&apos;t show this again
        </label>

        <div className="app-modal-actions">
          <button className="app-modal-cancel" type="button" onClick={finish}>Skip</button>
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