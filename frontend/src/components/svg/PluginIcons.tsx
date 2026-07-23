import type { FC } from 'react';

interface PluginIconProps {
  pluginId: string;
  fallback?: string;
}

/** Small, canvas-inspired marks for the built-in plugins. */
export const PluginIcon: FC<PluginIconProps> = ({ pluginId, fallback }) => {
  if (pluginId === 'chalkboard.tag') {
    return (
      <svg className="plugin-logo-svg" viewBox="0 0 32 32" aria-hidden="true">
        <path d="M5 7.5v8.2L17.4 28 28 17.4 15.6 5H7.5A2.5 2.5 0 0 0 5 7.5Z" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinejoin="round" />
        <circle cx="10.2" cy="10.2" r="2" fill="currentColor" />
        <path d="m17.8 10.8 3.4 3.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" opacity=".7" />
      </svg>
    );
  }

  if (pluginId === 'chalkboard.math-set') {
    return (
      <svg className="plugin-logo-svg" viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="12" cy="15" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="20" cy="15" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M8 25h16M12 22v6M20 22v6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity=".8" />
        <circle cx="16" cy="15" r="1.7" fill="currentColor" />
      </svg>
    );
  }

  if (pluginId === 'chalkboard.statistics') {
    return (
      <svg className="plugin-logo-svg" viewBox="0 0 32 32" aria-hidden="true">
        <path d="M6 26V16M14 26V9M22 26V13M30 26V5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <path d="M4 27h27" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity=".7" />
      </svg>
    );
  }

  if (pluginId === 'chalkboard.notes') {
    return (
      <svg className="plugin-logo-svg" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="6" y="4" width="20" height="24" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M10 10h12M10 15h12M10 20h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M21 24h5v-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity=".7" />
      </svg>
    );
  }

  return <span aria-hidden="true">{fallback}</span>;
};

export default PluginIcon;
