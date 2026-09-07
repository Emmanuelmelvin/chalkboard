/**
 * @file ChatMessage.tsx
 * @description Single message row rendering avatar, bubble, and metadata.
 * Complies with the Astryx Chat Layout specification.
 */

import React from 'react';
import type { ChatSender } from './ChatMessageBubble';

export interface ChatMessageProps extends React.HTMLAttributes<HTMLDivElement> {
  sender?: ChatSender;
  avatar?: React.ReactNode;
  metadata?: React.ReactNode;
  children: React.ReactNode;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({
  sender = 'member',
  avatar,
  metadata,
  children,
  className = '',
  ...rest
}) => {
  return (
    <article
      className={`astryx-chat-message sender-${sender} ${className}`}
      {...rest}
    >
      {avatar && <div className="astryx-chat-message-avatar">{avatar}</div>}
      <div className="astryx-chat-message-body">
        {metadata && <div className="astryx-chat-message-metadata">{metadata}</div>}
        {children}
      </div>
    </article>
  );
};
