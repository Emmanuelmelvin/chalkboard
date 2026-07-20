import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useLocation } from 'wouter';
import type { LobbyProps } from '@/types';
import '@/styles/PublicPages.css';

export const Lobby: React.FC<LobbyProps> = ({ initialRoomId, onJoinRoom }) => {
  const [roomCode, setRoomCode] = useState(initialRoomId?.trim() || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const attemptedUrlCode = useRef(false);
  const [, setLocation] = useLocation();

  const handleJoinRoom = useCallback(async (code = roomCode) => {
    const normalizedRoomCode = code.trim().toLowerCase();
    if (!normalizedRoomCode) {
      setError('Enter a room code to continue.');
      return;
    }

    setError('');
    setLoading(true);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(normalizedRoomCode)}`, {
        credentials: 'include',
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.room?.slug) {
        throw new Error(
          payload.error === 'rate_limited'
            ? 'Too many attempts. Please wait a moment and try again.'
            : payload.error === 'not_found'
              ? 'That room could not be found. Check the code and try again.'
              : payload.error === 'room_closed'
                ? 'That room has already been closed.'
                : payload.error || 'We could not open that room. Please try again.',
        );
      }

      onJoinRoom(payload.room.slug);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : 'We could not open that room. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [onJoinRoom, roomCode]);

  useEffect(() => {
    if (!initialRoomId || attemptedUrlCode.current) return;
    attemptedUrlCode.current = true;
    void handleJoinRoom(initialRoomId);
  }, [handleJoinRoom, initialRoomId]);

  return (
    <div className="lobby-simple-page">
      <main className="lobby-simple-shell">
        <button className="lobby-simple-brand" type="button" onClick={() => setLocation('/')}>
          <span className="lobby-simple-brand-mark">C</span>
          <span>Chalkboard</span>
        </button>

        <section className="lobby-simple-card" aria-labelledby="lobby-heading">
          <p className="lobby-simple-kicker">Shared room</p>
          <h1 id="lobby-heading">Enter a room code.</h1>
          <p className="lobby-simple-copy">Paste the code you were given to open the shared canvas.</p>

          <form
            className="lobby-simple-form"
            onSubmit={(event) => {
              event.preventDefault();
              void handleJoinRoom();
            }}
          >
            <label htmlFor="lobby-room-code">Room code</label>
            <div className="lobby-simple-input-row">
              <input
                id="lobby-room-code"
                className="lobby-simple-input"
                type="text"
                value={roomCode}
                onChange={(event) => {
                  setRoomCode(event.target.value);
                  setError('');
                }}
                placeholder="e.g. field-notes"
                autoComplete="off"
                autoFocus={!initialRoomId}
                aria-describedby={error ? 'lobby-error' : undefined}
              />
              <button className="lobby-simple-submit" type="submit" disabled={loading || !roomCode.trim()}>
                {loading ? 'Opening…' : 'Enter'} <ArrowUpRight size={16} strokeWidth={1.9} />
              </button>
            </div>
            {error && <p id="lobby-error" className="lobby-simple-error" role="alert">{error}</p>}
          </form>

          <button className="lobby-simple-back" type="button" onClick={() => setLocation('/dashboard?tab=rooms')}>
            Back to your rooms
          </button>
        </section>

        <p className="lobby-simple-footer">Private spaces for shared thinking.</p>
      </main>
    </div>
  );
};

export default Lobby;
