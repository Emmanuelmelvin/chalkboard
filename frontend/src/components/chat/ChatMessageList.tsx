/**
 * @file ChatMessageList.tsx
 * @description Vertically stacked list of chat messages that flows naturally and aligns messages cleanly.
 * Complies with the Astryx Chat Layout specification.
 */

import React from 'react';

export interface ChatMessageListProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const ChatMessageList: React.FC<ChatMessageListProps> = ({
  children,
  className = '',
  ...rest
}) => {
  return (
    <div className={`astryx-chat-message-list ${className}`} {...rest}>
      {children}
    </div>
  );
};
