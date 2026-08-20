import type { UserProfile } from '@/api/types';

/** True when the UserJot widget is configured for this build. */
export const userjotProjectId = import.meta.env.VITE_USERJOT_PROJECT_ID?.trim();

type UserJotSection = 'feedback' | 'roadmap' | 'changelog';

interface UserJotApi {
  init: (projectId: string, options?: Record<string, unknown>) => void;
  identify: (user: Record<string, string | undefined>) => void;
  logout: () => void;
  showWidget: (options?: { section?: UserJotSection }) => void;
}

declare global {
  interface Window {
    uj?: UserJotApi;
    $ujq?: unknown[];
  }
}

function ensureUserJotLoaded() {
  if (typeof window === 'undefined') return;

  window.$ujq = window.$ujq || [];
  window.uj =
    window.uj ||
    new Proxy({} as UserJotApi, {
      get: (_, method: string) => (...args: unknown[]) => {
        window.$ujq?.push([method, ...args]);
      },
    });

  if (!document.querySelector('script[src="https://cdn.userjot.com/sdk/v2/uj.js"]')) {
    const script = document.createElement('script');
    script.src = 'https://cdn.userjot.com/sdk/v2/uj.js';
    script.type = 'module';
    script.async = true;
    document.head.appendChild(script);
  }
}

export function initUserJot() {
  if (!userjotProjectId) return;
  ensureUserJotLoaded();
  window.uj?.init(userjotProjectId, {
    widget: true,
    trigger: 'custom',
    theme: 'auto',
    position: 'right',
  });
}

export function identifyUserJot(profile: UserProfile | null) {
  if (!userjotProjectId) return;
  if (!profile) {
    window.uj?.logout();
    return;
  }
  const [firstName = profile.displayName, ...rest] = profile.displayName.trim().split(/\s+/);
  window.uj?.identify({
    id: profile.id,
    email: profile.email,
    firstName,
    lastName: rest.join(' ') || undefined,
    avatar: profile.avatarUrl ?? undefined,
  });
}

export function showUserJotFeedback() {
  if (!userjotProjectId) return;
  window.uj?.showWidget({ section: 'feedback' });
}