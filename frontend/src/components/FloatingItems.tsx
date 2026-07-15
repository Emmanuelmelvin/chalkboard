import React from 'react';

interface FloatingItemProps {
  className?: string;
}

const Pencil: React.FC<FloatingItemProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Pencil body */}
    <rect x="14" y="4" width="12" height="24" fill="#FBBF24" stroke="#D97706" strokeWidth="1.2"/>
    {/* Pencil tip */}
    <polygon points="14,28 20,38 26,28" fill="#FDE68A" stroke="#D97706" strokeWidth="1.2"/>
    {/* Pencil lead */}
    <polygon points="18,34 20,38 22,34" fill="#374151"/>
    {/* Pencil eraser */}
    <rect x="14" y="2" width="12" height="4" fill="#EF4444" stroke="#DC2626" strokeWidth="0.8"/>
    {/* Pencil ferrule */}
    <rect x="14" y="5" width="12" height="2" fill="#9CA3AF" stroke="#6B7280" strokeWidth="0.6"/>
    {/* Wood grain lines */}
    <line x1="17" y1="8" x2="17" y2="26" stroke="#D97706" strokeWidth="0.5" opacity="0.7"/>
    <line x1="20" y1="8" x2="20" y2="26" stroke="#D97706" strokeWidth="0.5" opacity="0.7"/>
    <line x1="23" y1="8" x2="23" y2="26" stroke="#D97706" strokeWidth="0.5" opacity="0.7"/>
  </svg>
);

const Ruler: React.FC<FloatingItemProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 60 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="2" width="58" height="16" fill="#FDE68A" stroke="#D97706" strokeWidth="1.2"/>
    {/* Ruler markings */}
    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => (
      <line
        key={i}
        x1={4 + i * 4.5}
        y1="2"
        x2={4 + i * 4.5}
        y2={i % 2 === 0 ? 10 : 7}
        stroke="#92400E"
        strokeWidth="0.8"
      />
    ))}
    {/* Numbers */}
    {[0, 2, 4, 6, 8, 10, 12].map((i) => (
      <text
        key={i}
        x={4 + i * 4.5}
        y="16"
        fontSize="3.5"
        fill="#92400E"
        textAnchor="middle"
        fontFamily="Arial"
        fontWeight="bold"
      >
        {i}
      </text>
    ))}
  </svg>
);

const Eraser: React.FC<FloatingItemProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 40 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Eraser body */}
    <rect x="2" y="4" width="36" height="16" fill="#FCA5A5" stroke="#EF4444" strokeWidth="1.2"/>
    {/* Eraser band */}
    <rect x="2" y="4" width="36" height="4" fill="#F87171"/>
    {/* Eraser label */}
    <text x="20" y="15" fontSize="6" fill="#991B1B" textAnchor="middle" fontFamily="Arial" fontWeight="bold">ERASER</text>
  </svg>
);

const Protractor: React.FC<FloatingItemProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 40 30" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Protractor body */}
    <path d="M2 28 L20 2 L38 28 Z" fill="rgba(147, 197, 253, 0.8)" stroke="#3B82F6" strokeWidth="1.2"/>
    {/* Protractor arc */}
    <path d="M8 28 Q20 6 32 28" fill="none" stroke="#3B82F6" strokeWidth="1"/>
    {/* Degree markings */}
    {[0, 30, 45, 60, 90, 120, 135, 150, 180].map((deg) => {
      const angle = (deg * Math.PI) / 180;
      const r1 = 10;
      const r2 = deg === 90 ? 12 : 11;
      const cx = 20;
      const cy = 28;
      return (
        <line
          key={deg}
          x1={cx + r1 * Math.cos(angle)}
          y1={cy - r1 * Math.sin(angle)}
          x2={cx + r2 * Math.cos(angle)}
          y2={cy - r2 * Math.sin(angle)}
          stroke="#1D4ED8"
          strokeWidth="0.6"
        />
      );
    })}
    {/* Center hole */}
    <circle cx="20" cy="28" r="1.5" fill="#1D4ED8"/>
  </svg>
);

const Compass: React.FC<FloatingItemProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 30 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Compass legs */}
    <line x1="15" y1="4" x2="6" y2="36" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="square"/>
    <line x1="15" y1="4" x2="24" y2="36" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="square"/>
    {/* Pencil tip */}
    <polygon points="6,34 8,38 10,34" fill="#374151"/>
    {/* Compass point */}
    <polygon points="22,34 24,38 26,34" fill="#374151"/>
    {/* Hinge */}
    <circle cx="15" cy="4" r="2.5" fill="#9CA3AF" stroke="#6B7280" strokeWidth="0.8"/>
    {/* Handle */}
    <rect x="13" y="0" width="4" height="3" fill="#9CA3AF" stroke="#6B7280" strokeWidth="0.6"/>
  </svg>
);

