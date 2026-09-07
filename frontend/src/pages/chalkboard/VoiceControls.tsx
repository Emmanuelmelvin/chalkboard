import React, { useEffect, useMemo, useContext, useRef } from 'react';
import { Mic, MicOff, Video, VideoOff, WifiOff, UserPlus, UserX, LogOut } from 'lucide-react';
import { HoverCard } from '@/components/ui/HoverCard';
import UserAvatar from '@/components/UserAvatar';
import { SpeakingParticipantsContext } from '@/contexts/SpeakingParticipantsContext';
import { useLoggerStore } from '@/stores/loggerStore';
import { useLocalParticipant, useMaybeRoomContext, useParticipants, useSpeakingParticipants } from '@livekit/components-react';
import { useMediaControls } from '@/hooks/useMediaControls';
import { getVoiceToken } from '@/api/rooms';

export function VoiceAudioStarter() {
  const room = useMaybeRoomContext();

  useEffect(() => {
    if (!room) return;
    const unlockAudio = () => {
      if (room && !room.canPlaybackAudio) {
        void room.startAudio().catch(() => { });
      }
    };

    window.addEventListener('click', unlockAudio, { capture: true, passive: true });
    window.addEventListener('touchstart', unlockAudio, { capture: true, passive: true });
    window.addEventListener('pointerdown', unlockAudio, { capture: true, passive: true });

    return () => {
      window.removeEventListener('click', unlockAudio, { capture: true });
      window.removeEventListener('touchstart', unlockAudio, { capture: true });
      window.removeEventListener('pointerdown', unlockAudio, { capture: true });
    };
  }, [room]);

  return null;
}

export function SpeakingParticipantsProvider({ children }: { children: React.ReactNode }) {
  const speakingParticipants = useSpeakingParticipants();
  const speakingIdentities = useMemo(
    () => new Set(speakingParticipants.map((participant) => participant.identity)),
    [speakingParticipants],
  );

  return (
    <SpeakingParticipantsContext.Provider value={speakingIdentities}>
      {children}
    </SpeakingParticipantsContext.Provider>
  );
}

export function RoomMemberAvatar({ userId, name, avatarUrl }: { userId: string; name: string; avatarUrl?: string | null }) {
  const speakingIdentities = useContext(SpeakingParticipantsContext);
  const isSpeaking = speakingIdentities.has(userId);
  return (
    <UserAvatar
      name={name}
      avatarUrl={avatarUrl}
      size="sm"
      className={`room-member-avatar${isSpeaking ? ' collaborator-avatar-speaking' : ''}`}
    />
  );
}

export function avatarInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'C';
}

export type RaisedHand = { userId: string; raisedAt: number };
export type ActiveReaction = { id: string; userId: string; emoji: string; at: number; lane: number };

export type PendingJoinRequest = {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  avatarUrl?: string | null;
};

export interface RoomMemberVoiceControlsProps {
  memberUserId: string;
  effectiveRole: string;
  currentUserId: string;
  socket: unknown;
  roomId: string;
  voiceEnabled?: boolean;
  /** Whether the member row is currently online */
  isOnline: boolean;
  /** Display name of the member (used in disabled tooltips) */
  memberName: string;
  /** Whether the voice call itself is connected */
  voiceConnected: boolean;
}

