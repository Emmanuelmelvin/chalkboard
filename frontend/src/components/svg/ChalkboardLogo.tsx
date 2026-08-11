import React from 'react';

interface ChalkboardLogoProps {
  size?: number;
  className?: string;
}

const ChalkboardLogo: React.FC<ChalkboardLogoProps> = ({ size = 20, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 48 48"
    className={className}
    role="img"
    aria-hidden="true"
    fill="none"
  >
    <circle cx="24" cy="24" r="16" stroke="#c7a258" strokeWidth="3" />
    <path
      d="M30.3 17.4c-1.7-1.5-3.8-2.3-6.1-2.3-5.3 0-9.1 3.7-9.1 8.9s3.8 8.9 9.1 8.9c2.3 0 4.4-.8 6.1-2.3"
      stroke="#e3c77e"
      strokeLinecap="round"
      strokeWidth="4"
    />
  </svg>
);

export default ChalkboardLogo;
