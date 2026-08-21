import type { UserProfile } from '@/api/types';

const DEFAULT_PROJECT_ID = 'cmszx1zk11f990io8xrmoef1t';

export const userjotProjectId =
  import.meta.env.VITE_USERJOT_PROJECT_ID?.trim() || DEFAULT_PROJECT_ID;

export const userjotEnabled = Boolean(userjotProjectId);

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
  try {
    window.uj?.init(userjotProjectId, {
      widget: true,
      trigger: 'custom',
      theme: 'auto',
      position: 'right',
    });
  } catch {
    // Keep the app usable if the third-party SDK fails to initialize.
  }
}

export function identifyUserJot(profile: UserProfile | null) {
  if (!userjotProjectId) return;
  if (!profile) {
    try {
      window.uj?.logout();
    } catch {
      // Ignore UserJot errors for signed-out sessions.
    }
    return;
  }
  const displayName = profile.displayName?.trim() || profile.email || '';
  const [firstName = displayName, ...rest] = displayName.split(/\s+/);
  try {
    window.uj?.identify({
      id: profile.id,
      email: profile.email,
      firstName,
      lastName: rest.join(' ') || undefined,
      avatar: profile.avatarUrl ?? undefined,
    });
  } catch {
    // Keep auth flows resilient if the SDK rejects identify payloads.
  }
}

export function showUserJotFeedback() {
  if (!userjotProjectId) return;
  try {
    window.uj?.showWidget({ section: 'feedback' });
  } catch {
    // Ignore SDK errors so UI interactions do not crash the app.
  }
}