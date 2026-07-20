import { useEffect, useState } from 'react';

interface UserAvatarProps {
  name: string;
  avatarUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'C';
}

export default function UserAvatar({ name, avatarUrl, size = 'md', className = '' }: UserAvatarProps) {
  const source = avatarUrl?.trim() || '';
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [source]);

  const classes = `user-avatar user-avatar-${size}${className ? ` ${className}` : ''}`;
  if (!source || imageFailed) {
    return <span className={`${classes} user-avatar-fallback`} aria-label={name}>{initials(name)}</span>;
  }

  return (
    <img
      className={classes}
      src={source}
      alt={name}
      referrerPolicy="no-referrer"
      onError={() => setImageFailed(true)}
    />
  );
}
