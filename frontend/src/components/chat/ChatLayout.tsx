/**
 * @file ChatLayout.tsx
 * @description Layout shell for full chat interfaces with frosted glass composer dock,
 * adaptive density, auto-scrolling, and scroll-to-bottom controls.
 * Complies with the Astryx Chat Layout specification (https://astryx.atmeta.com/components/ChatLayout).
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ChatLayoutScrollButton } from './ChatLayoutScrollButton';

export interface ChatLayoutProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  composer: React.ReactNode;
  emptyState?: React.ReactNode;
  scrollButton?: React.ReactNode | null;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  unreadCount?: number;
  density?: 'compact' | 'balanced' | 'spacious';
  isEmpty?: boolean;
}

export const ChatLayout: React.FC<ChatLayoutProps> = ({
  children,
  composer,
  emptyState,
  scrollButton,
  scrollRef: externalScrollRef,
  unreadCount = 0,
  density = 'balanced',
  isEmpty = false,
  className = '',
  ...rest
}) => {
  const internalScrollRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = externalScrollRef || internalScrollRef;
  const [showScrollButton, setShowScrollButton] = useState(false);
  const isAtBottomRef = useRef(true);

  // Check if user is near bottom (< 80px)
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceToBottom < 80;
    isAtBottomRef.current = atBottom;
    setShowScrollButton(!atBottom);
  }, [scrollContainerRef]);

  // Scroll to bottom smoothly
  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    });
    isAtBottomRef.current = true;
    setShowScrollButton(false);
  }, [scrollContainerRef]);

  // Auto-scroll when children change if user was at bottom
  useEffect(() => {
    if (isAtBottomRef.current) {
      scrollToBottom(true);
    }
  }, [children, scrollToBottom]);

  // Initial scroll to bottom
  useEffect(() => {
    scrollToBottom(false);
  }, [scrollToBottom]);

  return (
    <div
      className={`astryx-chat-layout density-${density} ${className}`}
      {...rest}
    >
      {/* Scrollable message area */}
      <div
        ref={scrollContainerRef}
        className="astryx-chat-message-scroll-area"
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
      >
        {isEmpty && emptyState ? (
          <div className="astryx-chat-empty-state-wrap">{emptyState}</div>
        ) : (
          children
        )}
      </div>

      {/* Frosted Glass Composer Dock */}
      <div className="astryx-chat-dock">
        {/* Scroll to bottom button */}
        {scrollButton !== null && (
          <div className={`astryx-chat-scroll-button-layer ${showScrollButton ? 'visible' : ''}`}>
            {scrollButton !== undefined ? (
              scrollButton
            ) : (
              <ChatLayoutScrollButton
                unreadCount={unreadCount}
                onClick={() => scrollToBottom(true)}
              />
            )}
          </div>
        )}

        {/* Fixed composer */}
        <div className="astryx-chat-composer-dock">{composer}</div>
      </div>
    </div>
  );
};
