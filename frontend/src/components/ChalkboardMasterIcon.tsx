/**
 * @file ChalkboardMasterIcon.tsx
 * @description Official Chalkboard Master two-star sparkle SVG icon (large primary sparkle + small companion sparkle)
 * matching the Google Gemini design language with rounded tips and hyperbolic curves.
 */

import React from 'react';

export interface ChalkboardMasterIconProps {
  size?: number | 'sm' | 'md' | 'lg';
  className?: string;
  withBackground?: boolean;
}

export const ChalkboardMasterIcon: React.FC<ChalkboardMasterIconProps> = ({
  size = 'md',
  className = '',
  withBackground = true,
}) => {
  const pixelSize =
    typeof size === 'number'
      ? size
      : size === 'sm'
      ? 32
      : size === 'lg'
      ? 76
      : 42;

  return (
    <svg
      width={pixelSize}
      height={pixelSize}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`chalkboard-master-avatar-svg ${className}`}
      aria-label="Chalkboard Master 🤖"
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
    >
      <defs>
        {/* Background Dark Radial Gradient */}
        <radialGradient id="cm_avatar_bg" cx="40%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#311042" />
          <stop offset="60%" stopColor="#1e1b4b" />
          <stop offset="100%" stopColor="#0f172a" />
        </radialGradient>

        {/* Gemini Multi-color Gradient for Primary Sparkle */}
        <linearGradient id="cm_sparkle_grad" x1="10%" y1="10%" x2="90%" y2="90%">
          <stop offset="0%" stopColor="#60A5FA" />
          <stop offset="25%" stopColor="#818CF8" />
          <stop offset="50%" stopColor="#C084FC" />
          <stop offset="75%" stopColor="#F472B6" />
          <stop offset="100%" stopColor="#38BDF8" />
        </linearGradient>

        {/* Secondary Sparkle Gradient */}
        <linearGradient id="cm_small_sparkle_grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#93C5FD" />
          <stop offset="50%" stopColor="#C084FC" />
          <stop offset="100%" stopColor="#F472B6" />
        </linearGradient>

        {/* Soft Ambient Center Glow */}
        <radialGradient id="cm_glow" cx="42%" cy="40%" r="35%">
          <stop offset="0%" stopColor="#818cf8" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#818cf8" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Circular Avatar Background */}
      {withBackground && (
        <>
          <circle cx="50" cy="50" r="48" fill="url(#cm_avatar_bg)" stroke="#6366f1" strokeWidth="3" />
          <circle cx="42" cy="40" r="30" fill="url(#cm_glow)" />
        </>
      )}

      {/* Large Primary 4-Point Sparkle with Rounded Tips */}
      <path
        d="M 39.2 8.5 C 40.5 4.8 43.5 4.8 44.8 8.5 C 47.8 21.5 58.5 32.2 71.5 35.2 C 75.2 36.5 75.2 39.5 71.5 40.8 C 58.5 43.8 47.8 54.5 44.8 67.5 C 43.5 71.2 40.5 71.2 39.2 67.5 C 36.2 54.5 25.5 43.8 12.5 40.8 C 8.8 39.5 8.8 36.5 12.5 35.2 C 25.5 32.2 36.2 21.5 39.2 8.5 Z"
        fill="url(#cm_sparkle_grad)"
      />

      {/* Small Secondary 4-Point Sparkle at Bottom Right */}
      <path
        d="M 74.8 57.5 C 75.5 55.2 77.5 55.2 78.2 57.5 C 80.2 65.5 86.5 71.8 94.5 73.8 C 96.8 74.5 96.8 76.5 94.5 77.2 C 86.5 79.2 80.2 85.5 78.2 93.5 C 77.5 95.8 75.5 95.8 74.8 93.5 C 72.8 85.5 66.5 79.2 58.5 77.2 C 56.2 76.5 56.2 74.5 58.5 73.8 C 66.5 71.8 72.8 65.5 74.8 57.5 Z"
        fill="url(#cm_small_sparkle_grad)"
      />
    </svg>
  );
};

export default ChalkboardMasterIcon;
