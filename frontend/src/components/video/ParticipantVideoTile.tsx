import React from 'react';
import type { TrackReference } from '@livekit/components-core';
import { VideoTrack } from '@livekit/components-react';
import { MicOff, Pin, PinOff } from 'lucide-react';
import UserAvatar from '@/components/UserAvatar';

export interface ParticipantVideoTileProps {
  trackRef: TrackReference;
  isPinned?: boolean;
  onTogglePin?: () => void;
  role?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const ParticipantVideoTile: React.FC<ParticipantVideoTileProps> = ({
  trackRef,
  isPinned = false,
  onTogglePin,
  role,
  className = '',
  style,
}) => {
  const { participant } = trackRef;
  const isLocal = participant.isLocal;
  const isSpeaking = participant.isSpeaking;
  const isMicMuted = !participant.isMicrophoneEnabled;
  const isVideoMuted = trackRef.publication?.isMuted ?? false;
  const displayName = `${participant.name || participant.identity || 'Participant'}${isLocal ? ' (You)' : ''}`;

  return (
    <div
      className={`video-tile${isSpeaking ? ' is-speaking' : ''}${isPinned ? ' is-pinned' : ''} ${className}`}
      style={style}
    >
      {!isVideoMuted ? (
        <VideoTrack
          trackRef={trackRef}
          className={`video-track-element${isLocal ? ' mirror-video' : ''}`}
        />
      ) : (
        <div className="video-tile-fallback">
          <UserAvatar name={participant.name || 'Participant'} size="md" />
        </div>
      )}

      {/* Top action bar: pin / unpin & optional role badge */}
      <div className="video-tile-top-bar">
        {role && (
          <span className={`video-tile-role-badge role-${role.toLowerCase()}`}>
            {role === 'owner' ? 'Owner' : role === 'instructor' ? 'Instructor' : role}
          </span>
        )}
        {onTogglePin && (
          <button
            type="button"
            className="video-tile-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
            }}
            title={isPinned ? 'Unpin video' : 'Pin video'}
            aria-label={isPinned ? 'Unpin video' : 'Pin video'}
          >
            {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
          </button>
        )}
      </div>

      {/* Bottom info bar: name & mic status */}
      <div className="video-tile-info">
        <span className="video-tile-name" title={displayName}>
          {displayName}
        </span>
        {isMicMuted && (
          <span className="video-tile-mic-muted" title="Muted">
            <MicOff size={11} />
          </span>
        )}
      </div>
    </div>
  );
};

export default ParticipantVideoTile;
