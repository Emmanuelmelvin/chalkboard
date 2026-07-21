import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useLocation } from 'wouter';
import ConfirmModal from '@/components/ui/ConfirmModal';
import type { LobbyProps } from '@/types';
import '@/styles/PublicPages.css';

interface PendingPrivateRoom {
  slug: string;
  title: string;
  description?: string | null;
}

type ApprovalState = 'pending' | 'denied';

export const Lobby: React.FC<LobbyProps> = ({ initialRoomId, onJoinRoom }) => {
  const [roomCode, setRoomCode] = useState(initialRoomId?.trim() || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [roomPassword, setRoomPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [pendingPrivateRoom, setPendingPrivateRoom] = useState<PendingPrivateRoom | null>(null);
  const [approvalRoom, setApprovalRoom] = useState<PendingPrivateRoom | null>(null);
  const [approvalState, setApprovalState] = useState<ApprovalState | null>(null);
  const attemptedUrlCode = useRef(false);
  const approvalPollInFlight = useRef(false);
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!approvalRoom || approvalState !== 'pending') return;
    let active = true;

    const checkApprovalStatus = async () => {
      if (!active || approvalPollInFlight.current) return;
      approvalPollInFlight.current = true;
      try {
        const response = await fetch(`/api/rooms/${encodeURIComponent(approvalRoom.slug)}/join`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const payload = await response.json().catch(() => ({}));
        if (!active) return;

        if (response.ok && payload.ok === true) {
          setApprovalRoom(null);
          setApprovalState(null);
          onJoinRoom(approvalRoom.slug);
        } else if (payload.error === 'join_denied' || payload.requestStatus === 'denied') {
          setApprovalState('denied');
        }
      } catch {
        // Keep the request screen active and retry transient network failures.
      } finally {
        approvalPollInFlight.current = false;
      }
    };

    const pollTimer = window.setInterval(() => { void checkApprovalStatus(); }, 2000);
    return () => {
      active = false;
      window.clearInterval(pollTimer);
      approvalPollInFlight.current = false;
    };
  }, [approvalRoom, approvalState, onJoinRoom]);

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

      if (payload.room.accessMode === 'password_protected') {
        setRoomPassword('');
        setPasswordError('');
        setPendingPrivateRoom({
          slug: payload.room.slug,
          title: payload.room.title || 'Private room',
          description: payload.room.description,
        });
        return;
      }

      if (payload.room.accessMode === 'approval_required') {
        const approvalResponse = await fetch(`/api/rooms/${encodeURIComponent(payload.room.slug)}/join`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const approvalPayload = await approvalResponse.json().catch(() => ({}));
        if (approvalResponse.ok && approvalPayload.ok === true) {
          onJoinRoom(payload.room.slug);
          return;
        }

        const room = {
          slug: payload.room.slug,
          title: payload.room.title || 'Approval-required room',
          description: payload.room.description,
        };
        if (approvalPayload.error === 'approval_required' || approvalPayload.requestStatus === 'pending') {
          setApprovalRoom(room);
          setApprovalState('pending');
          return;
        }
        if (approvalPayload.error === 'join_denied' || approvalPayload.requestStatus === 'denied') {
          setApprovalRoom(room);
          setApprovalState('denied');
          return;
        }
        throw new Error(approvalPayload.error || 'We could not request access to that room.');
      }

      onJoinRoom(payload.room.slug);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : 'We could not open that room. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [onJoinRoom, roomCode]);

  const closePasswordModal = () => {
    setPendingPrivateRoom(null);
    setRoomPassword('');
    setPasswordError('');
  };

  const handlePrivateRoomJoin = async () => {
    if (!pendingPrivateRoom) return;
    const password = roomPassword.trim();
    if (!password) {
      setPasswordError('Enter the password shared by the room owner.');
      return;
    }

    setPasswordError('');
    setLoading(true);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(pendingPrivateRoom.slug)}/join`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error === 'bad_password'
          ? 'That password is not correct.'
          : payload.error === 'room_closed'
            ? 'That room has already been closed.'
            : payload.error || 'We could not verify the room password.');
      }
      const slug = pendingPrivateRoom.slug;
      closePasswordModal();
      onJoinRoom(slug, password);
    } catch (joinError) {
      setPasswordError(joinError instanceof Error ? joinError.message : 'We could not verify the room password.');
    } finally {
      setLoading(false);
    }
  };

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
                  setApprovalRoom(null);
                  setApprovalState(null);
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

          {approvalRoom && approvalState && (
            <div className="lobby-simple-approval-state" role="status" aria-live="polite">
              <p className="lobby-simple-kicker">{approvalState === 'pending' ? 'Request sent' : 'Access denied'}</p>
              <p className={approvalState === 'denied' ? 'lobby-simple-error' : 'lobby-simple-copy'}>
                {approvalState === 'pending'
                  ? `Your request to join “${approvalRoom.title}” is waiting for an instructor or owner to approve it.`
                  : `Your request to join “${approvalRoom.title}” was denied by an instructor or owner.`}
              </p>
              {approvalState === 'pending' ? (
                <div className="lobby-approval-waiting">
                  <div className="lobby-approval-progress" role="progressbar" aria-label="Waiting for owner approval" aria-valuetext="Checking automatically">
                    <span />
                  </div>
                  <span>Checking automatically until the owner responds...</span>
                </div>
              ) : (
                <button
                  className="lobby-simple-back"
                  type="button"
                  onClick={() => {
                    setRoomCode('');
                    setApprovalRoom(null);
                    setApprovalState(null);
                  }}
                >
                  Try another room
                </button>
              )}
            </div>
          )}

          <button className="lobby-simple-back" type="button" onClick={() => setLocation('/dashboard?tab=rooms')}>
            Back to your rooms
          </button>
        </section>

        <p className="lobby-simple-footer">Private spaces for shared thinking.</p>
      </main>
      {pendingPrivateRoom && (
        <ConfirmModal
          title="Private room"
          message={`Enter the password shared by the owner to join “${pendingPrivateRoom.title}”.`}
          confirmLabel={loading ? 'Checking…' : 'Enter room'}
          variant="dashboard"
          confirmDisabled={loading || !roomPassword.trim()}
          onCancel={closePasswordModal}
          onConfirm={() => { void handlePrivateRoomJoin(); }}
        >
          {pendingPrivateRoom.description && <p className="lobby-password-description">{pendingPrivateRoom.description}</p>}
          <div className="app-modal-input-group">
            <label htmlFor="private-room-password">Room password</label>
            <input
              id="private-room-password"
              className="app-modal-input"
              type="password"
              value={roomPassword}
              onChange={(event) => {
                setRoomPassword(event.target.value);
                setPasswordError('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && roomPassword.trim()) void handlePrivateRoomJoin();
              }}
              autoFocus
              autoComplete="current-password"
              aria-describedby={passwordError ? 'private-room-password-error' : undefined}
            />
          </div>
          {passwordError && <p id="private-room-password-error" className="app-modal-field-error" role="alert">{passwordError}</p>}
        </ConfirmModal>
      )}
    </div>
  );
};

export default Lobby;
