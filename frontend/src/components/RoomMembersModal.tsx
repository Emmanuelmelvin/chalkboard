import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import UserAvatar from '@/components/UserAvatar';
import type { RoomMember } from '@/types';

interface RoomMembersModalProps {
  roomSlug: string;
  roomTitle: string;
  roomAccessMode: 'open' | 'approval_required' | 'password_protected';
  viewerRole: RoomMember['role'];
  members: RoomMember[];
  peakAttendeeCount: number;
  onRequestsChanged?: () => void;
  onClose: () => void;
}

interface JoinRequest {
  id: string;
  userId: string;
  status: 'pending';
  createdAt: string;
  displayName: string;
  email: string;
  avatarUrl?: string | null;
}

function roleLabel(role: RoomMember['role']) {
  if (role === 'owner') return 'Owner';
  if (role === 'instructor') return 'Editor';
  return 'Viewer';
}

export default function RoomMembersModal({
  roomSlug,
  roomTitle,
  roomAccessMode,
  viewerRole,
  members,
  peakAttendeeCount,
  onRequestsChanged,
  onClose,
}: RoomMembersModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onlineCount = members.filter((member) => member.online).length;
  const canManageRequests = roomAccessMode === 'approval_required' && (viewerRole === 'owner' || viewerRole === 'instructor');
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestAction, setRequestAction] = useState<string | null>(null);
  const [requestError, setRequestError] = useState('');

  const loadRequests = useCallback(async () => {
    if (!canManageRequests) {
      setRequests([]);
      return;
    }

    setRequestsLoading(true);
    setRequestError('');
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomSlug)}/join-requests`, { credentials: 'include' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(response.status === 403 ? 'Only room owners and instructors can review join requests.' : payload.error || 'We could not load join requests.');
      }
      setRequests(Array.isArray(payload.requests) ? payload.requests : []);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'We could not load join requests.');
    } finally {
      setRequestsLoading(false);
    }
  }, [canManageRequests, roomSlug]);

  useEffect(() => {
    const requestLoad = window.setTimeout(() => {
      void loadRequests();
    }, 0);
    return () => window.clearTimeout(requestLoad);
  }, [loadRequests]);

  const resolveRequest = async (request: JoinRequest, decision: 'approve' | 'deny') => {
    const actionKey = `${decision}:${request.userId}`;
    setRequestAction(actionKey);
    setRequestError('');
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomSlug)}/join-requests/${encodeURIComponent(request.userId)}/${decision}`, {
        method: 'POST',
        credentials: 'include',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `We could not ${decision} this request.`);
      setRequests((current) => current.filter((item) => item.userId !== request.userId));
      onRequestsChanged?.();
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : `We could not ${decision} this request.`);
    } finally {
      setRequestAction(null);
    }
  };

  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="app-modal-overlay app-modal-overlay-dashboard"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="app-modal app-modal-dashboard dashboard-members-modal" role="dialog" aria-modal="true" aria-labelledby="room-members-modal-title">
        <div className="app-modal-header">
          <div>
            <span className="dashboard-members-modal-kicker">Room members</span>
            <h2 id="room-members-modal-title">{roomTitle}</h2>
          </div>
          <button ref={closeButtonRef} className="app-modal-close" type="button" onClick={onClose} aria-label="Close room members">
            <X size={16} />
          </button>
        </div>
        <p className="dashboard-members-modal-copy">Everyone who has access to this room, with their latest role and current presence.</p>
        <div className="dashboard-members-modal-stats" aria-label="Room attendance summary">
          <div><strong>{members.length}</strong><span>Members</span></div>
          <div><strong>{onlineCount}</strong><span>Online now</span></div>
          <div><strong>{peakAttendeeCount}</strong><span>Peak attendance</span></div>
        </div>
        {roomAccessMode === 'approval_required' && canManageRequests && (
          <section aria-labelledby="room-join-requests-title">
            <div className="dashboard-members-modal-heading">
              <span className="dashboard-members-modal-kicker" id="room-join-requests-title">Pending join requests</span>
              <span>{requests.length}</span>
            </div>
            {requestError && <p className="app-modal-field-error" role="alert">{requestError}</p>}
            <div className="dashboard-members-modal-list" role="list" aria-label="Pending join requests">
              {requestsLoading ? (
                <p className="dashboard-members-modal-empty">Loading requests...</p>
              ) : requests.length === 0 ? (
                <p className="dashboard-members-modal-empty">No pending join requests.</p>
              ) : requests.map((request) => (
                <div className="dashboard-members-modal-row" key={request.id} role="listitem">
                  <UserAvatar name={request.displayName} avatarUrl={request.avatarUrl} size="sm" className="dashboard-members-modal-avatar" />
                  <div className="dashboard-members-modal-member-copy">
                    <strong>{request.displayName}</strong>
                    <small>{request.email}</small>
                  </div>
                  <div className="dashboard-room-copy-actions">
                    <button
                      className="dashboard-room-copy-button"
                      type="button"
                      onClick={() => { void resolveRequest(request, 'deny'); }}
                      disabled={Boolean(requestAction)}
                    >
                      {requestAction === `deny:${request.userId}` ? 'Denying...' : 'Deny'}
                    </button>
                    <button
                      className="dashboard-room-copy-button dashboard-room-password"
                      type="button"
                      onClick={() => { void resolveRequest(request, 'approve'); }}
                      disabled={Boolean(requestAction)}
                    >
                      {requestAction === `approve:${request.userId}` ? 'Approving...' : 'Approve'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        <div className="dashboard-members-modal-list" role="list" aria-label="Room members">
          {members.length === 0 ? (
            <p className="dashboard-members-modal-empty">No members have joined this room yet.</p>
          ) : members.map((member) => (
            <div className="dashboard-members-modal-row" key={member.userId} role="listitem">
              <UserAvatar name={member.displayName} avatarUrl={member.avatarUrl} size="sm" className="dashboard-members-modal-avatar" />
              <div className="dashboard-members-modal-member-copy">
                <strong>{member.displayName}</strong>
                <small>{member.email}</small>
              </div>
              <span className={`dashboard-member-presence${member.online ? ' is-online' : ''}`}>
                <span aria-hidden="true" />
                {member.online ? 'Online' : 'Offline'}
              </span>
              <span className={`dashboard-member-role dashboard-member-role-${member.role}`}>{roleLabel(member.role)}</span>
            </div>
          ))}
        </div>
        <div className="app-modal-actions">
          <button className="app-modal-confirm" type="button" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
