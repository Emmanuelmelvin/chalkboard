import { MessageSquarePlus } from 'lucide-react';
import { showUserJotFeedback, userjotEnabled } from '@/lib/userjot';

function FeedbackWidget() {
  if (!userjotEnabled) return null;

  return (
    <button
      className="feedback-widget-launcher"
      type="button"
      onClick={showUserJotFeedback}
      aria-label="Send feedback"
      title="Send feedback"
    >
      <MessageSquarePlus size={17} strokeWidth={1.8} aria-hidden="true" />
      <span>Feedback</span>
    </button>
  );
}

export default FeedbackWidget;