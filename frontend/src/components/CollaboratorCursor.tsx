import React, { useContext, useState } from 'react';
import * as Avatar from '@radix-ui/react-avatar';
import { HoverCard } from '@/components/ui/HoverCard';
import { SpeakingParticipantsContext } from '@/contexts/SpeakingParticipantsContext';
import ChalkboardMasterIcon from '@/components/ChalkboardMasterIcon';
import type { Collaborator } from '@/types';

export interface CollaboratorCursorProps {
  id?: string;
  collaborator: Collaborator;
  x?: number;
  y?: number;
  isSpeaking?: boolean;
  isDefaultPosition?: boolean;
}

function shortenName(name: string, maxChars = 12): string {
  if (!name) return 'Collaborator';
  const trimmed = name.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, maxChars - 1) + '…';
}

function avatarInitials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || 'C'
  );
}

export const CollaboratorCursor: React.FC<CollaboratorCursorProps> = ({
  collaborator,
  x = 0,
  y = 0,
  isSpeaking = false,
  isDefaultPosition = false,
}) => {
  const [open, setOpen] = useState(false);
  const speakingIdentities = useContext(SpeakingParticipantsContext);
  const userSpeaking = isSpeaking || (collaborator.userId ? speakingIdentities.has(collaborator.userId) : false);
  const color = collaborator.color || '#10b981';

  const isAgent = Boolean(
    collaborator.userId?.startsWith('agent:') ||
    collaborator.name?.toLowerCase().includes('chalkboard master') ||
    collaborator.avatarUrl === 'ai:chalkboard-master'
  );

  return (
    <div
      className={`collaborator-cursor${isDefaultPosition ? ' collaborator-cursor-default' : ''}`}
      data-left={isDefaultPosition ? undefined : x}
      data-top={isDefaultPosition ? undefined : y}
      style={
        isDefaultPosition
          ? undefined
          : {
              transform: `translate3d(${x}px, ${y}px, 0)`,
              willChange: 'transform',
            }
      }
      aria-label={`${collaborator.name}'s cursor`}
    >
      {/* Select Cursor Arrow Icon */}
      <svg
        className="collaborator-cursor-select-arrow"
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ color }}
        aria-hidden="true"
      >
        <path
          d="M2.5 2L8.5 17.5L10.8 11.2L17 8.8L2.5 2Z"
          fill="currentColor"
          stroke="#ffffff"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>

      {/* Attached Modal / Pill Badge with Radix HoverCard (no body portal so it renders in fullscreen mode) */}
      <HoverCard.Root
        open={open}
        onOpenChange={setOpen}
        openDelay={120}
        closeDelay={180}
      >
        <HoverCard.Trigger asChild>
          <div
            className="collaborator-cursor-badge"
            style={{
              borderColor: color,
              boxShadow: `0 3px 12px rgba(0, 0, 0, 0.4), 0 0 0 1px ${color}55`,
            }}
            tabIndex={0}
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((prev) => !prev);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setOpen((prev) => !prev);
              }
            }}
            aria-label={`${collaborator.name} (${collaborator.role})`}
          >
            {/* Picture on the LEFT */}
            <div className={`collaborator-cursor-avatar-wrap${userSpeaking ? ' is-speaking' : ''}`}>
              {isAgent ? (
                <ChalkboardMasterIcon size={20} withBackground={true} className="collaborator-cursor-avatar-img" />
              ) : (
                <Avatar.Root className="collaborator-cursor-avatar-root">
                  <Avatar.Image
                    className="collaborator-cursor-avatar-img"
                    src={collaborator.avatarUrl || undefined}
                    alt={collaborator.name}
                  />
                  <Avatar.Fallback className="collaborator-cursor-avatar-fallback">
                    {avatarInitials(collaborator.name)}
                  </Avatar.Fallback>
                </Avatar.Root>
              )}
              {userSpeaking && <span className="collaborator-speaking-ring" />}
            </div>

            {/* Name on the RIGHT (shortened if too long) */}
            <span className="collaborator-cursor-name" title={collaborator.name}>
              {shortenName(collaborator.name, 12)}
            </span>
          </div>
        </HoverCard.Trigger>

        <HoverCard.Content
          className="collaborator-hover-card-content"
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={16}
          onPointerDownOutside={() => setOpen(false)}
        >
          {/* Colored top accent bar */}
          <div
            className="collaborator-card-accent-bar"
            style={{ backgroundColor: color }}
          />

          <div className="collaborator-card-body">
            {/* Profile image with border & active dot */}
            <div className="collaborator-card-avatar-wrap">
              {isAgent ? (
                <ChalkboardMasterIcon size={38} withBackground={true} className="collaborator-card-avatar-img" />
              ) : (
                <Avatar.Root
                  className="collaborator-card-avatar-root"
                  style={{ borderColor: color }}
                >
                  <Avatar.Image
                    className="collaborator-card-avatar-img"
                    src={collaborator.avatarUrl || undefined}
                    alt={collaborator.name}
                  />
                  <Avatar.Fallback className="collaborator-card-avatar-fallback">
                    {avatarInitials(collaborator.name)}
                  </Avatar.Fallback>
                </Avatar.Root>
              )}
              <span
                className="collaborator-card-status-dot"
                style={{ backgroundColor: color }}
              />
            </div>

            {/* User details and status */}
            <div className="collaborator-card-info">
              <div className="collaborator-card-name-row">
                <span className="collaborator-card-full-name">{collaborator.name}</span>
                <span className={`collaborator-card-role-badge role-${collaborator.role}`}>
                  {isAgent
                    ? '✨ AI Co-Pilot'
                    : collaborator.role === 'owner'
                    ? '👑 Owner'
                    : collaborator.role === 'instructor'
                    ? '🛡️ Instructor'
                    : 'Collaborator'}
                </span>
              </div>


              <div className="collaborator-card-details">
                <div className="collaborator-card-detail-item">
                  <span
                    className="collaborator-card-color-chip"
                    style={{ backgroundColor: color }}
                  />
                  <span>Canvas Cursor</span>
                </div>

                {userSpeaking && (
                  <div className="collaborator-card-detail-item speaking-item">
                    <span className="speaking-wave-dot" />
                    <span>Speaking live</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <HoverCard.Arrow className="collaborator-hover-card-arrow" />
        </HoverCard.Content>
      </HoverCard.Root>
    </div>
  );
};

export default CollaboratorCursor;
