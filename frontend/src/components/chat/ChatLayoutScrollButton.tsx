/**
 * @file ChatLayoutScrollButton.tsx
 * @description Floating scroll-to-bottom button with auto-scroll integration and unread badge.
 * Complies with the Astryx Chat Layout specification.
 */

import React from 'react';
import { ChevronDown } from 'lucide-react';

export interface ChatLayoutScrollButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  unreadCount?: number;
  label?: string;
  onClick?: () => void;
}

export const ChatLayoutScrollButton: React.FC<ChatLayoutScrollButtonProps> = ({
  unreadCount = 0,
  label = 'New messages',
  onClick,
  className = '',
  ...rest
}) => {
  return (
    <button
      type="button"
      className={`astryx-chat-layout-scroll-button ${className}`}
      onClick={onClick}
      aria-label={unreadCount > 0 ? `${unreadCount} new messages. Scroll to bottom` : 'Scroll to bottom'}
      {...rest}
    >
      <span className="scroll-btn-icon">
        <ChevronDown size={14} />
      </span>
      {unreadCount > 0 && <span className="scroll-btn-label">{label}</span>}
      {unreadCount > 1 && <span className="scroll-btn-badge">{unreadCount}</span>}
    </button>
  );
};
