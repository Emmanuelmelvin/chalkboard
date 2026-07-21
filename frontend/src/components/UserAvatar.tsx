import { useState } from 'react';

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

interface AvatarImageProps {
  name: string;
  source: string;
  classes: string;
}

function AvatarImage({ name, source, classes }: AvatarImageProps) {
  const [imageFailed, setImageFailed] = useState(false);

  if (imageFailed) {
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

export default function UserAvatar({ name, avatarUrl, size = 'md', className = '' }: UserAvatarProps) {
  const source = avatarUrl?.trim() || '';
  const classes = `user-avatar user-avatar-${size}${className ? ` ${className}` : ''}`;
  if (!source) {
    return <span className={`${classes} user-avatar-fallback`} aria-label={name}>{initials(name)}</span>;
  }

  return <AvatarImage key={source} name={name} source={source} classes={classes} />;
}
