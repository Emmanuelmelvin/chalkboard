import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Send, X, StopCircle, Sparkles, GraduationCap, Lightbulb, PenTool } from 'lucide-react';
import { instructAgent, stopAgent } from '@/api/agent';
import { getApiError } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';

interface AiMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: number;
  status?: 'sending' | 'sent' | 'error';
}

interface AiChatPanelProps {
  roomId: string;
  canEdit: boolean;
  // Optional: currently displayed room title for contextual placeholders
  roomTitle?: string;
}

/**
 * Google-style Gemini diamond icon – 4-point sparkle with gradient.
 * Matches the “diamond” AI affordance users expect from Google/AI surfaces.
 */
function GeminiIcon({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="ai-gem-grad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="35%" stopColor="#a78bfa" />
          <stop offset="70%" stopColor="#f472b6" />
          <stop offset="100%" stopColor="#facc15" />
        </linearGradient>
        <linearGradient id="ai-gem-grad-strong" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="50%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#ec4899" />
        </linearGradient>
      </defs>
      {/* Main diamond – Google Gemini style: centered 4-point star */}
      <path
        d="M12 2.2L14.9 9.1L22 12L14.9 14.9L12 21.8L9.1 14.9L2 12L9.1 9.1L12 2.2Z"
        fill="url(#ai-gem-grad)"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="0.5"
      />
      {/* Inner highlight for depth */}
      <path
        d="M12 5.5L13.6 9.2L17.6 12L13.6 14.8L12 18.2L10.4 14.8L6.4 12L10.4 9.2L12 5.5Z"
        fill="rgba(255,255,255,0.18)"
      />
      {/* Small sparkle dots */}
      <circle cx="18.5" cy="5.5" r="1.2" fill="white" opacity="0.9" />
      <circle cx="6.2" cy="17.8" r="0.9" fill="white" opacity="0.7" />
    </svg>
  );
}

