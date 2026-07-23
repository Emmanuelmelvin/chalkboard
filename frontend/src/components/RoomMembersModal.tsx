import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import UserAvatar from '@/components/UserAvatar';
import type { RoomMember } from '@/types';
import { useJoinRequestsQuery, useResolveJoinRequestMutation } from '@/api/hooks';

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
  const requestsQuery = useJoinRequestsQuery(roomSlug, canManageRequests);
  const resolveRequestMutation = useResolveJoinRequestMutation();
  const requests = requestsQuery.data?.requests ?? [];
  const requestsLoading = requestsQuery.isLoading || requestsQuery.isFetching;
  const [requestAction, setRequestAction] = useState<string | null>(null);
  const [requestError, setRequestError] = useState('');

  const resolveRequest = async (request: typeof requests[number], decision: 'approve' | 'deny') => {
    const actionKey = `${decision}:${request.userId}`;
    setRequestAction(actionKey);
    setRequestError('');
    try {
      await resolveRequestMutation.mutateAsync({ slug: roomSlug, userId: request.userId, decision });
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
            {(requestError || requestsQuery.error) && <p className="app-modal-field-error" role="alert">{requestError || (requestsQuery.error instanceof Error ? requestsQuery.error.message : 'We could not load join requests.')}</p>}
            <div className={`dashboard-members-modal-list${requests.length === 0 ? ' dashboard-members-modal-list-empty' : ''}`} role="list" aria-label="Pending join requests">
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
