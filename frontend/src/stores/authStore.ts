import { create } from 'zustand';
import * as Sentry from '@sentry/react';
import {
  getCurrentUser,
  signOut as signOutRequest
} from '@/api/auth';
import { apiKeys } from '@/api/keys';
import { queryClient } from '@/api/queryClient';
import type { UserProfile } from '@/api/types';

export type { UserProfile } from '@/api/types';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

const syncSentryUser = (profile: UserProfile | null) => {
  if (!import.meta.env.VITE_SENTRY_DSN) return;
  Sentry.setUser(profile ? { id: profile.id } : null);
};

interface AuthState {
  profile: UserProfile | null;
  status: AuthStatus;
  error: string | null;
  hydrate: () => Promise<void>;
  signOut: () => Promise<void>;
  setAuthenticated: (profile: UserProfile) => void;
}

export const useAuthStore = create<AuthState>((set) => {
  // A slow hydration request must not be able to undo a newer sign-in or sign-out.
  let authRequestId = 0;
  const beginAuthRequest = () => {
    authRequestId += 1;
    return authRequestId;
  };
  const isCurrentRequest = (requestId: number) => requestId === authRequestId;

  return {
    profile: null,
    status: 'loading',
    error: null,

    hydrate: async () => {
      const requestId = beginAuthRequest();
      try {
        const payload = await queryClient.fetchQuery({
          queryKey: apiKeys.auth.me,
          queryFn: getCurrentUser,
          staleTime: 0,
        });
        if (!isCurrentRequest(requestId)) return;
        set({ profile: payload.user, status: 'authenticated', error: null });
        syncSentryUser(payload.user);
      } catch {
        if (isCurrentRequest(requestId)) {
          // A failed /auth/me simply means there is no active session yet, which
          // is the expected state for a visitor arriving at the sign-in page.
          set({ profile: null, status: 'unauthenticated', error: null });
          syncSentryUser(null);
        }
      }
    },

    signOut: async () => {
      const requestId = beginAuthRequest();
      try {
        await signOutRequest();
      } finally {
        if (isCurrentRequest(requestId)) {
          set({ profile: null, status: 'unauthenticated', error: null });
          syncSentryUser(null);
        }
      }
    },

    setAuthenticated: (profile) => {
      set({ profile, status: 'authenticated', error: null });
      syncSentryUser(profile);
    },
  };
});
