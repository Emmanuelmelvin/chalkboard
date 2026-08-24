import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Track } from 'livekit-client';
import { useTracks } from '@livekit/components-react';
import type { TrackReference } from '@livekit/components-core';
import type { RoomMember } from '@/types';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Video,
  Minimize2,
  X,
  Move,
  Pin,
} from 'lucide-react';
import ParticipantVideoTile from './ParticipantVideoTile';
import ScreenShareViewer from './ScreenShareViewer';

export interface VideoStageProps {
  members?: RoomMember[];
  className?: string;
}

type StageMode = 'docked' | 'bubble' | 'minimized';

export const VideoStage: React.FC<VideoStageProps> = ({ members = [], className = '' }) => {
  // Query all active camera and screen share tracks
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare], {
    onlySubscribed: false,
  });

  const cameraTracks = useMemo(
    () => tracks.filter((t): t is TrackReference => t.source === Track.Source.Camera),
    [tracks],
  );

  const screenShareTracks = useMemo(
    () => tracks.filter((t): t is TrackReference => t.source === Track.Source.ScreenShare),
    [tracks],
  );

  const totalVideoCount = cameraTracks.length + screenShareTracks.length;

  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= 768;
  });

  const [mode, setMode] = useState<StageMode>(() => (isMobile ? 'bubble' : 'docked'));
  const [mobileExpanded, setMobileExpanded] = useState<boolean>(false);
  const [pinnedIdentity, setPinnedIdentity] = useState<string | null>(null);

  // Position state for floating container
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number; posX: number; posY: number }>({
    x: 0,
    y: 0,
    posX: 0,
    posY: 0,
  });

  // Track viewport size changes
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Find active speaker or pinned participant
  const activeSpeakerTrack = useMemo(() => {
    if (cameraTracks.length === 0) return null;
    if (pinnedIdentity) {
      const pinned = cameraTracks.find((t) => t.participant.identity === pinnedIdentity);
      if (pinned) return pinned;
    }
    const speaking = cameraTracks.find((t) => t.participant.isSpeaking);
    if (speaking) return speaking;
    // Fall back to first non-local speaker or first camera
    return cameraTracks.find((t) => !t.participant.isLocal) || cameraTracks[0];
  }, [cameraTracks, pinnedIdentity]);

  const getMemberRole = useCallback(
    (identity: string) => {
      const member = members.find((m) => m.userId === identity);
      return member?.role;
    },
    [members],
  );

  // Drag handlers for desktop / floating widget
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // If a participant is pinned, lock position in place and disable dragging!
      if (pinnedIdentity) return;
      // Don't drag if clicking buttons
      if ((e.target as HTMLElement).closest('button, select, input, a')) return;
      isDraggingRef.current = true;
      const clientX = e.clientX;
      const clientY = e.clientY;

      const currentX = position?.x ?? (window.innerWidth - 240);
      const currentY = position?.y ?? 70;

      dragStartRef.current = {
        x: clientX,
        y: clientY,
        posX: currentX,
        posY: currentY,
      };

      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [position, pinnedIdentity],
  );

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const deltaX = e.clientX - dragStartRef.current.x;
    const deltaY = e.clientY - dragStartRef.current.y;

    const newX = Math.max(10, Math.min(window.innerWidth - 120, dragStartRef.current.posX + deltaX));
    const newY = Math.max(60, Math.min(window.innerHeight - 80, dragStartRef.current.posY + deltaY));

    setPosition({ x: newX, y: newY });
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = false;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  }, []);

  // If no video or screen share is active, render nothing
  if (totalVideoCount === 0) {
    return null;
  }

  // MINIMIZED PILL MODE
  if (mode === 'minimized') {
    return (
      <div className="video-stage-root" style={{ pointerEvents: 'none' }}>
        <button
          type="button"
          className="video-minimized-pill"
          style={{ pointerEvents: 'auto' }}
          onClick={() => setMode(isMobile ? 'bubble' : 'docked')}
          title="Open video stage"
          aria-label={`Open video stage (${totalVideoCount} videos)`}
        >
          <Video size={13} />
          <span>{totalVideoCount} {totalVideoCount === 1 ? 'video' : 'videos'}</span>
        </button>
      </div>
    );
  }

  // MOBILE BUBBLE MODE (Draggable floating PiP on mobile with Radix Dialog sheet)
  if (isMobile && mode === 'bubble') {
    return (
      <div className="video-stage-root" style={{ pointerEvents: 'none' }}>
        {/* Mobile floating bubble */}
        <div
          className="mobile-pip-bubble"
          style={{
            pointerEvents: 'auto',
            left: position ? `${position.x}px` : undefined,
            top: position ? `${position.y}px` : undefined,
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onClick={() => setMobileExpanded(true)}
          role="button"
          tabIndex={0}
          aria-label="Expand video view"
        >
          {activeSpeakerTrack ? (
            <ParticipantVideoTile
              trackRef={activeSpeakerTrack}
              className="mobile-pip-tile"
            />
          ) : screenShareTracks[0] ? (
            <ScreenShareViewer
              trackRef={screenShareTracks[0]}
              className="mobile-pip-screenshare"
            />
          ) : null}

          {totalVideoCount > 1 && (
            <span className="mobile-pip-badge">+{totalVideoCount - 1}</span>
          )}
        </div>

        {/* Mobile Expanded Sheet using Radix Dialog */}
        <Dialog.Root open={mobileExpanded} onOpenChange={setMobileExpanded}>
          <Dialog.Portal>
            <Dialog.Overlay className="mobile-video-sheet-overlay" style={{ pointerEvents: 'auto' }}>
              <Dialog.Content className="mobile-video-sheet" aria-describedby={undefined}>
                <div className="mobile-video-sheet-header">
                  <Dialog.Title className="mobile-video-sheet-title">
                    <Video size={15} />
                    <span>Room Video ({totalVideoCount})</span>
                  </Dialog.Title>
                  <div className="mobile-video-sheet-actions">
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="mobile-sheet-action-btn"
                        title="Close to bubble"
                        aria-label="Close to bubble"
                      >
                        <X size={16} />
                      </button>
                    </Dialog.Close>
                  </div>
                </div>

                {/* Screen shares first */}
                {screenShareTracks.map((trackRef) => (
                  <ScreenShareViewer
                    key={trackRef.publication?.trackSid || trackRef.participant.identity}
                    trackRef={trackRef}
                  />
                ))}

                {/* Cameras grid */}
                <div className="mobile-video-grid">
                  {cameraTracks.map((trackRef) => (
                    <ParticipantVideoTile
                      key={trackRef.publication?.trackSid || trackRef.participant.identity}
                      trackRef={trackRef}
                      role={getMemberRole(trackRef.participant.identity)}
                      isPinned={pinnedIdentity === trackRef.participant.identity}
                      onTogglePin={() =>
                        setPinnedIdentity((current) =>
                          current === trackRef.participant.identity ? null : trackRef.participant.identity,
                        )
                      }
                    />
                  ))}
                </div>
              </Dialog.Content>
            </Dialog.Overlay>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    );
  }

  // DESKTOP FLOATING DOCK MODE
  return (
    <div className={`video-stage-root ${className}`} style={{ pointerEvents: 'none' }}>
      <div
        className="video-stage-card"
        style={{
          pointerEvents: 'auto',
          left: position ? `${position.x}px` : undefined,
          top: position ? `${position.y}px` : undefined,
        }}
      >
        {/* Stage Header / Drag Handle */}
        <div
          className={`video-stage-header${pinnedIdentity ? ' is-locked' : ''}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          title={pinnedIdentity ? 'Pinned in place (unpin video to move)' : 'Drag to reposition'}
        >
          <div className="video-stage-handle">
            {pinnedIdentity ? (
              <Pin size={12} className="drag-handle-icon pinned-icon" />
            ) : (
              <Move size={12} className="drag-handle-icon" />
            )}
            <span className="video-stage-title">
              Video ({cameraTracks.length}) {pinnedIdentity ? '• Pinned' : ''}
            </span>
          </div>

          <div className="video-stage-controls">
            {isMobile && (
              <button
                type="button"
                className="video-stage-btn"
                onClick={() => setMode('bubble')}
                title="Switch to floating bubble"
                aria-label="Switch to bubble mode"
              >
                <Minimize2 size={12} />
              </button>
            )}
            <button
              type="button"
              className="video-stage-btn"
              onClick={() => {
                setPosition(null);
                setMode('minimized');
              }}
              title="Close video stage (minimize to pill)"
              aria-label="Close video stage"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Screen share section (prominent if present) */}
        {screenShareTracks.length > 0 && (
          <div className="video-stage-screenshares">
            {screenShareTracks.map((trackRef) => (
              <ScreenShareViewer
                key={trackRef.publication?.trackSid || trackRef.participant.identity}
                trackRef={trackRef}
              />
            ))}
          </div>
        )}

        {/* Camera tiles strip / grid */}
        {cameraTracks.length > 0 && (
          <div
            className={`video-tiles-container${
              cameraTracks.length > 1 ? ' multi-tile' : ''
            }`}
          >
            {cameraTracks.map((trackRef) => (
              <ParticipantVideoTile
                key={trackRef.publication?.trackSid || trackRef.participant.identity}
                trackRef={trackRef}
                role={getMemberRole(trackRef.participant.identity)}
                isPinned={pinnedIdentity === trackRef.participant.identity}
                onTogglePin={() =>
                  setPinnedIdentity((current) =>
                    current === trackRef.participant.identity ? null : trackRef.participant.identity,
                  )
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoStage;
