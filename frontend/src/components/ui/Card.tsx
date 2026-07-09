import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'slate' | 'hud';
}

export const Card: React.FC<CardProps> = ({
  children,
  variant = 'hud',
  className = '',
  ...props
}) => {
  const baseClass = variant === 'hud' ? 'hud-panel' : 'lobby-chalkboard';
  return (
    <div className={`${baseClass} ${className}`} {...props}>
      {children}
    </div>
  );
};

export default Card;
