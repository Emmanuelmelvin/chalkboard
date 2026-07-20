import React, { useState } from 'react';
import { ArrowUpRight, LockKeyhole, LogOut } from 'lucide-react';
import { useLocation } from 'wouter';
import type { LobbyProps } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import '@/styles/PublicPages.css';

export const Lobby: React.FC<LobbyProps> = ({ initialRoomId, profile, onJoinRoom }) => {
  const [roomCode, setRoomCode] = useState(initialRoomId || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [, setLocation] = useLocation();
  const { signOut } = useAuthStore();

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const generatedId = Math.random().toString(36).substring(2, 8).toLowerCase();
      const response = await fetch('/api/rooms', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${profile.displayName}'s room`,
          slug: generatedId,
          accessMode: 'open',
          voiceEnabled: false,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.room?.slug) {
        throw new Error(payload.error || 'We could not create the room. Please try again.');
      }
      onJoinRoom(payload.room.slug);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'We could not create the room. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinRoom = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!roomCode.trim()) {
      setError('Enter a room code to join an existing room.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const normalizedRoomCode = roomCode.trim().toLowerCase();
      const response = await fetch(`/api/rooms/${encodeURIComponent(normalizedRoomCode)}`, { credentials: 'include' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.room?.slug) {
        throw new Error(payload.error === 'rate_limited'
          ? 'Too many join attempts. Please wait a moment and try again.'
          : payload.error === 'not_found'
            ? 'That room could not be found. Check the code and try again.'
            : payload.error || 'We could not open that room. Please try again.');
      }
      onJoinRoom(payload.room.slug);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : 'We could not open that room. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="lobby-page">
      <header className="lobby-nav">
        <button className="home-brand lobby-home-link" type="button" onClick={() => setLocation('/')}>
          <span className="home-brand-mark">C</span>
          <span>Chalkboard</span>
        </button>
        <span className="lobby-nav-meta">{initialRoomId ? 'Invitation link' : 'New session'}</span>
      </header>

      <main className="lobby-main">
        <section className="lobby-intro" aria-labelledby="lobby-heading">
          <p className="home-eyebrow"><span className="home-eyebrow-line" />Room access / 01</p>
          <h1 id="lobby-heading">
            {initialRoomId ? <>You are<br /><em>invited.</em></> : <>Start with a<br /><em>blank page.</em></>}
          </h1>
          <p className="lobby-intro-copy">
            {initialRoomId
              ? 'You have a room waiting for you. Add your name and step into the shared canvas.'
              : 'Open a live space for the next conversation, sketch, workshop, or wild idea.'}
          </p>
          <p className="lobby-annotation"><span />Everything is better when it is shared.</p>
        </section>

        <section className="lobby-panel" aria-labelledby="lobby-panel-heading">
          <p className="lobby-panel-kicker">{initialRoomId ? 'You are joining' : 'Create or join'}</p>
          <h2 id="lobby-panel-heading">Let&apos;s make some room.</h2>
          <p className="lobby-panel-copy">Your account is ready. Choose where you want to begin.</p>

          <div className="lobby-profile">
            {profile.avatarUrl ? (
              <img src={profile.avatarUrl} alt="" />
            ) : (
              <span className="lobby-profile-fallback">{profile.displayName.slice(0, 1).toUpperCase()}</span>
            )}
            <span className="lobby-profile-copy">
              <strong>{profile.displayName}</strong>
              <small>{profile.email}</small>
            </span>
            <button className="lobby-sign-out" type="button" onClick={() => { void signOut().then(() => setLocation('/login')); }} aria-label="Sign out">
              <LogOut size={15} strokeWidth={1.8} />
            </button>
          </div>

          <form className="lobby-form" onSubmit={initialRoomId ? handleJoinRoom : handleCreateRoom}>
            {initialRoomId ? (
              <div className="form-group">
                <label htmlFor="room-input">Room code</label>
                <input id="room-input" className="lobby-input" type="text" value={roomCode} disabled />
              </div>
            ) : (
              <>
                <button className="public-primary" type="submit">
                  {loading ? 'Creating room…' : 'Create a new room'} <ArrowUpRight size={15} strokeWidth={1.8} />
                </button>
                <div className="lobby-divider-text">or join an existing room</div>
                <div className="form-group">
                  <label htmlFor="code-input">Room code</label>
                  <input
                    id="code-input"
                    className="lobby-input"
                    type="text"
                    placeholder="Paste the room code"
                    value={roomCode}
                    onChange={(e) => {
                      setRoomCode(e.target.value);
                      setError('');
                    }}
                    autoComplete="off"
                  />
                </div>
                <button className="public-secondary" type="button" onClick={() => { void handleJoinRoom(); }} disabled={loading}>
                  {loading ? 'Opening room…' : 'Join the room'} <ArrowUpRight size={15} strokeWidth={1.8} />
                </button>
              </>
            )}

            {initialRoomId && (
              <div className="lobby-actions">
                <button className="public-primary" type="submit">
                  {loading ? 'Opening room…' : 'Enter shared room'} <ArrowUpRight size={15} strokeWidth={1.8} />
                </button>
              </div>
            )}

            {error && <p className="lobby-error" role="alert">{error}</p>}
          </form>
          <p className="lobby-panel-footnote"><LockKeyhole size={14} strokeWidth={1.7} /> Room links are private by default.</p>
        </section>
      </main>

      <footer className="lobby-footer">
        <span>Chalkboard / Shared thinking</span>
        <span>Back to <button className="lobby-home-link" type="button" onClick={() => setLocation('/')}>home</button></span>
      </footer>
    </div>
  );
};

export default Lobby;
