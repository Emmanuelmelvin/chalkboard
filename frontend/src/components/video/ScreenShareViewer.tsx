import React, { useState } from 'react';
import type { TrackReference } from '@livekit/components-core';
import { VideoTrack } from '@livekit/components-react';
import { Maximize2, Minimize2, Monitor, X } from 'lucide-react';

export interface ScreenShareViewerProps {
  trackRef: TrackReference;
  onClose?: () => void;
  className?: string;
}

export const ScreenShareViewer: React.FC<ScreenShareViewerProps> = ({
  trackRef,
  onClose,
  className = '',
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const presenterName = trackRef.participant.name || trackRef.participant.identity || 'Participant';
  const isLocal = trackRef.participant.isLocal;

  return (
    <div
      className={`screen-share-container${isFocused ? ' is-focused' : ''} ${className}`}
    >
      <div className="screen-share-header">
        <div className="screen-share-title">
          <Monitor size={14} className="screen-share-icon" />
          <span>{isLocal ? 'Your shared screen' : `${presenterName}'s screen`}</span>
        </div>
        <div className="screen-share-actions">
          <button
            type="button"
            className="screen-share-action-btn"
            onClick={() => setIsFocused((f) => !f)}
            title={isFocused ? 'Focus Board (Minimize Screen)' : 'Focus Screen (Expand Screen)'}
            aria-label={isFocused ? 'Focus Board' : 'Focus Screen'}
          >
            {isFocused ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          {onClose && (
            <button
              type="button"
              className="screen-share-action-btn"
              onClick={onClose}
              title="Hide screen preview"
              aria-label="Hide screen preview"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="screen-share-video-wrap">
        <VideoTrack trackRef={trackRef} className="screen-share-track-element" />
      </div>
    </div>
  );
};

export default ScreenShareViewer;
