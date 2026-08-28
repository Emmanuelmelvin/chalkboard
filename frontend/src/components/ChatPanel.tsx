/**
 * @file ChatPanel.tsx
 * @description Accessible, modern classroom chat drawer built on Radix UI Dialog primitive
 * and Astryx ChatLayout component specification (https://astryx.atmeta.com/components/ChatLayout).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  MessageCircle,
  Sparkles,
  X,
} from 'lucide-react';
import type { Socket } from 'socket.io-client';
import UserAvatar from '@/components/UserAvatar';
import { HoverCard } from '@/components/ui/HoverCard';
import type { ChatMessage as ChatMessageType, RoomMember, AgentActivityPayload } from '@/types';
import {
  ChatLayout,
  ChatMessageList,
  ChatMessage,
  ChatMessageBubble,
  ChatComposer,
  ChatMentionMenu,
  AgentThinkingCard,
  type MentionItemData,
} from '@/components/chat';
import '@/styles/ChatLayout.css';

function parseAiMessage(rawMessage: string) {
  const match = rawMessage.match(/^\[AI(?::([a-zA-Z0-9_-]+))?\]\s*(.*)$/s);
  if (match) {
    const rawAgent = match[1] || 'chalkboard-master';
    const formattedAgent = rawAgent
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    return {
      isAi: true,
      agentName: formattedAgent,
      text: match[2],
    };
  }
  return {
    isAi: false,
    agentName: null,
    text: rawMessage,
  };
}

interface ChatPanelProps {
  socket: Socket;
  roomId: string;
  userId: string;
  messages: ChatMessageType[];
  members: RoomMember[];
  unreadMentions: number;
  canEdit: boolean;
  onClearUnread: () => void;
}

const ALL_MENTION_LABEL = 'all';
const ALL_MENTION_USER_ID = '__all__';
const AGENT_MENTION_LABEL = 'Chalkboard Master';
const AGENT_MENTION_USER_ID = 'agent:chalkboard-master';

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentionedUserIds(message: string, members: RoomMember[], currentUserId: string) {
  const result: string[] = [];
  const mentionableMembers = members.filter((member) => member.userId !== currentUserId);

  if (new RegExp(`(^|\\s)@${ALL_MENTION_LABEL}(?=\\s|$)`, 'i').test(message)) {
    result.push(...mentionableMembers.map((member) => member.userId));
  }

  if (new RegExp(`(^|\\s)@(chalkboard\\s*master|master|ai|agent)(?=\\s|$|[:,])`, 'i').test(message)) {
    result.push(AGENT_MENTION_USER_ID);
  }

  const memberMatches = mentionableMembers
    .filter((member) => member.displayName.trim())
    .filter((member) => new RegExp(`(^|\\s)@${escapeRegExp(member.displayName.trim())}(?=\\s|$)`, 'i').test(message))
    .map((member) => member.userId);

  result.push(...memberMatches);
  return [...new Set(result)];
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function ChatPanel({
  socket,
  roomId,
  userId,
  messages,
  members,
  unreadMentions,
  canEdit,
  onClearUnread,
}: ChatPanelProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [highlightedSuggestion, setHighlightedSuggestion] = useState(0);
  const [agentActivity, setAgentActivity] = useState<AgentActivityPayload | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const mentionMatch = draft.match(/(?:^|\s)@([^\s@]*)$/);
  const mentionQuery = mentionMatch?.[1]?.toLocaleLowerCase() ?? null;
  const isAgentMatch = mentionQuery !== null && (
    'chalkboard master'.includes(mentionQuery) ||
    'master'.includes(mentionQuery) ||
    'ai'.includes(mentionQuery) ||
    'agent'.includes(mentionQuery)
  );

  const mentionItems: MentionItemData[] =
    mentionQuery === null
      ? []
      : [
          ...(ALL_MENTION_LABEL.includes(mentionQuery)
            ? [
                {
                  kind: 'all' as const,
                  userId: ALL_MENTION_USER_ID,
                  displayName: ALL_MENTION_LABEL,
                  avatarUrl: null,
                },
              ]
            : []),
          ...(isAgentMatch
            ? [
                {
                  kind: 'member' as const,
                  userId: AGENT_MENTION_USER_ID,
                  displayName: AGENT_MENTION_LABEL,
                  avatarUrl: null,
                  role: 'instructor' as const,
                  online: true,
                },
              ]
            : []),
          ...members
            .filter((member) => member.userId !== userId && !member.userId.startsWith('agent:'))
            .filter((member) => member.displayName.toLocaleLowerCase().includes(mentionQuery))
            .map((m) => ({
              kind: 'member' as const,
              userId: m.userId,
              displayName: m.displayName,
              avatarUrl: m.avatarUrl,
              role: m.role,
              online: m.online,
            })),
        ].slice(0, 6);

  // Listen to agent:activity broadcasts for realtime thinking/tool telemetry
  useEffect(() => {
    const handleAgentActivity = (payload: AgentActivityPayload) => {
      if (payload.roomId !== roomId) return;
      if (payload.stage === 'idle' || payload.stage === 'completed') {
        setAgentActivity(null);
      } else {
        setAgentActivity(payload);
      }
    };
    socket.on('agent:activity', handleAgentActivity);
    return () => {
      socket.off('agent:activity', handleAgentActivity);
    };
  }, [socket, roomId]);

  // Instantly dissolve transient activity indicator when new chat message arrives
  useEffect(() => {
    if (messages.length > 0) {
      setAgentActivity(null);
    }
  }, [messages.length]);

  useEffect(() => {
    if (open && unreadMentions > 0) {
      onClearUnread();
    }
  }, [open, unreadMentions, onClearUnread]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) onClearUnread();
    setOpen(nextOpen);
  };

  const selectMention = (item: MentionItemData) => {
    if (!mentionMatch || mentionMatch.index === undefined) return;
    const atIndex = mentionMatch.index + mentionMatch[0].lastIndexOf('@');
    const nextDraft = `${draft.slice(0, atIndex)}@${
      item.kind === 'all' ? ALL_MENTION_LABEL : item.displayName
    } `;
    setDraft(nextDraft);
    setHighlightedSuggestion(0);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(nextDraft.length, nextDraft.length);
    });
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionItems.length > 0 && event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedSuggestion((current) => (current + 1) % mentionItems.length);
      return;
    }
    if (mentionItems.length > 0 && event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedSuggestion((current) => (current - 1 + mentionItems.length) % mentionItems.length);
      return;
    }
    if (mentionItems.length > 0 && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      selectMention(mentionItems[highlightedSuggestion]);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    const message = draft.trim();
    if (!message || sending) return;

    setSending(true);
    setError('');
    socket.emit(
      'chat:send',
      {
        roomId,
        message,
        mentionedUserIds: mentionedUserIds(message, members, userId),
      },
      (response: { ok?: boolean; error?: string }) => {
        setSending(false);
        if (!response?.ok) {
          setError(
            response?.error === 'rate_limited'
              ? 'You are sending messages too quickly.'
              : 'Your message could not be sent.'
          );
          return;
        }
        setDraft('');
      }
    );
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange} modal={false}>
      <div className={`chat-widget ${canEdit ? 'chat-widget-editor' : 'chat-widget-viewer'}`}>
        {open && (
          <Dialog.Content
            className="chat-panel"
            onPointerDownOutside={(e) => {
              // Allow drawing/clicking on canvas without forcefully closing the non-modal chat
              const target = e.target as HTMLElement | null;
              if (target?.closest('.chat-fab') || target?.closest('.chalkboard-canvas-layer')) {
                e.preventDefault();
              }
            }}
          >
            {/* Minimal Header matching Insert modal */}
            <div className="chat-mini-header">
              <Dialog.Title asChild>
                <h3>Chat</h3>
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="chat-mini-close"
                  aria-label="Close chat"
                  title="Close chat"
                >
                  <X size={16} />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">
              Live collaborative chat messages with classmates and AI instructor in this room.
            </Dialog.Description>

            {/* Astryx Chat Layout Shell */}
            <ChatLayout
              isEmpty={messages.length === 0}
              unreadCount={unreadMentions}
              emptyState={
                <div className="chat-empty-state">
                  <div className="chat-empty-icon">
                    <MessageCircle size={24} />
                  </div>
                  <p className="chat-panel-empty">
                    No messages yet. Say hello or mention someone with @ to start collaborating!
                  </p>
                </div>
              }
              composer={
                <ChatComposer
                  textareaRef={inputRef}
                  value={draft}
                  onChange={(val) => {
                    setDraft(val);
                    setHighlightedSuggestion(0);
                  }}
                  onSubmit={handleSubmit}
                  onKeyDown={handleInputKeyDown}
                  placeholder="Message the room… (press Enter to send)"
                  sending={sending}
                  error={error}
                  hint={
                    <span>
                      Type <strong>@</strong> to mention someone or <strong>@all</strong>
                    </span>
                  }
                  mentionSuggestions={
                    mentionItems.length > 0 ? (
                      <ChatMentionMenu
                        items={mentionItems}
                        highlightedIndex={highlightedSuggestion}
                        onSelect={selectMention}
                      />
                    ) : null
                  }
                />
              }
            >
              <ChatMessageList>
                {messages.map((entry) => {
                  const aiInfo = parseAiMessage(entry.message);
                  const isAi =
                    entry.userId === AGENT_MENTION_USER_ID ||
                    entry.userId?.startsWith('agent:') ||
                    entry.displayName.includes('Chalkboard Master') ||
                    aiInfo.isAi;
                  const isOwn = !isAi && entry.userId === userId;
                  const sender = isOwn ? 'user' : isAi ? 'assistant' : 'member';
                  const displayName = isAi ? 'Chalkboard Master (AI)' : isOwn ? 'You' : entry.displayName;

                  return (
                    <ChatMessage
                      key={entry.id}
                      sender={sender}
                      avatar={
                        <div
                          className="chat-message-avatar-wrap"
                          title={isAi ? 'Chalkboard Master (AI)' : entry.displayName}
                        >

                          <UserAvatar
                            name={isAi ? 'Chalkboard Master' : entry.displayName}
                            avatarUrl={isAi ? null : entry.avatarUrl}
                            size="sm"
                            className="chat-message-avatar"
                          />
                          {isAi && (
                            <span className="chat-ai-avatar-badge" aria-label="Chalkboard Master">
                              <Sparkles size={8} />
                            </span>
                          )}
                        </div>
                      }
                      metadata={
                        <>
                          <strong>{displayName}</strong>
                          <time dateTime={entry.createdAt}>
                            {formatMessageTime(entry.createdAt)}
                          </time>
                        </>
                      }
                    >
                      <ChatMessageBubble sender={sender}>
                        {aiInfo.text}
                      </ChatMessageBubble>
                    </ChatMessage>
                  );
                })}
                {agentActivity && (
                  <ChatMessage
                    sender="assistant"
                    avatar={
                      <div
                        className="chat-message-avatar-wrap"
                        title="Chalkboard Master (AI)"
                      >
                        <UserAvatar
                          name="Chalkboard Master"
                          avatarUrl={null}
                          size="sm"
                          className="chat-message-avatar"
                        />
                        <span className="chat-ai-avatar-badge" aria-label="Chalkboard Master">
                          <Sparkles size={8} />
                        </span>
                      </div>
                    }
                    metadata={
                      <strong>Chalkboard Master (AI)</strong>
                    }
                  >
                    <AgentThinkingCard activity={agentActivity} />
                  </ChatMessage>
                )}
              </ChatMessageList>

            </ChatLayout>
          </Dialog.Content>
        )}

        <HoverCard content={open ? 'Close room chat' : 'Open room chat'} placement="above" sideOffset={10}>
          <Dialog.Trigger asChild>
            <button
              type="button"
              className={`chat-fab${open ? ' active' : ''}`}
              aria-label={open ? 'Close room chat' : 'Open room chat'}
              onClick={() => {
                if (!open) onClearUnread();
                setOpen((prev) => !prev);
              }}
            >
              <MessageCircle size={18} />
              {unreadMentions > 0 && (
                <span
                  className="chat-unread-badge"
                  aria-label={`${unreadMentions} unread mentions`}
                >
                  {unreadMentions > 9 ? '9+' : unreadMentions}
                </span>
              )}
            </button>
          </Dialog.Trigger>
        </HoverCard>
      </div>
    </Dialog.Root>
  );
}
