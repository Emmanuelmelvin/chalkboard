/**
 * @file ChatComposer.tsx
 * @description Docked composer input area with auto-resize, mention autocompletion, and send controls.
 * Complies with the Astryx Chat Layout specification.
 */

import React, { useRef, useEffect } from 'react';
import { Send, Loader2 } from 'lucide-react';

export interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  sending?: boolean;
  error?: string;
  hint?: React.ReactNode;
  actions?: React.ReactNode;
  mentionSuggestions?: React.ReactNode;
  className?: string;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export const ChatComposer: React.FC<ChatComposerProps> = ({
  value,
  onChange,
  onSubmit,
  onKeyDown,
  placeholder = 'Type a message…',
  disabled = false,
  sending = false,
  error,
  hint,
  actions,
  mentionSuggestions,
  className = '',
  textareaRef: externalRef,
}) => {
  const internalRef = useRef<HTMLTextAreaElement | null>(null);
  const inputRef = externalRef || internalRef;

  // Auto-resize textarea height up to 140px
  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const nextHeight = Math.min(textarea.scrollHeight, 140);
    textarea.style.height = `${Math.max(nextHeight, 36)}px`;
  }, [value, inputRef]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim() || sending || disabled) return;
    onSubmit();
  };

  return (
    <form className={`astryx-chat-composer ${className}`} onSubmit={handleSubmit}>
      {mentionSuggestions && (
        <div className="astryx-chat-mention-dock">{mentionSuggestions}</div>
      )}

      {error && (
        <div className="astryx-chat-composer-error" role="alert">
          {error}
        </div>
      )}

      <div className="astryx-chat-composer-body">
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled || sending}
          rows={1}
          maxLength={2000}
          className="astryx-chat-composer-input"
          aria-label="Chat composer message"
        />

        <div className="astryx-chat-composer-controls">
          {actions}
          <button
            type="submit"
            className="astryx-chat-send-button"
            disabled={!value.trim() || sending || disabled}
            aria-label="Send message"
            title="Send message (Enter)"
          >
            {sending ? <Loader2 size={15} className="spin-animate" /> : <Send size={15} />}
          </button>
        </div>
      </div>

      {hint && <div className="astryx-chat-composer-hint">{hint}</div>}
    </form>
  );
};
