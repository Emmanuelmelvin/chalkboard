import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import UserAvatar from '@/components/UserAvatar';
import type { RoomMember } from '@/types';

interface RoomMembersModalProps {
  roomTitle: string;
  members: RoomMember[];
  peakAttendeeCount: number;
  onClose: () => void;
}

function roleLabel(role: RoomMember['role']) {
  if (role === 'owner') return 'Owner';
  if (role === 'instructor') return 'Editor';
  return 'Viewer';
}

export default function RoomMembersModal({ roomTitle, members, peakAttendeeCount, onClose }: RoomMembersModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onlineCount = members.filter((member) => member.online).length;

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
