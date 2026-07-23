import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { MessageCircle, Send, X } from 'lucide-react';
import type { Socket } from 'socket.io-client';
import UserAvatar from '@/components/UserAvatar';
import type { ChatMessage, RoomMember } from '@/types';

interface ChatPanelProps {
  socket: Socket;
  roomId: string;
  userId: string;
  messages: ChatMessage[];
  members: RoomMember[];
  unreadMentions: number;
  canEdit: boolean;
  onClearUnread: () => void;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentionedUserIds(message: string, members: RoomMember[], currentUserId: string) {
  return members
    .filter((member) => member.userId !== currentUserId && member.displayName.trim())
    .filter((member) => new RegExp(`(^|\\s)@${escapeRegExp(member.displayName.trim())}(?=\\s|$)`, 'i').test(message))
    .map((member) => member.userId);
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
  const endOfMessagesRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const mentionMatch = draft.match(/(?:^|\s)@([^\s@]*)$/);
  const mentionQuery = mentionMatch?.[1]?.toLocaleLowerCase() ?? null;
  const mentionSuggestions = mentionQuery === null ? [] : members
      .filter((member) => member.userId !== userId)
      .filter((member) => member.displayName.toLocaleLowerCase().includes(mentionQuery))
      .slice(0, 6);

  useEffect(() => {
    if (!open) return;
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
    if (unreadMentions > 0) onClearUnread();
  }, [messages.length, open, unreadMentions, onClearUnread]);

  const toggleOpen = () => {
    if (!open) onClearUnread();
    setOpen(!open);
  };

  const selectMention = (member: RoomMember) => {
    if (!mentionMatch || mentionMatch.index === undefined) return;
    const atIndex = mentionMatch.index + mentionMatch[0].lastIndexOf('@');
    const nextDraft = `${draft.slice(0, atIndex)}@${member.displayName} `;
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
    if (mentionSuggestions.length > 0 && event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedSuggestion((current) => (current + 1) % mentionSuggestions.length);
      return;
    }
    if (mentionSuggestions.length > 0 && event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedSuggestion((current) => (current - 1 + mentionSuggestions.length) % mentionSuggestions.length);
      return;
    }
    if (mentionSuggestions.length > 0 && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      selectMention(mentionSuggestions[highlightedSuggestion]);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      inputRef.current?.form?.requestSubmit();
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || sending) return;

    setSending(true);
    setError('');
    socket.emit('chat:send', {
      roomId,
      message,
      mentionedUserIds: mentionedUserIds(message, members, userId),
    }, (response: { ok?: boolean; error?: string }) => {
      setSending(false);
      if (!response?.ok) {
        setError(response?.error === 'rate_limited' ? 'You are sending messages too quickly.' : 'Your message could not be sent.');
        return;
      }
      setDraft('');
    });
  };

  return (
    <div className={`chat-widget ${canEdit ? 'chat-widget-editor' : 'chat-widget-viewer'}`}>
      {open && (
        <section className="chat-panel" role="dialog" aria-modal="false" aria-labelledby="room-chat-title">
          <header className="chat-panel-header">
            <div>
              <span className="chat-panel-kicker">Room chat</span>
              <h2 id="room-chat-title">Everyone in the room</h2>
            </div>
            <button type="button" className="chat-panel-close" onClick={toggleOpen} aria-label="Close room chat">
              <X size={15} />
            </button>
          </header>

          <div className="chat-panel-messages" aria-live="polite">
            {messages.length === 0 ? (
              <p className="chat-panel-empty">Start the conversation with everyone in this room.</p>
            ) : messages.map((entry) => (
              <article key={entry.id} className={`chat-message ${entry.userId === userId ? 'chat-message-own' : ''}`}>
                <UserAvatar name={entry.displayName} avatarUrl={entry.avatarUrl} size="sm" className="chat-message-avatar" />
                <div className="chat-message-content">
                  <div className="chat-message-meta">
                    <strong>{entry.userId === userId ? 'You' : entry.displayName}</strong>
                    <time dateTime={entry.createdAt}>{formatMessageTime(entry.createdAt)}</time>
                  </div>
                  <p>{entry.message}</p>
                </div>
              </article>
            ))}
            <div ref={endOfMessagesRef} />
          </div>

          <form className="chat-panel-compose" onSubmit={handleSubmit}>
            {mentionSuggestions.length > 0 && (
              <div className="chat-mention-suggestions" role="listbox" aria-label="Mention a room member">
                {mentionSuggestions.map((member, index) => (
                  <button
                    key={member.userId}
                    type="button"
                    className={index === highlightedSuggestion ? 'active' : ''}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectMention(member)}
                  >
                    <UserAvatar name={member.displayName} avatarUrl={member.avatarUrl} size="sm" />
                    <span>{member.displayName}</span>
                  </button>
                ))}
              </div>
            )}
            {error && <p className="chat-panel-error" role="alert">{error}</p>}
            <div className="chat-panel-input-row">
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(event) => { setDraft(event.target.value); setHighlightedSuggestion(0); }}
                onKeyDown={handleInputKeyDown}
                placeholder="Message the room…"
                rows={1}
                maxLength={2000}
                aria-label="Room chat message"
              />
              <button type="submit" className="chat-send-button" disabled={!draft.trim() || sending} aria-label="Send message">
                <Send size={15} />
              </button>
            </div>
            <span className="chat-panel-hint">Use @ to mention a room member</span>
          </form>
        </section>
      )}
      <button
        type="button"
        className="chat-fab"
        onClick={toggleOpen}
        aria-expanded={open}
        aria-label={open ? 'Close room chat' : 'Open room chat'}
        title={open ? 'Close room chat' : 'Open room chat'}
      >
        <MessageCircle size={18} />
        {unreadMentions > 0 && <span className="chat-unread-badge" aria-label={`${unreadMentions} unread mentions`}>{unreadMentions > 9 ? '9+' : unreadMentions}</span>}
      </button>
    </div>
  );
}
