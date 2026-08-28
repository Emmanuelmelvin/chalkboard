/**
 * @file AgentThinkingCard.tsx
 * @description Real-time thinking and action telemetry stream card for Chalkboard Master.
 * Visually communicates the agent reasoning stages, tool execution, and turn progress.
 */

import React, { useState } from 'react';
import { Sparkles, Terminal, CheckCircle2, ChevronDown, ChevronUp, Loader2, AlertCircle } from 'lucide-react';
import type { AgentActivityPayload } from '@/types';

interface AgentThinkingCardProps {
  activity: AgentActivityPayload;
}

export const AgentThinkingCard: React.FC<AgentThinkingCardProps> = ({ activity }) => {
  const [expanded, setExpanded] = useState(true);

  if (activity.stage === 'idle') return null;

  const isThinking = activity.stage === 'thinking' || activity.stage === 'planning';
  const isExecuting = activity.stage === 'executing_tool';
  const isResult = activity.stage === 'tool_result';
  const isError = activity.stage === 'error';
  const isCompleted = activity.stage === 'completed';

  const getStageHeader = () => {
    if (isThinking) return 'Chalkboard Master is thinking...';
    if (isExecuting) return activity.toolAction || 'Executing action...';
    if (isResult) return activity.resultSummary || 'Action executed';
    if (isCompleted) return 'Response complete';
    if (isError) return 'Encountered an issue';
    return 'Chalkboard Master';
  };

  return (
    <div className={`agent-activity-card agent-activity-${activity.stage}`}>
      <div className="agent-activity-header" onClick={() => setExpanded(!expanded)}>
        <div className="agent-activity-title-wrap">
          {isThinking && <Sparkles size={14} className="agent-sparkle-spin" />}
          {isExecuting && <Loader2 size={14} className="agent-loader-spin" />}
          {isResult && <CheckCircle2 size={14} className="agent-icon-success" />}
          {isError && <AlertCircle size={14} className="agent-icon-error" />}
          {isCompleted && <CheckCircle2 size={14} className="agent-icon-success" />}

          <span className="agent-activity-headline">{getStageHeader()}</span>

          {activity.turnIndex !== undefined && (
            <span className="agent-turn-badge">
              Step {activity.turnIndex}
              {activity.maxTurns ? `/${activity.maxTurns}` : ''}
            </span>
          )}
        </div>

        <button type="button" className="agent-toggle-btn" aria-label="Toggle details">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {expanded && (
        <div className="agent-activity-body">
          {activity.thought && (
            <div className="agent-thought-snippet">
              <span className="agent-thought-label">Thought:</span>
              <p className="agent-thought-text">{activity.thought}</p>
            </div>
          )}

          {activity.toolName && (
            <div className="agent-tool-item">
              <div className="agent-tool-item-header">
                <Terminal size={12} className="agent-terminal-icon" />
                <code className="agent-tool-name">{activity.toolName}</code>
              </div>
              {activity.toolSummary && (
                <div className="agent-tool-summary">{activity.toolSummary}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