export function RoomHeaderMediaControls({
  voiceConnected,
}: {
  voiceConnected: boolean;
}) {
  const room = useMaybeRoomContext();
  const {
    isCameraEnabled,
    canPublish,
    toggleCamera,
  } = useMediaControls();

  if (!voiceConnected || !room) return null;

  return (
    <div className="room-media-header-controls">
      <HoverCard
        content={!canPublish ? 'Camera is disabled for listeners' : (isCameraEnabled ? 'Turn off camera' : 'Turn on camera')}
        placement="below"
      >
        <button
          type="button"
          className={`voice-action-btn header-media-btn${isCameraEnabled ? ' is-active' : ''}`}
          onClick={toggleCamera}
          disabled={!canPublish}
          aria-label={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
        >
          {isCameraEnabled ? <Video size={14} /> : <VideoOff size={14} />}
        </button>
      </HoverCard>
    </div>
  );
}

export function VoiceRoleSync({
  effectiveRole,
  roomId,
  setVoiceToken,
  setVoiceUrl,
  voiceSwappingRef,
}: {
  effectiveRole: string;
  roomId: string;
  setVoiceToken: (token: string) => void;
  setVoiceUrl: (token: string) => void;
  voiceSwappingRef: React.MutableRefObject<boolean>;
}) {
  const { localParticipant } = useLocalParticipant();
  const prevRoleRef = useRef(effectiveRole);

  useEffect(() => {
    const prevRole = prevRoleRef.current;
    prevRoleRef.current = effectiveRole;
    if (prevRole === effectiveRole) return;

    if (effectiveRole === 'viewer') {
      // User was demoted to Viewer: unpublish camera, mic, and screen share immediately
      void localParticipant?.setCameraEnabled(false).catch(() => { });
      void localParticipant?.setMicrophoneEnabled(false).catch(() => { });
      void localParticipant?.setScreenShareEnabled(false).catch(() => { });

      // Refresh token with viewer permissions
      voiceSwappingRef.current = true;
      void getVoiceToken(roomId).then((res) => {
        if (res.token && res.url) {
          setVoiceToken(res.token);
          setVoiceUrl(res.url);
        }
      }).finally(() => {
        voiceSwappingRef.current = false;
      });
    } else if (effectiveRole === 'instructor') {
      // User was promoted to Editor: refresh token so publishing is immediately enabled
      voiceSwappingRef.current = true;
      void getVoiceToken(roomId).then((res) => {
        if (res.token && res.url) {
          setVoiceToken(res.token);
          setVoiceUrl(res.url);
        }
      }).finally(() => {
        voiceSwappingRef.current = false;
      });
    }
  }, [effectiveRole, localParticipant, roomId, setVoiceToken, setVoiceUrl, voiceSwappingRef]);

  return null;
}

export function voiceDisabledReason({ voiceConnected, isOnline, memberName }: RoomMemberVoiceControlsProps): string | null {
  if (!isOnline) return `${memberName} is offline`;
  if (!voiceConnected) return 'Voice call is not connected';
  return null;
}

export function RoomMemberVoiceControlsConnected({ memberUserId, effectiveRole, currentUserId, socket, roomId, isOnline, memberName, voiceConnected }: RoomMemberVoiceControlsProps) {
  const room = useMaybeRoomContext();
  const participants = useParticipants();
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();

  const participant = participants.find((candidate) => candidate.identity === memberUserId);
  const canSpeak = participant?.permissions?.canPublish === true;

  const isMe = memberUserId === currentUserId;
  const isOwner = effectiveRole === 'owner';

  const toggleMute = () => {
    if (room && !room.canPlaybackAudio) {
      void room.startAudio().catch(() => { });
    }
    if (localParticipant) {
      void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled).catch(() => {
        useLoggerStore.getState().notify('Microphone access was blocked. Check your browser permissions and try again.', 'error', 6000);
      });
    }
  };

  const inviteUser = () => {
    (socket as { emit: (event: string, payload: unknown, ack?: unknown) => void })?.emit('voice:invite', { roomId, targetUserId: memberUserId }, (res: { ok?: boolean; error?: string }) => {
      if (res && !res.ok) console.error('Failed to invite to voice:', res.error);
    });
  };

  const removeUser = () => {
    (socket as { emit: (event: string, payload: unknown, ack?: unknown) => void })?.emit('voice:remove', { roomId, targetUserId: memberUserId }, (res: { ok?: boolean; error?: string }) => {
      if (res && !res.ok) console.error('Failed to remove from voice:', res.error);
    });
  };

  const disabledReason = voiceDisabledReason({ voiceConnected, isOnline, memberName, memberUserId, effectiveRole, currentUserId, socket, roomId });
  const voiceDisabled = Boolean(disabledReason);

  if (isMe) {
    if (localParticipant && (isOwner || canSpeak)) {
      return (
        <div className="voice-actions-group">
          <HoverCard content={disabledReason || (isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone')} placement="top">
            <span className={`voice-action-wrap${voiceDisabled ? ' is-disabled' : ''}`}>
              <button
                type="button"
                className="voice-action-btn"
                onClick={toggleMute}
                disabled={voiceDisabled}
                aria-label={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
              >
                {voiceDisabled ? <WifiOff size={14} /> : (isMicrophoneEnabled ? <Mic size={14} /> : <MicOff size={14} />)}
              </button>
            </span>
          </HoverCard>
          {!isOwner && (
            <HoverCard content="Leave voice" placement="top">
              <button type="button" className="voice-action-btn" onClick={removeUser} aria-label="Leave voice">
                <LogOut size={14} />
              </button>
            </HoverCard>
          )}
        </div>
      );
    }
    return null;
  }

  if (isOwner) {
    if (canSpeak) {
      return (
        <div className="voice-actions-group">
          <HoverCard content={disabledReason || 'Remove from video & voice'} placement="top">
            <span className={`voice-action-wrap${voiceDisabled ? ' is-disabled' : ''}`}>
              <button
                type="button"
                className="voice-action-btn"
                onClick={removeUser}
                disabled={voiceDisabled}
                aria-label="Remove from video & voice"
              >
                {voiceDisabled ? <WifiOff size={14} /> : <UserX size={14} />}
              </button>
            </span>
          </HoverCard>
        </div>
      );
    }
    return (
      <div className="voice-actions-group">
        <HoverCard content={disabledReason || 'Invite to video & voice'} placement="top">
          <span className={`voice-action-wrap${voiceDisabled ? ' is-disabled' : ''}`}>
            <button
              type="button"
              className="voice-action-btn"
              onClick={inviteUser}
              disabled={voiceDisabled}
              aria-label="Invite to video & voice"
            >
              {voiceDisabled ? <WifiOff size={14} /> : <UserPlus size={14} />}
            </button>
          </span>
        </HoverCard>
      </div>
    );
  }

  return null;
}

export function RoomMemberVoiceControls(props: RoomMemberVoiceControlsProps) {
  const room = useMaybeRoomContext();
  if (!props.voiceEnabled) return null;

  if (!room) {
    const isMe = props.memberUserId === props.currentUserId;
    const isOwner = props.effectiveRole === 'owner';

    if (isOwner && !isMe) {
      const disabledReason = voiceDisabledReason(props);
      return (
        <div className="voice-actions-group">
          <HoverCard content={disabledReason || 'Invite to video & voice'} placement="top">
            <span className={`voice-action-wrap${disabledReason ? ' is-disabled' : ''}`}>
              <button
                type="button"
                className="voice-action-btn"
                aria-label="Invite to video & voice"
                disabled={Boolean(disabledReason)}
                onClick={() => {
                  (props.socket as { emit: (event: string, payload: unknown, ack?: unknown) => void })?.emit('voice:invite', { roomId: props.roomId, targetUserId: props.memberUserId }, (res: { ok?: boolean; error?: string }) => {
                    if (res && !res.ok) console.error('Failed to invite to voice:', res.error);
                  });
                }}
              >
                {disabledReason ? <WifiOff size={14} /> : <UserPlus size={14} />}
              </button>
            </span>
          </HoverCard>
        </div>
      );
    }
    return null;
  }

  return <RoomMemberVoiceControlsConnected {...props} />;
}

