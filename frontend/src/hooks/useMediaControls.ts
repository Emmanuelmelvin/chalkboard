import { useCallback } from 'react';
import { useLocalParticipant, useMaybeRoomContext } from '@livekit/components-react';
import { useLoggerStore } from '@/stores/loggerStore';

export interface MediaControls {
  localParticipant: ReturnType<typeof useLocalParticipant>['localParticipant'];
  isMicrophoneEnabled: boolean;
  isCameraEnabled: boolean;
  isScreenShareEnabled: boolean;
  canPublish: boolean;
  toggleMicrophone: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
}

export function useMediaControls(): MediaControls {
  const room = useMaybeRoomContext();
  const {
    localParticipant,
    isMicrophoneEnabled,
    isCameraEnabled,
    isScreenShareEnabled,
  } = useLocalParticipant();

  const canPublish = localParticipant?.permissions?.canPublish ?? false;

  const toggleMicrophone = useCallback(async () => {
    if (!localParticipant) return;
    if (room && !room.canPlaybackAudio) {
      void room.startAudio().catch(() => {});
    }

    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
    } catch (error) {
      console.error('Failed to toggle microphone:', error);
      useLoggerStore
        .getState()
        .notify('Microphone access was blocked. Check your browser permissions and try again.', 'error', 6000);
    }
  }, [localParticipant, isMicrophoneEnabled, room]);

  const toggleCamera = useCallback(async () => {
    if (!localParticipant) return;
    if (room && !room.canPlaybackAudio) {
      void room.startAudio().catch(() => {});
    }

    try {
      await localParticipant.setCameraEnabled(!isCameraEnabled);
    } catch (error) {
      console.error('Failed to toggle camera:', error);
      useLoggerStore
        .getState()
        .notify('Camera access was blocked. Check your browser permissions and try again.', 'error', 6000);
    }
  }, [localParticipant, isCameraEnabled, room]);

  const toggleScreenShare = useCallback(async () => {
    if (!localParticipant) return;

    try {
      await localParticipant.setScreenShareEnabled(!isScreenShareEnabled);
    } catch (error) {
      // User cancelling native screen share picker triggers an AbortError/NotAllowedError, which is normal
      if (error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError')) {
        return;
      }
      console.error('Failed to toggle screen share:', error);
      useLoggerStore
        .getState()
        .notify('Failed to share screen. Check your browser permissions and try again.', 'error', 6000);
    }
  }, [localParticipant, isScreenShareEnabled]);

  return {
    localParticipant,
    isMicrophoneEnabled,
    isCameraEnabled,
    isScreenShareEnabled,
    canPublish,
    toggleMicrophone,
    toggleCamera,
    toggleScreenShare,
  };
}
