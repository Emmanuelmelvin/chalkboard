/**
 * @file ChatMessageBubble.tsx
 * @description Bubble container for chat messages with user/assistant/system variants.
 * Complies with the Astryx Chat Layout specification.
 */

import React from 'react';

export type ChatBubbleVariant = 'default' | 'ghost' | 'accent' | 'ai';
export type ChatSender = 'user' | 'assistant' | 'member' | 'system';

export interface ChatMessageBubbleProps extends React.HTMLAttributes<HTMLDivElement> {
  sender?: ChatSender;
  variant?: ChatBubbleVariant;
  children: React.ReactNode;
}

export const ChatMessageBubble: React.FC<ChatMessageBubbleProps> = ({
  sender = 'member',
  variant = 'default',
  children,
  className = '',
  ...rest
}) => {
  return (
    <div
      className={`astryx-chat-message-bubble sender-${sender} variant-${variant} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
};