const SUGGESTED_PROMPTS = [
  { icon: GraduationCap, label: 'Teach Pythagorean theorem', prompt: 'Teach the Pythagorean theorem with a visual proof and a practice problem' },
  { icon: Lightbulb, label: 'Explain Venn diagrams', prompt: 'Draw and explain a two-set Venn diagram for “A ∪ B” with an example' },
  { icon: PenTool, label: 'Draw coordinate grid', prompt: 'Draw a coordinate grid and plot the line y = 2x + 1, then pose a quick challenge' },
];

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function AiChatPanel({ roomId, canEdit, roomTitle }: AiChatPanelProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [teaching, setTeaching] = useState(false);
  const [error, setError] = useState('');

  const { profile } = useAuthStore();
  const displayName = profile?.displayName || 'You';

  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  // Auto-scroll on new messages / open
  useEffect(() => {
    if (!open) return;
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open, teaching]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [open]);

  const canSend = canEdit && draft.trim().length > 0 && !sending && !teaching;

  const addMessage = (msg: AiMessage) => setMessages((prev) => [...prev, msg]);

  const handleToggle = () => setOpen((v) => !v);

  const handleSelectSuggestion = (prompt: string) => {
    setDraft(prompt);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleStop = async () => {
    try {
      await stopAgent(roomId);
      setTeaching(false);
      addMessage({
        id: `sys-${Date.now()}`,
        role: 'system',
        text: 'Lesson stopped.',
        timestamp: Date.now(),
      });
    } catch (err) {
      const apiErr = getApiError(err);
      setError(apiErr.message);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const prompt = draft.trim();
    if (!prompt || sending || teaching) return;

    if (!canEdit) {
      setError('Viewers cannot request AI lessons. Ask an editor to promote you.');
      return;
    }

    const userMsg: AiMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: prompt,
      timestamp: Date.now(),
      status: 'sent',
    };
    addMessage(userMsg);
    setDraft('');
    setError('');
    setSending(true);
    setTeaching(true);

    // Optimistic assistant placeholder for thinking state
    const thinkingId = `a-thinking-${Date.now()}`;

    try {
      // Call backend proxy which forwards to agent-service /instruct
      await instructAgent({ roomId, prompt });

      // Backend returns immediate ack (agent is now joining & drawing)
      setSending(false);
      addMessage({
        id: thinkingId,
        role: 'assistant',
        text: `Got it — Chalkboard Master is now teaching “${prompt.slice(0, 80)}${prompt.length > 80 ? '…' : ''}”.\n\nWatch the board: title, diagram, and worked example will appear live. Ask a follow-up when you’re ready!`,
        timestamp: Date.now(),
      });

      // Keep teaching state for a while – user can stop or send another prompt after cooldown
      // Agent service enforces one-at-a-time per room; we release UI after short delay
      // but keep “teaching” pulse for 45s to indicate the agent may still be drawing.
      setTimeout(() => setTeaching(false), 45000);
    } catch (err: any) {
      const apiErr: any = getApiError(err, 'Could not reach Chalkboard Master.');
      let friendly = apiErr.message;

      if (apiErr.status === 409 || apiErr.message?.includes('already active')) {
        friendly = 'Chalkboard Master is already teaching in this room. Wait a moment or press Stop, then try again.';
        setTeaching(true);
        setTimeout(() => setTeaching(false), 10000);
      } else if (apiErr.status === 403) {
        friendly = 'You do not have permission to start an AI lesson in this room (viewers cannot teach).';
        setTeaching(false);
      } else if (apiErr.status === 503) {
        friendly = 'Chalkboard Master is offline right now. Check that the agent service is running (port 8080) and try again.';
        setTeaching(false);
      } else if (apiErr.status === 429) {
        friendly = 'You’re starting lessons too quickly. Please wait a moment.';
        setTeaching(false);
      } else if (apiErr.status === 401) {
        friendly = 'Your session expired. Please refresh and sign in again.';
        setTeaching(false);
      } else {
        setTeaching(false);
      }

      setSending(false);
      setError(friendly);
      addMessage({
        id: `err-${Date.now()}`,
        role: 'system',
        text: friendly,
        timestamp: Date.now(),
        status: 'error',
      });
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
    }
  };

  return (
    <div className={`ai-chat-widget ${open ? 'ai-chat-widget-open' : ''}`}>
      {open && (
        <section
          ref={panelRef}
          className="chat-panel ai-chat-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="ai-chat-title"
        >
          <header className="chat-panel-header ai-chat-panel-header">
            <div className="ai-chat-header-left">
              <span className="ai-chat-avatar">
                <GeminiIcon size={20} />
              </span>
              <div>
                <span className="chat-panel-kicker ai-chat-kicker">
                  <Sparkles size={10} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                  Chalkboard Master
                </span>
                <h2 id="ai-chat-title" className="ai-chat-title">
                  AI Teacher
                  {teaching && <span className="ai-live-dot" aria-label="Teaching live" title="Teaching live" />}
                </h2>
                <span className="ai-chat-subtitle">
                  {teaching ? 'Teaching live on the board…' : 'Ask anything to teach on the canvas'}
                </span>
              </div>
            </div>
            <button type="button" className="chat-panel-close" onClick={handleToggle} aria-label="Close AI chat">
              <X size={15} />
            </button>
          </header>

          <div className="chat-panel-messages ai-chat-messages" aria-live="polite">
            {messages.length === 0 ? (
              <div className="ai-chat-empty">
                <div className="ai-chat-empty-icon">
                  <GeminiIcon size={32} />
                </div>
                <h3>Teach anything on the board</h3>
                <p>
                  Chalkboard Master draws, writes, and explains live — just like a teacher.
                  {roomTitle ? ` Currently in “${roomTitle}”.` : ''}
                </p>

                <div className="ai-suggestions">
                  {SUGGESTED_PROMPTS.map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      className="ai-suggestion-chip"
                      onClick={() => handleSelectSuggestion(s.prompt)}
                    >
                      <s.icon size={14} />
                      <span>{s.label}</span>
                    </button>
                  ))}
                </div>

                {!canEdit && (
                  <p className="ai-chat-viewer-note">You’re a viewer — ask an editor to run the lesson.</p>
                )}
              </div>
            ) : (
              messages.map((m) => {
                const isUser = m.role === 'user';
                const isSystem = m.role === 'system';
                if (isSystem) {
                  return (
                    <div key={m.id} className={`ai-system-message ${m.status === 'error' ? 'ai-system-error' : ''}`}>
                      <span>{m.text}</span>
                    </div>
                  );
                }
                return (
                  <article
                    key={m.id}
                    className={`chat-message ${isUser ? 'chat-message-own' : 'ai-chat-message-assistant'}`}
                  >
                    {!isUser && (
                      <span className="ai-msg-avatar" aria-hidden>
                        <GeminiIcon size={16} />
                      </span>
                    )}
                    <div className={`chat-message-content ${!isUser ? 'ai-msg-content' : ''}`}>
                      <div className="chat-message-meta">
                        <strong>{isUser ? displayName : 'Chalkboard Master'}</strong>
                        <time dateTime={new Date(m.timestamp).toISOString()}>{formatTime(m.timestamp)}</time>
                      </div>
                      <p>{m.text}</p>
                    </div>
                  </article>
                );
              })
            )}

            {(sending || teaching) && (
              <div className="ai-thinking-row" aria-live="polite" aria-label="Chalkboard Master is teaching">
                <span className="ai-thinking-avatar">
                  <GeminiIcon size={14} />
                </span>
                <div className="ai-thinking-bubble">
                  <span className="ai-thinking-dots" aria-hidden>
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="ai-thinking-text">
                    {sending ? 'Starting lesson…' : 'Drawing on the board…'}
                  </span>
                </div>
              </div>
            )}

            <div ref={endRef} />
          </div>

          <form className="chat-panel-compose ai-chat-compose" onSubmit={handleSubmit}>
            {error && (
              <p className="chat-panel-error ai-chat-error" role="alert">
                {error}
              </p>
            )}

            {teaching && (
              <div className="ai-teaching-bar">
                <span className="ai-teaching-pulse" />
                <span>Agent is active in this room</span>
                <button type="button" className="ai-stop-btn" onClick={handleStop}>
                  <StopCircle size={13} /> Stop
                </button>
              </div>
            )}

            <div className="chat-panel-input-row ai-chat-input-row">
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  !canEdit
                    ? 'Viewers cannot prompt the AI…'
                    : teaching
                      ? 'Agent is teaching — wait or stop…'
                      : 'Ask Chalkboard Master to teach… (e.g. “Explain the unit circle”)'
                }
                rows={1}
                maxLength={2000}
                aria-label="Ask Chalkboard Master"
                disabled={!canEdit || teaching}
              />
              <button
                type="submit"
                className="chat-send-button ai-send-button"
                disabled={!canSend}
                aria-label="Send to Chalkboard Master"
                title={teaching ? 'Agent is busy' : 'Send to Chalkboard Master'}
              >
                <Send size={15} />
              </button>
            </div>
            <span className="chat-panel-hint ai-chat-hint">
              Press Enter to send, Shift + Enter for new line · Powered by Gemini
            </span>
          </form>
        </section>
      )}

      <button
        type="button"
        className={`chat-fab ai-chat-fab${open ? ' active' : ''}${teaching ? ' ai-chat-fab-teaching' : ''}`}
        onClick={handleToggle}
        aria-expanded={open}
        aria-label={open ? 'Close AI teacher chat' : 'Open AI teacher chat'}
        title={open ? 'Close AI teacher' : 'Ask Chalkboard Master'}
      >
        <span className="ai-fab-icon-wrap">
          <GeminiIcon size={19} />
        </span>
        {teaching && !open && <span className="ai-fab-pulse" aria-hidden />}
      </button>
    </div>
  );
}
