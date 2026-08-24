import React, { useCallback } from 'react';
import type { TrackReference } from '@livekit/components-core';
import { VideoTrack, useLocalParticipant } from '@livekit/components-react';
import { Mic, MicOff, Monitor, MonitorOff, Pin, PinOff } from 'lucide-react';
import { useMediaControls } from '@/hooks/useMediaControls';
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

  const { localParticipant } = useLocalParticipant();
  const { isScreenShareEnabled, toggleScreenShare, canPublish } = useMediaControls();

  const handleToggleLocalMic = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!isLocal || !localParticipant) return;
      try {
        await localParticipant.setMicrophoneEnabled(isMicMuted);
      } catch {
        // Handled by room error listener
      }
    },
    [isLocal, localParticipant, isMicMuted],
  );

  const handleToggleScreenShare = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!isLocal) return;
      await toggleScreenShare();
    },
    [isLocal, toggleScreenShare],
  );

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

      {/* Top action bar: role badge on left, screen share + mic + pin on right */}
      <div className="video-tile-top-bar">
        {role ? (
          <span className={`video-tile-role-badge role-${role.toLowerCase()}`}>
            {role === 'owner' ? 'Owner' : role === 'instructor' ? 'Instructor' : role}
          </span>
        ) : (
          <span />
        )}

        <div className="video-tile-top-actions-group">
          {/* Screen Share control / status beside mic and pin */}
          {isLocal ? (
            <button
              type="button"
              className={`video-tile-action-btn video-tile-screen-btn${isScreenShareEnabled ? ' is-live' : ''}`}
              onClick={handleToggleScreenShare}
              disabled={!canPublish}
              title={isScreenShareEnabled ? 'Stop sharing screen' : 'Share your screen'}
              aria-label={isScreenShareEnabled ? 'Stop sharing screen' : 'Share screen'}
            >
              {isScreenShareEnabled ? <MonitorOff size={12} /> : <Monitor size={12} />}
            </button>
          ) : participant.isScreenShareEnabled ? (
            <span className="video-tile-status-icon screen-sharing" title="Sharing screen">
              <Monitor size={12} />
            </span>
          ) : null}

          {/* Mic status / control beside Pin icon */}
          {isLocal ? (
            <button
              type="button"
              className={`video-tile-action-btn video-tile-mic-btn${isMicMuted ? ' is-muted' : ' is-live'}`}
              onClick={handleToggleLocalMic}
              title={isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
              aria-label={isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
            >
              {isMicMuted ? <MicOff size={12} /> : <Mic size={12} />}
            </button>
          ) : isMicMuted ? (
            <span className="video-tile-status-icon mic-muted" title="Microphone muted">
              <MicOff size={12} />
            </span>
          ) : (
            <span className="video-tile-status-icon mic-active" title="Microphone on">
              <Mic size={12} />
            </span>
          )}

          {/* Pin button */}
          {onTogglePin && (
            <button
              type="button"
              className={`video-tile-action-btn${isPinned ? ' is-pinned' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin();
              }}
              title={isPinned ? 'Unpin video (allow moving)' : 'Pin video (lock in place)'}
              aria-label={isPinned ? 'Unpin video' : 'Pin video'}
            >
              {isPinned ? <PinOff size={12} /> : <Pin size={12} />}
            </button>
          )}
        </div>
      </div>

      {/* Bottom info bar: name */}
      <div className="video-tile-info">
        <span className="video-tile-name" title={displayName}>
          {displayName}
        </span>
      </div>
    </div>
  );
};

export default ParticipantVideoTile;
