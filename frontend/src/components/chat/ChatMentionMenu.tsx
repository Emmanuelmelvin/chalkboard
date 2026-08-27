/**
 * @file ChatMentionMenu.tsx
 * @description Astryx-styled Trigger Menu for @mention autocompletion in chat.
 * Complies with the Astryx Trigger Menu / Chat Typeahead specification.
 */

import React from 'react';
import { Users, Circle } from 'lucide-react';
import UserAvatar from '@/components/UserAvatar';
import type { RoomMember } from '@/types';

export interface MentionItemData {
  kind: 'all' | 'member';
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  role?: RoomMember['role'];
  online?: boolean;
}

export interface ChatMentionMenuProps {
  items: MentionItemData[];
  highlightedIndex: number;
  onSelect: (item: MentionItemData) => void;
  className?: string;
}

export const ChatMentionMenu: React.FC<ChatMentionMenuProps> = ({
  items,
  highlightedIndex,
  onSelect,
  className = '',
}) => {
  if (items.length === 0) return null;

  return (
    <div
      className={`astryx-trigger-menu astryx-chat-mention-menu ${className}`}
      role="listbox"
      aria-label="Mention members in room"
    >
      <div className="astryx-trigger-menu-list">
        {items.map((item, index) => {
          const isHighlighted = index === highlightedIndex;
          const isAll = item.kind === 'all';

          return (
            <button
              key={item.userId}
              type="button"
              role="option"
              aria-selected={isHighlighted}
              className={`astryx-menu-item ${isHighlighted ? 'active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelect(item)}
            >
              <div className="menu-item-avatar-slot">
                {isAll ? (
                  <div className="menu-item-all-avatar" aria-hidden="true">
                    <Users size={14} />
                  </div>
                ) : (
                  <div className="menu-item-user-avatar">
                    <UserAvatar
                      name={item.displayName}
                      avatarUrl={item.avatarUrl}
                      size="sm"
                    />
                    {item.online && (
                      <span className="menu-item-online-dot" title="Online">
                        <Circle size={6} fill="#22c55e" stroke="none" />
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="menu-item-content">
                <span className="menu-item-name">
                  {isAll ? '@all' : item.displayName}
                </span>
                <span className="menu-item-subtext">
                  {isAll
                    ? 'Notify everyone in room'
                    : item.role === 'owner'
                    ? 'Owner'
                    : item.role === 'instructor'
                    ? 'Instructor'
                    : 'Member'}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
