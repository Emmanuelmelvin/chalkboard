import React from 'react';
import type { AgentActivityPayload } from '@/types';

interface AgentThinkingCardProps {
  activity: AgentActivityPayload;
}

export const AgentThinkingCard: React.FC<AgentThinkingCardProps> = ({ activity }) => {
  if (!activity || activity.stage === 'idle' || activity.stage === 'completed' || activity.stage === 'error') {
    return null;
  }

  const text = activity.thought || 'Thinking...';

  return (
    <div className="chat-activity-feed" aria-live="polite">
      <div className="chat-activity-step active">
        <span className="chat-activity-bullet" />
        <span className="chat-activity-text">{text}</span>
      </div>
    </div>
  );
};