const Scissors: React.FC<FloatingItemProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 40 30" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Blade 1 */}
    <path d="M20 15 L4 4 Q2 2 4 1 L20 15 Z" fill="#9CA3AF" stroke="#6B7280" strokeWidth="0.8"/>
    {/* Blade 2 */}
    <path d="M20 15 L4 26 Q2 28 4 29 L20 15 Z" fill="#9CA3AF" stroke="#6B7280" strokeWidth="0.8"/>
    {/* Handle 1 */}
    <ellipse cx="28" cy="8" rx="8" ry="5" fill="#EF4444" stroke="#DC2626" strokeWidth="0.8"/>
    <ellipse cx="28" cy="8" rx="4" ry="2.5" fill="none" stroke="#DC2626" strokeWidth="0.6"/>
    {/* Handle 2 */}
    <ellipse cx="28" cy="22" rx="8" ry="5" fill="#EF4444" stroke="#DC2626" strokeWidth="0.8"/>
    <ellipse cx="28" cy="22" rx="4" ry="2.5" fill="none" stroke="#DC2626" strokeWidth="0.6"/>
    {/* Pivot */}
    <circle cx="20" cy="15" r="1.5" fill="#4B5563"/>
  </svg>
);

const Book: React.FC<FloatingItemProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 40 34" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Book cover */}
    <rect x="2" y="2" width="36" height="30" fill="#3B82F6" stroke="#2563EB" strokeWidth="1.2"/>
    {/* Book spine */}
    <rect x="2" y="2" width="4" height="30" fill="#2563EB"/>
    {/* Pages */}
    <rect x="6" y="4" width="30" height="26" fill="#FEF3C7"/>
    {/* Page lines */}
    <line x1="10" y1="10" x2="32" y2="10" stroke="#D97706" strokeWidth="0.6" opacity="0.6"/>
    <line x1="10" y1="14" x2="32" y2="14" stroke="#D97706" strokeWidth="0.6" opacity="0.6"/>
    <line x1="10" y1="18" x2="28" y2="18" stroke="#D97706" strokeWidth="0.6" opacity="0.6"/>
    <line x1="10" y1="22" x2="30" y2="22" stroke="#D97706" strokeWidth="0.6" opacity="0.6"/>
    {/* Bookmark */}
    <path d="M30 2 L30 8 L33 6 L36 8 L36 2" fill="#EF4444" stroke="#DC2626" strokeWidth="0.6"/>
  </svg>
);

const Paperclip: React.FC<FloatingItemProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 20 30" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M6 28 L6 8 Q6 2 10 2 Q14 2 14 8 L14 22 Q14 26 10 26 Q8 26 8 24 L8 12 Q8 10 10 10 Q12 10 12 12 L12 20"
      stroke="#6B7280"
      strokeWidth="2"
      strokeLinecap="square"
      fill="none"
    />
  </svg>
);

const Highlighter: React.FC<FloatingItemProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 30 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Highlighter body */}
    <rect x="8" y="6" width="14" height="24" fill="#FDE047" stroke="#EAB308" strokeWidth="1.2"/>
    {/* Highlighter tip */}
    <polygon points="8,30 15,38 22,30" fill="#FEF08A" stroke="#EAB308" strokeWidth="0.8"/>
    {/* Highlighter cap */}
    <rect x="7" y="2" width="16" height="6" fill="#FACC15" stroke="#EAB308" strokeWidth="0.8"/>
    {/* Highlight ink */}
    <rect x="10" y="8" width="10" height="20" fill="rgba(250, 204, 21, 0.6)"/>
  </svg>
);

const items = [
  { Component: Pencil, id: 'pencil' },
  { Component: Ruler, id: 'ruler' },
  { Component: Eraser, id: 'eraser' },
  { Component: Protractor, id: 'protractor' },
  { Component: Compass, id: 'compass' },
  { Component: Scissors, id: 'scissors' },
  { Component: Book, id: 'book' },
  { Component: Paperclip, id: 'paperclip' },
  { Component: Highlighter, id: 'highlighter' },
];

interface Position {
  top: string;
  left: string;
  size: string;
  delay: string;
  duration: string;
  rotation: string;
}

const positions: Position[] = [
  { top: '8%', left: '5%', size: '52px', delay: '0s', duration: '18s', rotation: '-15deg' },
  { top: '15%', left: '85%', size: '60px', delay: '2s', duration: '22s', rotation: '10deg' },
  { top: '30%', left: '2%', size: '44px', delay: '4s', duration: '20s', rotation: '25deg' },
  { top: '45%', left: '90%', size: '56px', delay: '1s', duration: '16s', rotation: '-8deg' },
  { top: '60%', left: '8%', size: '48px', delay: '3s', duration: '24s', rotation: '30deg' },
  { top: '70%', left: '80%', size: '42px', delay: '5s', duration: '19s', rotation: '-20deg' },
  { top: '20%', left: '50%', size: '64px', delay: '6s', duration: '21s', rotation: '5deg' },
  { top: '80%', left: '15%', size: '36px', delay: '7s', duration: '17s', rotation: '-12deg' },
  { top: '85%', left: '70%', size: '46px', delay: '8s', duration: '23s', rotation: '18deg' },
];

export const FloatingItems: React.FC = () => {
  return (
    <div className="floating-items-container">
      {items.map(({ Component, id }, index) => {
        const pos = positions[index];
        return (
          <div
            key={id}
            className="floating-item"
            style={{
              top: pos.top,
              left: pos.left,
              width: pos.size,
              height: pos.size,
              animationDelay: pos.delay,
              animationDuration: pos.duration,
              '--float-rotation': pos.rotation,
            } as React.CSSProperties}
          >
            <Component />
          </div>
        );
      })}
    </div>
  );
};

export default FloatingItems;