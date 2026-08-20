import type { UserProfile } from '@/api/types';

const PROJECT_ID = import.meta.env.VITE_USERJOT_PROJECT_ID?.trim();

/** True when the UserJot widget is configured for this build. */
export const userjotEnabled = Boolean(PROJECT_ID);

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

export function initUserJot() {
  if (!PROJECT_ID) return;
  window.uj?.init(PROJECT_ID, {
    widget: true,
    trigger: 'custom',
    theme: 'auto',
    position: 'right',
  });
}

export function identifyUserJot(profile: UserProfile | null) {
  if (!userjotEnabled) return;
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
  if (!userjotEnabled) return;
  window.uj?.showWidget({ section: 'feedback' });
}