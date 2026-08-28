/**
 * @file AgentThinkingCard.tsx
 * @description Lightweight, minimalist transient activity stream for Chalkboard Master.
 * Shows clean, simple text lines stacked one upon the other as the agent reasons and executes tools,
 * and completely dissolves when finished so the chat message appears naturally.
 */

import React, { useEffect, useState } from 'react';
import type { AgentActivityPayload } from '@/types';

interface AgentThinkingCardProps {
  activity: AgentActivityPayload;
}

export const AgentThinkingCard: React.FC<AgentThinkingCardProps> = ({ activity }) => {
  const [steps, setSteps] = useState<string[]>([]);

  useEffect(() => {
    if (!activity || activity.stage === 'idle' || activity.stage === 'completed') {
      setSteps([]);
      return;
    }

    let line = '';
    if (activity.stage === 'thinking' || activity.stage === 'planning') {
      line = activity.thought || 'Thinking...';
    } else if (activity.stage === 'executing_tool') {
      line = activity.toolAction || `Executing ${activity.toolName || 'action'}...`;
    } else if (activity.stage === 'tool_result') {
      line = activity.resultSummary ? `Completed: ${activity.resultSummary}` : `Completed ${activity.toolAction || 'step'}`;
    }

    if (line) {
      setSteps((prev) => {
        if (prev[prev.length - 1] === line) return prev;
        // Keep up to 3 recent steps
        return [...prev.slice(-2), line];
      });
    }
  }, [activity]);

  if (!activity || activity.stage === 'idle' || activity.stage === 'completed' || steps.length === 0) {
    return null;
  }

  return (
    <div className="chat-activity-feed" aria-live="polite">
      {steps.map((text, idx) => {
        const isLatest = idx === steps.length - 1;
        return (
          <div
            key={`${idx}-${text}`}
            className={`chat-activity-step ${isLatest ? 'active' : 'completed'}`}
          >
            <span className="chat-activity-bullet" />
            <span className="chat-activity-text">{text}</span>
          </div>
        );
      })}
    </div>
  );
};

